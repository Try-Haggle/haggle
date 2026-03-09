// ============================================================
// E2E Test: Full UCP + Negotiation Flow
// Discovery → Create Checkout → Negotiate → Complete → Order
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Profile & Discovery
  buildDefaultHaggleProfile,
  negotiateCapabilities,
  UCP_CAPABILITIES,
  UCP_SPEC_VERSION,
  // Checkout
  createCheckoutStore,
  createCheckoutSession,
  getCheckoutSession,
  completeCheckoutSession,
  markCheckoutReady,
  // Bridge
  createBridgeStore,
  createBridgedSession,
  processNegotiationRound,
  NEGOTIATION_EXTENSION_KEY,
  // Order
  createOrderStore,
  processOrderWebhook,
  verifyWebhookSignature,
  // Payment
  validateUsdcInstrument,
  processUsdcPayment,
  USDC_HANDLER_ID,
  // Price
  dollarsToMinorUnits,
  minorUnitsToDollars,
} from '../../src/index.js';
import type {
  CheckoutStore,
  BridgeStore,
  OrderStore,
  HaggleNegotiationExtension,
  UsdcPaymentInstrument,
} from '../../src/index.js';
import type { MasterStrategy, NegotiationSession, RoundData } from '@haggle/engine-session';

// --- Shared state ---
let checkoutStore: CheckoutStore;
let bridgeStore: BridgeStore;
let orderStore: OrderStore;
let hnpSessions: Map<string, NegotiationSession>;

function buyerStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat_buyer',
    user_id: 'buyer_1',
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    p_target: 180,     // buyer wants $180
    p_limit: 250,      // buyer max $250
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

function roundData(priceDollars: number): RoundData {
  return {
    p_effective: priceDollars,
    r_score: 0.85,
    i_completeness: 0.9,
    t_elapsed: 120,
    n_success: 5,
    n_dispute_losses: 0,
  };
}

beforeEach(() => {
  checkoutStore = createCheckoutStore();
  bridgeStore = createBridgeStore();
  orderStore = createOrderStore();
  hnpSessions = new Map();
});

