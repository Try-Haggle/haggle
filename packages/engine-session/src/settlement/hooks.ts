/**
 * Settlement Hook System (Section 14)
 *
 * Connects HNP agreement results to external settlement execution.
 * Haggle is non-custodial: funds are never held by the protocol.
 *
 * Responsibilities:
 * - Create settlement conditions from agreed offer
 * - Hash agreement terms for on-chain verification
 * - Track settlement lifecycle (propose → ready → confirmed/failed)
 */

import type {
  SettlementHook,
  SettlementMethod,
  OfferPayload,
  ContingentClause,
  HnpSessionState,
} from '../protocol/hnp-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Settlement condition derived from agreed terms. */
export interface SettlementCondition {
  condition_id: string;
  /** The agreed offer that produced these conditions. */
  agreed_price: number;
  /** Currency code (e.g. "USD"). */
  currency: string;
  /** Rebate amount from triggered clauses. */
  rebate_amount: number;
  /** Final settlement amount (price - rebate). */
  net_amount: number;
  /** Active contingent clauses that may affect settlement. */
  active_clauses: ContingentClause[];
  /** Whether buyer has cancel right. */
  buyer_cancel_right: boolean;
}

/** Settlement lifecycle status. */
export type SettlementStatus =
  | 'PROPOSED'
  | 'READY'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED';

/** A settlement record tracking the full lifecycle. */
export interface SettlementRecord {
  settlement_id: string;
  session_id: string;
  status: SettlementStatus;
  hook: SettlementHook;
  conditions: SettlementCondition;
  created_at: string;
  updated_at: string;
  /** Transaction hash (set on confirmation). */
  tx_hash?: string;
  /** Failure reason (set on failure). */
  failure_reason?: string;
}

/** Events that drive settlement state transitions. */
export type SettlementEvent =
  | 'propose'
  | 'ready'
  | 'confirm'
  | 'fail'
  | 'cancel';

// ---------------------------------------------------------------------------
// Settlement Condition Builder
// ---------------------------------------------------------------------------

/**
 * Build settlement conditions from an agreed offer.
 * Extracts price, applies any rebates, and collects active clauses.
 */
export function buildSettlementConditions(
  conditionId: string,
  offer: OfferPayload,
  rebateAmount: number = 0,
  buyerCancelRight: boolean = false,
): SettlementCondition {
  const price = (offer.issues['price'] as number) ?? 0;
  const netAmount = Math.max(0, price - rebateAmount);

  return {
    condition_id: conditionId,
    agreed_price: price,
    currency: offer.currency,
    rebate_amount: rebateAmount,
    net_amount: netAmount,
    active_clauses: offer.clauses ?? [],
    buyer_cancel_right: buyerCancelRight,
  };
}

// ---------------------------------------------------------------------------
// Settlement Hook Builder
// ---------------------------------------------------------------------------

/**
 * Create a settlement hook for smart contract execution.
 */
export function createSmartContractHook(
  chain: string,
  paymentToken: string,
  agreementHash: string,
  conditionsRef: string,
): SettlementHook {
  return {
    settlement_method: 'smart_contract',
    chain,
    payment_token: paymentToken,
    agreement_hash: agreementHash,
    settlement_conditions_ref: conditionsRef,
  };
}

/**
 * Create a settlement hook for escrow.
 */
export function createEscrowHook(
  paymentToken: string,
  conditionsRef: string,
): SettlementHook {
  return {
    settlement_method: 'escrow',
    payment_token: paymentToken,
    settlement_conditions_ref: conditionsRef,
  };
}

// ---------------------------------------------------------------------------
// Agreement Hashing
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic hash of agreed terms for on-chain verification.
 * Uses a simple but deterministic JSON serialization + basic hash.
 *
 * In production, this would use keccak256 or similar.
 * For now, we use a deterministic string representation.
 */
export function computeAgreementHash(
  sessionId: string,
  offer: OfferPayload,
  conditions: SettlementCondition,
): string {
  const rawPayload = {
    session_id: sessionId,
    issues: offer.issues,
    clauses: offer.clauses ?? [],
    currency: offer.currency,
    net_amount: conditions.net_amount,
    rebate_amount: conditions.rebate_amount,
  };
  const payload = JSON.stringify(sortKeys(rawPayload));

  // Simple deterministic hash (FNV-1a 32-bit)
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return '0x' + (hash >>> 0).toString(16).padStart(8, '0');
}

/** Recursively sort object keys for deterministic serialization. */
function sortKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (typeof obj === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// Settlement State Machine
// ---------------------------------------------------------------------------

const SETTLEMENT_TRANSITIONS: Record<string, Partial<Record<SettlementEvent, SettlementStatus>>> = {
  PROPOSED: {
    ready: 'READY',
    fail: 'FAILED',
    cancel: 'CANCELLED',
  },
  READY: {
    confirm: 'CONFIRMED',
    fail: 'FAILED',
    cancel: 'CANCELLED',
  },
};

const TERMINAL_SETTLEMENT_STATES: ReadonlySet<SettlementStatus> = new Set([
  'CONFIRMED',
  'FAILED',
  'CANCELLED',
]);

/**
 * Attempt a settlement state transition.
 * Returns null if the transition is not valid.
 */
export function transitionSettlement(
  current: SettlementStatus,
  event: SettlementEvent,
): SettlementStatus | null {
  if (TERMINAL_SETTLEMENT_STATES.has(current)) return null;
  return SETTLEMENT_TRANSITIONS[current]?.[event] ?? null;
}

/**
 * Map settlement status to the corresponding HNP session state.
 */
export function settlementToSessionState(
  settlementStatus: SettlementStatus,
): HnpSessionState {
  switch (settlementStatus) {
    case 'PROPOSED':
    case 'READY':
      return 'SETTLEMENT_PENDING';
    case 'CONFIRMED':
      return 'SETTLED';
    case 'FAILED':
      return 'DISPUTED';
    case 'CANCELLED':
      return 'CANCELLED';
  }
}
