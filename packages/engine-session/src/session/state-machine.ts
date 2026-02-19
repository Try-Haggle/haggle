import type { SessionStatus } from './types.js';

/** Events that trigger state transitions. */
export type SessionEvent =
  | 'first_offer'
  | 'counter'
  | 'near_deal'
  | 'stalled'
  | 'timeout'
  | 'strategy_update'
  | 'user_accept'
  | 'user_reject'
  | 'superseded'
  | 'escalate'
  | 'escalation_resolved';

/** Terminal states that do not accept any transitions. */
const TERMINAL_STATES: ReadonlySet<SessionStatus> = new Set([
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'SUPERSEDED',
]);

/**
 * Valid state transitions map.
 * Key: current status → Map of event → next status.
 */
const TRANSITIONS: Record<string, Partial<Record<SessionEvent, SessionStatus>>> = {
  CREATED: {
    first_offer: 'ACTIVE',
    superseded: 'SUPERSEDED',
  },
  ACTIVE: {
    counter: 'ACTIVE',
    near_deal: 'NEAR_DEAL',
    stalled: 'STALLED',
    timeout: 'EXPIRED',
    user_accept: 'ACCEPTED',
    user_reject: 'REJECTED',
    superseded: 'SUPERSEDED',
    escalate: 'WAITING',
  },
  NEAR_DEAL: {
    user_accept: 'ACCEPTED',
    user_reject: 'REJECTED',
    counter: 'ACTIVE',
    timeout: 'EXPIRED',
    superseded: 'SUPERSEDED',
    escalate: 'WAITING',
  },
  STALLED: {
    strategy_update: 'ACTIVE',
    timeout: 'EXPIRED',
    user_reject: 'REJECTED',
    superseded: 'SUPERSEDED',
    escalate: 'WAITING',
  },
  WAITING: {
    escalation_resolved: 'ACTIVE',
    timeout: 'EXPIRED',
    superseded: 'SUPERSEDED',
    user_reject: 'REJECTED',
  },
};

/**
 * Attempt a state transition. Returns the new status if valid, or null if the
 * transition is not allowed.
 */
export function transition(current: SessionStatus, event: SessionEvent): SessionStatus | null {
  if (TERMINAL_STATES.has(current)) {
    return null;
  }
  const allowed = TRANSITIONS[current];
  if (!allowed) {
    return null;
  }
  return allowed[event] ?? null;
}