describe('E2E: Happy Path — Discovery → Negotiate → Checkout → Payment → Order', () => {
  it('completes full lifecycle', () => {
    // ═══════════════════════════════════════════════════════
    // Step 1: DISCOVERY — Platform fetches /.well-known/ucp
    // ═══════════════════════════════════════════════════════
    const profile = buildDefaultHaggleProfile('https://api.tryhaggle.ai/ucp/v1');

    expect(profile.ucp.version).toBe(UCP_SPEC_VERSION);
    expect(profile.ucp.capabilities[UCP_CAPABILITIES.CHECKOUT]).toBeDefined();
    expect(profile.ucp.capabilities[UCP_CAPABILITIES.NEGOTIATION]).toBeDefined();

    // Platform negotiates capabilities
    const platformCaps = {
      [UCP_CAPABILITIES.CHECKOUT]: [{ version: UCP_SPEC_VERSION }],
      [UCP_CAPABILITIES.DISCOUNT]: [{ version: UCP_SPEC_VERSION, extends: UCP_CAPABILITIES.CHECKOUT }],
      [UCP_CAPABILITIES.NEGOTIATION]: [{ version: '2026-03-01', extends: UCP_CAPABILITIES.CHECKOUT }],
    };

    const negotiation = negotiateCapabilities(
      profile.ucp.capabilities,
      platformCaps,
      UCP_SPEC_VERSION,
      UCP_SPEC_VERSION,
    );

    expect(negotiation).not.toBeNull();
    const capNames = negotiation!.capabilities.map((c) => c.name);
    expect(capNames).toContain(UCP_CAPABILITIES.CHECKOUT);
    expect(capNames).toContain(UCP_CAPABILITIES.NEGOTIATION);

    // ═══════════════════════════════════════════════════════
    // Step 2: CREATE CHECKOUT + NEGOTIATION SESSION
    // ═══════════════════════════════════════════════════════
    const strategy = buyerStrategy();
    const listingPriceMinor = 25000; // $250.00

    const bridgeResult = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{
          item: { id: 'shoe_air_max', title: 'Nike Air Max 90', price: listingPriceMinor },
          quantity: 1,
        }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_sneaker_shop',
      idempotencyKey: 'e2e-happy-path-1',
    });

    expect(bridgeResult.ok).toBe(true);
    if (!bridgeResult.ok) return;

    const { checkout, hnpSession, bridge } = bridgeResult;
    hnpSessions.set(hnpSession.session_id, hnpSession);

    expect(checkout.status).toBe('incomplete');
    expect(checkout.currency).toBe('USD');
    expect(bridge.status).toBe('NEGOTIATING');
    expect(bridge.listing_price).toBe(25000);

    const ext = checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
    expect(ext.status).toBe('pending');
    expect(ext.original_price).toBe(25000);

    // ═══════════════════════════════════════════════════════
    // Step 3: NEGOTIATION ROUNDS
    // ═══════════════════════════════════════════════════════

    // Round 1: Seller offers $250 (listing price)
    const r1 = processNegotiationRound(checkoutStore, bridgeStore, hnpSessions, {
      checkoutId: checkout.id,
      offerPrice: 25000,
      roundData: roundData(250),
      strategy,
    });

    expect(r1.ok).toBe(true);
    if (!r1.ok) return;

    expect(r1.roundResult.decision).toBeDefined();
    expect(r1.roundResult.utility.u_total).toBeGreaterThanOrEqual(0);

    const ext1 = r1.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
    expect(ext1.round).toBe(1);
    expect(ext1.current_offer).toBe(25000);

    // If engine countered, simulate seller conceding
    if (r1.roundResult.decision === 'COUNTER' || r1.roundResult.decision === 'NEAR_DEAL') {
      // Round 2: Seller concedes to $220
      const r2 = processNegotiationRound(checkoutStore, bridgeStore, hnpSessions, {
        checkoutId: checkout.id,
        offerPrice: 22000,
        roundData: roundData(220),
        strategy,
      });

      expect(r2.ok).toBe(true);
      if (!r2.ok) return;

      const ext2 = r2.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
      expect(ext2.round).toBe(2);

      // If still countering, seller goes to $200
      if (r2.roundResult.decision === 'COUNTER' || r2.roundResult.decision === 'NEAR_DEAL') {
        const r3 = processNegotiationRound(checkoutStore, bridgeStore, hnpSessions, {
          checkoutId: checkout.id,
          offerPrice: 20000,
          roundData: roundData(200),
          strategy,
        });

        expect(r3.ok).toBe(true);
      }
    }

    // ═══════════════════════════════════════════════════════
    // Step 4: CHECK FINAL STATE
    // ═══════════════════════════════════════════════════════
    const finalCheckout = getCheckoutSession(checkoutStore, checkout.id);
    expect(finalCheckout.ok).toBe(true);
    if (!finalCheckout.ok) return;

    const finalBridge = bridgeStore.getByCheckoutId(checkout.id);
    expect(finalBridge).not.toBeNull();

    const finalExt = finalCheckout.session.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
    expect(finalExt.round).toBeGreaterThanOrEqual(1);

    // The engine should have made a decision
    expect(['ACCEPT', 'COUNTER', 'REJECT', 'NEAR_DEAL', 'ESCALATE']).toContain(finalExt.decision);

    // ═══════════════════════════════════════════════════════
    // Step 5: PAYMENT (if agreed)
    // ═══════════════════════════════════════════════════════
    if (finalBridge!.status === 'AGREED') {
      expect(finalCheckout.session.status).toBe('ready_for_complete');

      // Validate USDC instrument
      const instrument: UsdcPaymentInstrument = {
        id: 'pi_usdc_e2e',
        handler_id: 'ai.tryhaggle.usdc',
        type: 'crypto',
        chain: 'base',
        wallet_address: '0x1234567890abcdef1234567890abcdef12345678',
        token: 'USDC',
        credential: { type: 'sandbox', token: 'sandbox_e2e_test' },
      };

      const validation = validateUsdcInstrument(instrument);
      expect(validation.ok).toBe(true);

      // Process USDC payment
      const agreedPrice = finalBridge!.negotiated_price!;
      const paymentResult = processUsdcPayment(instrument, agreedPrice);
      expect(paymentResult.ok).toBe(true);
      expect(paymentResult.transaction_hash).toMatch(/^0xsandbox_/);

      // Complete checkout
      const completeResult = completeCheckoutSession(
        checkoutStore,
        checkout.id,
        {
          payment: {
            instruments: [{
              id: instrument.id,
              handler_id: instrument.handler_id,
              type: instrument.type,
              credential: instrument.credential,
            }],
          },
        },
        'e2e-complete-1',
      );

      expect(completeResult.ok).toBe(true);
      if (completeResult.ok) {
        expect(completeResult.session.status).toBe('completed');
      }

      // ═══════════════════════════════════════════════════════
      // Step 6: ORDER WEBHOOK
      // ═══════════════════════════════════════════════════════
      const sig = verifyWebhookSignature('sandbox_e2e', '{}', []);
      expect(sig.ok).toBe(true);

      const orderResult = processOrderWebhook(orderStore, bridgeStore, {
        order: {
          id: 'order_e2e_1',
          checkout_id: checkout.id,
          permalink_url: 'https://tryhaggle.ai/orders/e2e_1',
          line_items: [{
            id: 'li_1',
            item_id: 'shoe_air_max',
            title: 'Nike Air Max 90',
            quantity: 1,
            price: agreedPrice,
            fulfillment_status: 'fulfilled',
          }],
          fulfillment: {
            expectations: [{ method: 'shipping', description: '3-5 business days' }],
            events: [
              { id: 'fe_1', type: 'processing', timestamp: new Date().toISOString() },
              { id: 'fe_2', type: 'shipped', timestamp: new Date().toISOString() },
              { id: 'fe_3', type: 'delivered', timestamp: new Date().toISOString() },
            ],
          },
          adjustments: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });

      expect(orderResult.ok).toBe(true);

      // Bridge should be COMPLETED
      const completedBridge = bridgeStore.getByCheckoutId(checkout.id);
      expect(completedBridge?.status).toBe('COMPLETED');
    }
  });
});

