// ============================================================
// UCP Checkout Session State Machine
// States: incomplete → requires_escalation → ready_for_complete → completed | canceled
// ============================================================

import type { CheckoutStatus } from './types.js';

export type CheckoutEvent =
  | 'update'            // buyer/fulfillment/payment info updated
  | 'escalate'          // needs human intervention
  | 'resolve_escalation' // escalation resolved
  | 'ready'             // all requirements met
  | 'complete'          // payment processed, order created
  | 'cancel';           // session aborted

const TERMINAL_STATES: ReadonlySet<CheckoutStatus> = new Set([
  'completed',
  'canceled',
]);

const TRANSITIONS: Record<string, Partial<Record<CheckoutEvent, CheckoutStatus>>> = {
  incomplete: {
    update: 'incomplete',
    escalate: 'requires_escalation',
    ready: 'ready_for_complete',
    cancel: 'canceled',
  },
  requires_escalation: {
    resolve_escalation: 'incomplete',
    cancel: 'canceled',
  },
  ready_for_complete: {
    update: 'incomplete',    // changing data reverts to incomplete
    complete: 'completed',
    cancel: 'canceled',
  },
};

/**
 * Attempt a checkout state transition.
 * Returns new status if valid, null if transition is not allowed.
 */
export function transitionCheckout(
  current: CheckoutStatus,
  event: CheckoutEvent,
): CheckoutStatus | null {
  if (TERMINAL_STATES.has(current)) {
    return null;
  }
  const allowed = TRANSITIONS[current];
  if (!allowed) {
    return null;
  }
  return allowed[event] ?? null;
}

export function isTerminalCheckoutStatus(status: CheckoutStatus): boolean {
  return TERMINAL_STATES.has(status);
}
