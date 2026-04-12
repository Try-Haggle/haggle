import type { NegotiationSession } from '../session/types.js';
import { transition } from '../session/state-machine.js';

/** Snapshot of the expired hold for audit trail. */
export interface HoldSnapshot {
  hold_kind: 'SOFT_HOLD' | 'SELLER_RESERVED';
  held_price_minor: number;
  expired_at: number;
}

/** Result of processing a hold expiration event. */
export interface HoldExpiredResult {
  session: NegotiationSession;
  reprice_required: boolean;
  previous_hold_price_minor?: number;
}

/**
 * Handle a hold expiration event on a negotiation session.
 *
 * - Transitions session state via state machine (ACTIVE/NEAR_DEAL → ACTIVE)
 * - Returns reprice_required=true for SOFT_HOLD (price may have changed)
 * - Returns reprice_required=false for SELLER_RESERVED (price was locked)
 * - If transition is invalid (terminal state), returns session unchanged with no reprice
 */
export function handleHoldExpired(
  session: NegotiationSession,
  expiredHold: HoldSnapshot,
): HoldExpiredResult {
  const newStatus = transition(session.status, 'hold_expired');

  if (newStatus === null) {
    // Cannot transition — session is in terminal state
    return {
      session,
      reprice_required: false,
    };
  }

  const updatedSession: NegotiationSession = {
    ...session,
    status: newStatus,
    updated_at: Date.now(),
  };

  const repriceRequired = expiredHold.hold_kind === 'SOFT_HOLD';

  return {
    session: updatedSession,
    reprice_required: repriceRequired,
    previous_hold_price_minor: expiredHold.held_price_minor,
  };
}