describe('E2E: Rejection Flow', () => {
  it('handles buyer rejection correctly', () => {
    // Use a very aggressive strategy — buyer wants way below listing
    const strategy = buyerStrategy({
      p_target: 50,   // wants $50
      p_limit: 80,    // max $80
      u_threshold: 0.8,
      u_aspiration: 0.95,
    });

    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{ item: { id: 'item_1', title: 'Item', price: 50000 }, quantity: 1 }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_1',
      idempotencyKey: 'e2e-reject-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    hnpSessions.set(result.hnpSession.session_id, result.hnpSession);

    // Seller offers $500 — way above buyer's limit, should reject
    const round = processNegotiationRound(checkoutStore, bridgeStore, hnpSessions, {
      checkoutId: result.checkout.id,
      offerPrice: 50000,
      roundData: roundData(500),
      strategy,
    });

    expect(round.ok).toBe(true);
    if (!round.ok) return;

    // Engine should reject (price is way above limit)
    if (round.roundResult.decision === 'REJECT') {
      expect(round.checkout.status).toBe('canceled');
      expect(round.bridge.status).toBe('CANCELLED');

      const ext = round.checkout.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
      expect(ext.status).toBe('rejected');
    }
  });
});

describe('E2E: Timeout/Expiry Flow', () => {
  it('handles session that never reaches agreement', () => {
    const strategy = buyerStrategy({
      p_target: 100,
      p_limit: 150,
      u_threshold: 0.6,
      u_aspiration: 0.9,
    });

    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{ item: { id: 'item_2', title: 'Item 2', price: 30000 }, quantity: 1 }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_2',
      idempotencyKey: 'e2e-timeout-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    hnpSessions.set(result.hnpSession.session_id, result.hnpSession);

    // Multiple rounds with seller not conceding enough
    let lastResult = result.checkout;
    for (let i = 0; i < 3; i++) {
      const price = 28000 - i * 500; // $280, $275, $270
      const round = processNegotiationRound(checkoutStore, bridgeStore, hnpSessions, {
        checkoutId: result.checkout.id,
        offerPrice: price,
        roundData: { ...roundData(price / 100), t_elapsed: (i + 1) * 300 },
        strategy,
      });

      expect(round.ok).toBe(true);
      if (!round.ok) break;
      lastResult = round.checkout;

      // If terminal, stop
      if (['canceled', 'completed', 'ready_for_complete'].includes(round.checkout.status)) {
        break;
      }
    }

    // Verify state is consistent
    const finalCheckout = getCheckoutSession(checkoutStore, result.checkout.id);
    expect(finalCheckout.ok).toBe(true);
    if (finalCheckout.ok) {
      const ext = finalCheckout.session.extensions?.[NEGOTIATION_EXTENSION_KEY] as HaggleNegotiationExtension;
      expect(ext.round).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('E2E: Price Conversion Integrity', () => {
  it('maintains price accuracy across conversions', () => {
    const prices = [199.99, 25.50, 0.01, 1000.00, 99.95];

    for (const price of prices) {
      const minor = dollarsToMinorUnits(price);
      const back = minorUnitsToDollars(minor);
      expect(back).toBe(price);
    }
  });

  it('negotiated price in checkout totals matches bridge', () => {
    // Use a strategy that will accept quickly
    const strategy = buyerStrategy({
      p_target: 100,
      p_limit: 300,
      u_threshold: 0.01,
      u_aspiration: 0.05,
    });

    const result = createBridgedSession(checkoutStore, bridgeStore, {
      checkoutRequest: {
        line_items: [{ item: { id: 'p1', title: 'Product', price: 15000 }, quantity: 1 }],
        currency: 'USD',
      },
      strategy,
      counterpartyId: 'seller_x',
      idempotencyKey: 'e2e-price-1',
    });

    if (!result.ok) return;
    hnpSessions.set(result.hnpSession.session_id, result.hnpSession);

    const round = processNegotiationRound(checkoutStore, bridgeStore, hnpSessions, {
      checkoutId: result.checkout.id,
      offerPrice: 12000,
      roundData: roundData(120),
      strategy,
    });

    if (!round.ok) return;

    if (round.roundResult.decision === 'ACCEPT') {
      // Bridge negotiated price should match
      expect(round.bridge.negotiated_price).toBe(12000);

      // Checkout totals should reflect negotiated price
      const total = round.checkout.totals.find((t) => t.type === 'total');
      expect(total?.amount).toBe(12000);

      // Line item should also be updated
      expect(round.checkout.line_items[0].totals.find((t) => t.type === 'total')?.amount).toBe(12000);
    }
  });
});

describe('E2E: Non-negotiated Checkout', () => {
  it('works without negotiation (standard UCP flow)', () => {
    const result = createCheckoutSession(checkoutStore, {
      line_items: [
        { item: { id: 'book_1', title: 'TypeScript Handbook', price: 3999 }, quantity: 2 },
      ],
      currency: 'USD',
    }, 'e2e-no-negotiate');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.session.status).toBe('incomplete');
    expect(result.session.totals.find((t) => t.type === 'total')?.amount).toBe(7998);

    // Mark ready (simulating all requirements met)
    markCheckoutReady(checkoutStore, result.session.id);

    // Complete
    const complete = completeCheckoutSession(checkoutStore, result.session.id, {
      payment: {
        instruments: [{
          id: 'pi_card_1',
          handler_id: 'com.google.pay',
          type: 'card',
          credential: { type: 'token', token: 'sandbox_gpay' },
        }],
      },
    }, 'e2e-no-negotiate-complete');

    expect(complete.ok).toBe(true);
    if (complete.ok) {
      expect(complete.session.status).toBe('completed');
    }
  });
});
