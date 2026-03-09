// ============================================================
// Session Bridge: HNP NegotiationSession ↔ UCP CheckoutSession
// This is the core integration layer between Haggle and UCP.
//
// Responsibilities:
// - Create linked checkout + negotiation sessions
// - Process negotiation rounds and sync state to checkout
// - Finalize agreement → checkout ready_for_complete
// - Handle rejection/timeout → checkout canceled
// ============================================================

import type { NegotiationSession, MasterStrategy, RoundData, HnpMessage } from '@haggle/engine-session';
import { createSession, executeRound } from '@haggle/engine-session';
import type { RoundResult } from '@haggle/engine-session';
import type { CheckoutSession, CreateCheckoutRequest } from './types.js';
import type { CheckoutStore } from './store.js';
import type { HaggleNegotiationExtension } from '../extension/negotiation.js';
import { NEGOTIATION_EXTENSION_KEY, createNegotiationExtension } from '../extension/negotiation.js';
import { createCheckoutSession, markCheckoutReady } from './operations.js';
import { dollarsToMinorUnits, minorUnitsToDollars } from './price.js';
import { transitionCheckout } from './state-machine.js';
import type { NegotiationExtensionStatus } from '../extension/negotiation.js';

// --- Bridge types ---

export type BridgedSessionStatus =
  | 'NEGOTIATING'
  | 'AGREED'
  | 'CHECKOUT_PENDING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface BridgedSession {
  id: string;
  ucp_checkout_id: string;
  hnp_session_id: string;
  status: BridgedSessionStatus;
  listing_price: number;        // minor units
  negotiated_price: number | null; // minor units
  created_at: string;
  updated_at: string;
}

// --- Bridge store ---

export function createBridgeStore() {
  const bridges = new Map<string, BridgedSession>();
  const byCheckoutId = new Map<string, string>();
  const byHnpSessionId = new Map<string, string>();
  let counter = 0;

  function generateId(): string {
    counter += 1;
    return `bridge_${Date.now()}_${counter}`;
  }

  function create(bridge: BridgedSession): BridgedSession {
    bridges.set(bridge.id, bridge);
    byCheckoutId.set(bridge.ucp_checkout_id, bridge.id);
    byHnpSessionId.set(bridge.hnp_session_id, bridge.id);
    return bridge;
  }

  function get(id: string): BridgedSession | null {
    return bridges.get(id) ?? null;
  }

  function getByCheckoutId(checkoutId: string): BridgedSession | null {
    const bridgeId = byCheckoutId.get(checkoutId);
    return bridgeId ? bridges.get(bridgeId) ?? null : null;
  }

  function getByHnpSessionId(sessionId: string): BridgedSession | null {
    const bridgeId = byHnpSessionId.get(sessionId);
    return bridgeId ? bridges.get(bridgeId) ?? null : null;
  }

  function update(id: string, updates: Partial<BridgedSession>): BridgedSession | null {
    const existing = bridges.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...updates,
      id: existing.id,
      updated_at: new Date().toISOString(),
    };
    bridges.set(id, updated);
    return updated;
  }

  function clear(): void {
    bridges.clear();
    byCheckoutId.clear();
    byHnpSessionId.clear();
    counter = 0;
  }

  return { generateId, create, get, getByCheckoutId, getByHnpSessionId, update, clear };
}

export type BridgeStore = ReturnType<typeof createBridgeStore>;

// --- Bridge operations ---

export interface CreateBridgedSessionParams {
  checkoutRequest: CreateCheckoutRequest;
  strategy: MasterStrategy;
  counterpartyId: string;
  idempotencyKey: string;
}

export type CreateBridgedSessionResult = {
  ok: true;
  bridge: BridgedSession;
  checkout: CheckoutSession;
  hnpSession: NegotiationSession;
} | {
  ok: false;
  error: string;
}

/**
 * Create a linked UCP checkout + HNP negotiation session.
 */
