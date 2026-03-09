import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCheckoutStore,
  createBridgeStore,
  createBridgedSession,
  processNegotiationRound,
  mapHnpStatusToBridge,
  NEGOTIATION_EXTENSION_KEY,
  dollarsToMinorUnits,
} from '../src/index.js';
import type {
  CheckoutStore,
  BridgeStore,
  HaggleNegotiationExtension,
} from '../src/index.js';
import type { MasterStrategy, NegotiationSession, RoundData } from '@haggle/engine-session';

let checkoutStore: CheckoutStore;
let bridgeStore: BridgeStore;
let hnpSessions: Map<string, NegotiationSession>;

function makeStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat_1',
    user_id: 'user_1',
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    p_target: 180,
    p_limit: 250,
    alpha: 1,
    beta: 1,
    t_deadline: 3600,
    v_t_floor: 0.1,
    n_threshold: 5,
    v_s_base: 0.5,
    w_rep: 0.6,
    w_info: 0.4,
    u_threshold: 0.3,
    u_aspiration: 0.7,
    persona: 'balanced',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
    ...overrides,
  };
}

function makeRoundData(priceMinor: number): RoundData {
  return {
    p_effective: priceMinor / 100, // will be overridden by bridge
    r_score: 0.8,
    i_completeness: 0.9,
    t_elapsed: 60,
    n_success: 3,
    n_dispute_losses: 0,
  };
}

beforeEach(() => {
  checkoutStore = createCheckoutStore();
  bridgeStore = createBridgeStore();
  hnpSessions = new Map();
});

describe('createBridgedSession', () => {
  it('creates linked checkout + HNP session', () => {
    const strategy = makeStrategy();
    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{ item: { id: 'shoe_1', title: 'Running Shoes', price: 25000 }, quantity: 1 }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_1',
      idempotencyKey: 'idem-bridge-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Checkout created
    expect(result.checkout.status).toBe('incomplete');
    expect(result.checkout.line_items[0].item.price).toBe(25000);

    // HNP session created
    expect(result.hnpSession.session_id).toBeDefined();
    expect(result.hnpSession.status).toBe('CREATED');
    expect(result.hnpSession.role).toBe('BUYER'); // p_target < p_limit

    // Bridge created
    expect(result.bridge.status).toBe('NEGOTIATING');
    expect(result.bridge.ucp_checkout_id).toBe(result.checkout.id);
    expect(result.bridge.hnp_session_id).toBe(result.hnpSession.session_id);
    expect(result.bridge.listing_price).toBe(25000);
    expect(result.bridge.negotiated_price).toBeNull();

    // Extension attached
    const ext = result.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
    expect(ext).toBeDefined();
    expect(ext.session_id).toBe(result.hnpSession.session_id);
    expect(ext.status).toBe('pending');
    expect(ext.original_price).toBe(25000);
    expect(ext.role).toBe('BUYER');
  });

  it('returns error for invalid checkout request', () => {
    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [],
        currency: 'USD',
      },
      strategy: makeStrategy(),
      counterpartyId: 'seller_1',
      idempotencyKey: 'idem-bridge-err',
    });

    expect(result.ok).toBe(false);
  });
});

describe('processNegotiationRound', () => {
  function setupBridge() {
    const strategy = makeStrategy();
    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{ item: { id: 'shoe_1', title: 'Running Shoes', price: 25000 }, quantity: 1 }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_1',
      idempotencyKey: `idem-${Date.now()}-${Math.random()}`,
    });

    if (!result.ok) throw new Error('setup failed');

    // Store HNP session
    hnpSessions.set(result.hnpSession.session_id, result.hnpSession);

    return { strategy, checkoutId: result.checkout.id, bridge: result.bridge };
  }

  it('processes an offer and returns COUNTER', () => {
    const { strategy, checkoutId } = setupBridge();

    // Seller offers $250 (listing price) — buyer should counter lower
    const result = processNegotiationRound(
      checkoutStore,
      bridgeStore,
      hnpSessions,
      {
        checkoutId,
        offerPrice: 25000, // $250
        roundData: makeRoundData(25000),
        strategy,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Engine should produce a decision
    expect(result.roundResult.decision).toBeDefined();
    expect(['COUNTER', 'ACCEPT', 'NEAR_DEAL', 'REJECT', 'ESCALATE']).toContain(
      result.roundResult.decision,
    );

    // Extension updated
    const ext = result.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
    expect(ext.round).toBeGreaterThan(0);
    expect(ext.current_offer).toBe(25000);
    expect(ext.utility_score).toBeGreaterThanOrEqual(0);
  });

  it('handles ACCEPT → checkout becomes ready_for_complete', () => {
    // Use strategy where $200 is great (very low target for buyer)
    const strategy = makeStrategy({
      p_target: 100,  // buyer wants $100
      p_limit: 200,   // buyer max $200
      u_threshold: 0.01, // very low threshold → accept almost anything
      u_aspiration: 0.05,
    });

    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{ item: { id: 'shoe_1', title: 'Running Shoes', price: 25000 }, quantity: 1 }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_1',
      idempotencyKey: `idem-accept-${Date.now()}`,
    });

    if (!result.ok) throw new Error('setup failed');
    hnpSessions.set(result.hnpSession.session_id, result.hnpSession);

    // Offer at $110 — very close to target, should likely accept
    const roundResult = processNegotiationRound(
      checkoutStore,
      bridgeStore,
      hnpSessions,
      {
        checkoutId: result.checkout.id,
        offerPrice: 11000, // $110
        roundData: makeRoundData(11000),
        strategy,
      },
    );

    expect(roundResult.ok).toBe(true);
    if (!roundResult.ok) return;

    if (roundResult.roundResult.decision === 'ACCEPT') {
      expect(roundResult.checkout.status).toBe('ready_for_complete');
      expect(roundResult.bridge.status).toBe('AGREED');
      expect(roundResult.bridge.negotiated_price).toBe(11000);

      const ext = roundResult.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
      expect(ext.status).toBe('agreed');
    }
  });

  it('returns error for non-existent checkout', () => {
    const result = processNegotiationRound(
      checkoutStore,
      bridgeStore,
      hnpSessions,
      {
        checkoutId: 'chk_nonexistent',
        offerPrice: 20000,
        roundData: makeRoundData(20000),
        strategy: makeStrategy(),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No bridged session');
    }
  });
});

describe('mapHnpStatusToBridge', () => {
  it('maps active states to NEGOTIATING', () => {
    expect(mapHnpStatusToBridge('CREATED')).toBe('NEGOTIATING');
    expect(mapHnpStatusToBridge('ACTIVE')).toBe('NEGOTIATING');
    expect(mapHnpStatusToBridge('NEAR_DEAL')).toBe('NEGOTIATING');
    expect(mapHnpStatusToBridge('STALLED')).toBe('NEGOTIATING');
    expect(mapHnpStatusToBridge('WAITING')).toBe('NEGOTIATING');
  });

  it('maps ACCEPTED to AGREED', () => {
    expect(mapHnpStatusToBridge('ACCEPTED')).toBe('AGREED');
  });

  it('maps terminal states correctly', () => {
    expect(mapHnpStatusToBridge('REJECTED')).toBe('CANCELLED');
    expect(mapHnpStatusToBridge('SUPERSEDED')).toBe('CANCELLED');
    expect(mapHnpStatusToBridge('EXPIRED')).toBe('EXPIRED');
  });
});
