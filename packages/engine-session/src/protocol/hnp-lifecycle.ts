/**
 * HNP v2 Session Lifecycle State Machine (Section 5.3)
 *
 * States:
 *   INIT → OPEN → PENDING_RESPONSE ↔ OPEN
 *   OPEN/PENDING_RESPONSE → AGREED → SETTLEMENT_PENDING → SETTLED → CLOSED
 *   Any non-terminal → EXPIRED / CANCELLED / REJECTED
 *   SETTLEMENT_PENDING → DISPUTED → CLOSED
 *
 * This extends the v1 state machine to cover the full HNP lifecycle
 * including settlement, disputes, and clean closure.
 */

import type { HnpSessionState, HnpV2MessageType } from './hnp-types.js';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/** Events that drive HNP v2 lifecycle transitions. */
export type HnpLifecycleEvent =
  // Session setup
  | 'session_create'
  | 'session_accept'
  | 'session_decline'
  | 'session_cancel'
  // Negotiation
  | 'offer'
  | 'counter_offer'
  | 'accept'
  | 'reject'
  | 'withdraw'
  // Settlement
  | 'settlement_propose'
  | 'settlement_ready'
  | 'settlement_confirmed'
  | 'settlement_failed'
  // Lifecycle
  | 'timeout'
  | 'dispute_open'
  | 'dispute_resolved'
  | 'close';

// ---------------------------------------------------------------------------
// Terminal States
// ---------------------------------------------------------------------------

const TERMINAL_STATES: ReadonlySet<HnpSessionState> = new Set([
  'CLOSED',
]);

/** States that no longer accept negotiation events (but may accept settlement/close). */
const FROZEN_STATES: ReadonlySet<HnpSessionState> = new Set([
  'AGREED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'SETTLEMENT_PENDING',
  'SETTLED',
  'DISPUTED',
  'CLOSED',
]);

// ---------------------------------------------------------------------------
// Transition Table
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<string, Partial<Record<HnpLifecycleEvent, HnpSessionState>>> = {
  INIT: {
    session_create: 'OPEN',
    session_decline: 'REJECTED',
    timeout: 'EXPIRED',
  },
  OPEN: {
    offer: 'PENDING_RESPONSE',
    session_cancel: 'CANCELLED',
    timeout: 'EXPIRED',
    withdraw: 'CANCELLED',
  },
  PENDING_RESPONSE: {
    counter_offer: 'OPEN',
    accept: 'AGREED',
    reject: 'REJECTED',
    offer: 'PENDING_RESPONSE',
    session_cancel: 'CANCELLED',
    timeout: 'EXPIRED',
    withdraw: 'CANCELLED',
  },
  AGREED: {
    settlement_propose: 'SETTLEMENT_PENDING',
    session_cancel: 'CANCELLED',
    timeout: 'EXPIRED',
  },
  SETTLEMENT_PENDING: {
    settlement_ready: 'SETTLEMENT_PENDING',
    settlement_confirmed: 'SETTLED',
    settlement_failed: 'DISPUTED',
    session_cancel: 'CANCELLED',
    timeout: 'EXPIRED',
  },
  SETTLED: {
    dispute_open: 'DISPUTED',
    close: 'CLOSED',
  },
  DISPUTED: {
    dispute_resolved: 'SETTLED',
    close: 'CLOSED',
  },
  REJECTED: {
    close: 'CLOSED',
  },
  EXPIRED: {
    close: 'CLOSED',
  },
  CANCELLED: {
    close: 'CLOSED',
  },
};

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Attempt an HNP v2 lifecycle transition.
 * Returns the new state, or null if the transition is invalid.
 */
export function transitionHnp(
  current: HnpSessionState,
  event: HnpLifecycleEvent,
): HnpSessionState | null {
  if (TERMINAL_STATES.has(current)) return null;
  return TRANSITIONS[current]?.[event] ?? null;
}

/**
 * Check if a state is terminal (no further transitions possible).
 */
export function isTerminalState(state: HnpSessionState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if a state is frozen (no negotiation events accepted).
 */
export function isFrozenState(state: HnpSessionState): boolean {
  return FROZEN_STATES.has(state);
}

/**
 * Get all valid events for a given state.
 */
export function getValidEvents(state: HnpSessionState): HnpLifecycleEvent[] {
  if (TERMINAL_STATES.has(state)) return [];
  const transitions = TRANSITIONS[state];
  if (!transitions) return [];
  return Object.keys(transitions) as HnpLifecycleEvent[];
}

/**
 * Map an HNP v2 message type to a lifecycle event.
 */
export function messageToEvent(messageType: HnpV2MessageType): HnpLifecycleEvent | null {
  const mapping: Partial<Record<HnpV2MessageType, HnpLifecycleEvent>> = {
    SESSION_CREATE: 'session_create',
    SESSION_ACCEPT: 'session_accept',
    SESSION_DECLINE: 'session_decline',
    SESSION_CANCEL: 'session_cancel',
    OFFER: 'offer',
    COUNTER_OFFER: 'counter_offer',
    ACCEPT: 'accept',
    REJECT: 'reject',
    WITHDRAW: 'withdraw',
    SETTLEMENT_PROPOSE: 'settlement_propose',
    SETTLEMENT_READY: 'settlement_ready',
    SETTLEMENT_CONFIRMED: 'settlement_confirmed',
    SETTLEMENT_FAILED: 'settlement_failed',
  };
  return mapping[messageType] ?? null;
}