export function createBridgedSession(
  checkoutStore: CheckoutStore,
  bridgeStore: BridgeStore,
  params: CreateBridgedSessionParams,
): CreateBridgedSessionResult {
  const { checkoutRequest, strategy, counterpartyId, idempotencyKey } = params;

  // 1. Create UCP checkout session
  const checkoutResult = createCheckoutSession(checkoutStore, checkoutRequest, idempotencyKey);
  if (!checkoutResult.ok) {
    return { ok: false, error: checkoutResult.error };
  }
  const checkout = checkoutResult.session;

  // 2. Create HNP negotiation session
  const hnpSession = createSession({
    session_id: `hnp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    strategy_id: strategy.id,
    role: strategy.p_target < strategy.p_limit ? 'BUYER' : 'SELLER',
    counterparty_id: counterpartyId,
  });

  // 3. Get listing price from first line item
  const listingPrice = checkout.line_items[0]?.item.price ?? 0;

  // 4. Create negotiation extension
  const role = hnpSession.role;
  const negExt = createNegotiationExtension({
    sessionId: hnpSession.session_id,
    originalPrice: listingPrice,
    role,
    priceFloor: dollarsToMinorUnits(strategy.p_limit),
    priceCeiling: dollarsToMinorUnits(
      role === 'BUYER' ? strategy.p_limit : strategy.p_target,
    ),
    deadline: new Date(Date.now() + strategy.t_deadline * 1000).toISOString(),
  });

  // 5. Attach extension to checkout
  checkoutStore.update(checkout.id, {
    extensions: {
      ...checkout.extensions,
      [NEGOTIATION_EXTENSION_KEY]: negExt,
    },
  });

  // 6. Create bridge record
  const now = new Date().toISOString();
  const bridge = bridgeStore.create({
    id: bridgeStore.generateId(),
    ucp_checkout_id: checkout.id,
    hnp_session_id: hnpSession.session_id,
    status: 'NEGOTIATING',
    listing_price: listingPrice,
    negotiated_price: null,
    created_at: now,
    updated_at: now,
  });

  // Refetch checkout with extension
  const finalCheckout = checkoutStore.get(checkout.id)!;

  return { ok: true, bridge, checkout: finalCheckout, hnpSession };
}

// --- Process a negotiation round ---

export interface ProcessRoundParams {
  checkoutId: string;
  offerPrice: number;          // minor units
  roundData: RoundData;
  strategy: MasterStrategy;
}

export type ProcessRoundResult = {
  ok: true;
  roundResult: RoundResult;
  checkout: CheckoutSession;
  bridge: BridgedSession;
} | {
  ok: false;
  error: string;
}

/**
 * Process a negotiation offer within a bridged session.
 * Runs the HNP engine and syncs the result to UCP checkout.
 */
export function processNegotiationRound(
  checkoutStore: CheckoutStore,
  bridgeStore: BridgeStore,
  hnpSessions: Map<string, NegotiationSession>,
  params: ProcessRoundParams,
): ProcessRoundResult {
  const { checkoutId, offerPrice, roundData, strategy } = params;

  // 1. Find bridge
  const bridge = bridgeStore.getByCheckoutId(checkoutId);
  if (!bridge) {
    return { ok: false, error: `No bridged session found for checkout: ${checkoutId}` };
  }
  if (bridge.status !== 'NEGOTIATING') {
    return { ok: false, error: `Bridge is in ${bridge.status} state, cannot negotiate` };
  }

  // 2. Get HNP session
  const hnpSession = hnpSessions.get(bridge.hnp_session_id);
  if (!hnpSession) {
    return { ok: false, error: `HNP session not found: ${bridge.hnp_session_id}` };
  }

  // 3. Build incoming offer message
  const senderRole = hnpSession.role === 'BUYER' ? 'SELLER' : 'BUYER';
  const incomingOffer: HnpMessage = {
    session_id: hnpSession.session_id,
    round: hnpSession.current_round + 1,
    type: hnpSession.current_round === 0 ? 'OFFER' : 'COUNTER',
    price: minorUnitsToDollars(offerPrice),
    sender_role: senderRole,
    timestamp: Date.now(),
  };

  // 4. Convert roundData price to dollars for engine
  const engineRoundData: RoundData = {
    ...roundData,
    p_effective: minorUnitsToDollars(offerPrice),
  };

  // 5. Execute round through engine
  const roundResult = executeRound(hnpSession, strategy, incomingOffer, engineRoundData);

  // 6. Update HNP session in store
  hnpSessions.set(bridge.hnp_session_id, roundResult.session);

  // 7. Map decision to extension + bridge status
  const decision = roundResult.decision;
  let negStatus: NegotiationExtensionStatus = 'active';
  let bridgeStatus: BridgedSessionStatus = 'NEGOTIATING';
  let negotiatedPrice: number | null = null;

  if (decision === 'ACCEPT') {
    negStatus = 'agreed';
    bridgeStatus = 'AGREED';
    negotiatedPrice = offerPrice;
  } else if (decision === 'REJECT') {
    negStatus = 'rejected';
    bridgeStatus = 'CANCELLED';
  }

  // 8. Build updated extension
  const counterOfferMinor = roundResult.message.price
    ? dollarsToMinorUnits(roundResult.message.price)
    : null;

  const updatedExt: HaggleNegotiationExtension = {
    session_id: bridge.hnp_session_id,
    status: negStatus,
    original_price: bridge.listing_price,
    current_offer: offerPrice,
    counter_offer: decision === 'COUNTER' || decision === 'NEAR_DEAL'
      ? counterOfferMinor
      : null,
    round: roundResult.session.current_round,
    role: hnpSession.role,
    utility_score: roundResult.utility.u_total,
    decision,
    constraints: {
      price_floor: dollarsToMinorUnits(strategy.p_limit),
      price_ceiling: dollarsToMinorUnits(
        hnpSession.role === 'BUYER' ? strategy.p_limit : strategy.p_target,
      ),
      deadline: new Date(hnpSession.created_at + strategy.t_deadline * 1000).toISOString(),
    },
  };

  // 9. Update checkout session
  const checkoutUpdates: Partial<CheckoutSession> = {
    extensions: {
      [NEGOTIATION_EXTENSION_KEY]: updatedExt,
    },
  };

  // If accepted, update price in totals and mark ready
  if (decision === 'ACCEPT') {
    const lineItems = checkoutStore.get(checkoutId)?.line_items ?? [];
    if (lineItems.length > 0) {
      const updatedLineItems = [...lineItems];
      updatedLineItems[0] = {
        ...updatedLineItems[0],
        totals: [
          { type: 'subtotal', amount: negotiatedPrice! },
          { type: 'total', amount: negotiatedPrice! },
        ],
      };
      checkoutUpdates.line_items = updatedLineItems;
      checkoutUpdates.totals = [
        { type: 'subtotal', amount: negotiatedPrice! },
        { type: 'total', amount: negotiatedPrice! },
      ];
    }
  }

  checkoutStore.update(checkoutId, checkoutUpdates);

  // If rejected, cancel checkout
  if (decision === 'REJECT') {
    checkoutStore.update(checkoutId, { status: 'canceled' });
  }

  // If accepted, mark checkout ready
  if (decision === 'ACCEPT') {
    markCheckoutReady(checkoutStore, checkoutId);
  }

  // 10. If escalation, transition checkout
  if (decision === 'ESCALATE') {
    const next = transitionCheckout('incomplete', 'escalate');
    if (next) {
      checkoutStore.update(checkoutId, { status: next });
    }
  }

  // 11. Update bridge
  bridgeStore.update(bridge.id, {
    status: bridgeStatus,
    negotiated_price: negotiatedPrice,
  });

  const finalCheckout = checkoutStore.get(checkoutId)!;
  const finalBridge = bridgeStore.get(bridge.id)!;

  return {
    ok: true,
    roundResult,
    checkout: finalCheckout,
    bridge: finalBridge,
  };
}

// --- Map HNP session status to bridge status ---

export function mapHnpStatusToBridge(
  hnpStatus: string,
): BridgedSessionStatus {
  switch (hnpStatus) {
    case 'CREATED':
    case 'ACTIVE':
    case 'NEAR_DEAL':
    case 'STALLED':
    case 'WAITING':
      return 'NEGOTIATING';
    case 'ACCEPTED':
      return 'AGREED';
    case 'REJECTED':
    case 'SUPERSEDED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'NEGOTIATING';
  }
}
