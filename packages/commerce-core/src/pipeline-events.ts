/**
 * Pipeline event and action types for orchestrating the full
 * intent → session → approval → payment → delivery lifecycle.
 *
 * Pure type definitions — no runtime logic.
 */

// ─── Pipeline Events ────────────────────────────────────

export type PipelineEvent =
  | { type: 'intent.matched'; intentId: string; listingId: string; utotal: number }
  | { type: 'session.accepted'; sessionId: string; agreedPriceMinor: number; buyerId: string; sellerId: string }
  | { type: 'approval.approved'; sessionId: string; settlementId: string }
  | { type: 'payment.settled'; sessionId: string; paymentId: string; amountMinor: number }
  | { type: 'hold.expired'; sessionId: string; holdKind: 'SOFT_HOLD' | 'SELLER_RESERVED'; heldPriceMinor: number }
  | { type: 'session.terminal'; sessionId: string; terminalStatus: 'REJECTED' | 'EXPIRED' | 'SUPERSEDED'; intentId?: string; rematchCount?: number };

// ─── Pipeline Actions ───────────────────────────────────

export type PipelineAction =
  | { action: 'create_session'; intentId: string; listingId: string }
  | { action: 'create_settlement'; sessionId: string; agreedPriceMinor: number; buyerId: string; sellerId: string }
  | { action: 'create_payment_intent'; sessionId: string; settlementId: string }
  | { action: 'rematch_intent'; intentId: string; previousSessionId: string }
  | { action: 'reprice_session'; sessionId: string; previousPriceMinor: number }
  | { action: 'no_action'; reason: string };

// ─── Pipeline Context ───────────────────────────────────

/** Minimal context needed by the pipeline router to make decisions. */
export interface PipelineContext {
  /** Whether rematch is allowed for terminal sessions. */
  rematchEnabled: boolean;
  /** Maximum rematch attempts. */
  maxRematchCount: number;
}

export function defaultPipelineContext(): PipelineContext {
  return {
    rematchEnabled: true,
    maxRematchCount: 3,
  };
}
