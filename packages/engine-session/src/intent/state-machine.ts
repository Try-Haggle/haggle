import type { IntentStatus } from './types.js';

/** Events that trigger intent state transitions. */
export type IntentEvent =
  | "MATCH"
  | "FULFILL"
  | "EXPIRE"
  | "CANCEL"
  | "REMATCH";

/** Terminal states that do not accept any transitions. */
const TERMINAL_STATES: ReadonlySet<IntentStatus> = new Set([
  'FULFILLED',
  'EXPIRED',
  'CANCELLED',
]);

/**
 * Valid state transitions map.
 * Key: current status -> Map of event -> next status.
 */
const VALID_TRANSITIONS: Record<IntentStatus, Partial<Record<IntentEvent, IntentStatus>>> = {
  ACTIVE:    { MATCH: "MATCHED", EXPIRE: "EXPIRED", CANCEL: "CANCELLED" },
  MATCHED:   { FULFILL: "FULFILLED", REMATCH: "ACTIVE", CANCEL: "CANCELLED" },
  FULFILLED: {},
  EXPIRED:   {},
  CANCELLED: {},
};

/**
 * Attempt a state transition. Returns the new status if valid, or null if the
 * transition is not allowed.
 */
export function transitionIntent(current: IntentStatus, event: IntentEvent): IntentStatus | null {
  if (TERMINAL_STATES.has(current)) {
    return null;
  }
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed) {
    return null;
  }
  return allowed[event] ?? null;
}
