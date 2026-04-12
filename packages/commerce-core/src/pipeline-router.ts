/**
 * Pipeline Router — pure function mapping PipelineEvent → PipelineAction.
 *
 * Maps lifecycle events to the appropriate next action in the
 * intent → session → settlement → payment pipeline.
 *
 * No side effects. Deterministic. Testable.
 */

import type { PipelineEvent, PipelineAction, PipelineContext } from './pipeline-events.js';

/**
 * Route a pipeline event to its corresponding action.
 *
 * Mapping:
 * - intent.matched     → create_session
 * - session.accepted    → create_settlement
 * - approval.approved   → create_payment_intent
 * - hold.expired        → reprice_session
 * - session.terminal    → rematch_intent (if eligible) or no_action
 * - payment.settled     → no_action (terminal success)
 */
export function routePipelineEvent(
  event: PipelineEvent,
  context: PipelineContext,
): PipelineAction {
  switch (event.type) {
    case 'intent.matched':
      return {
        action: 'create_session',
        intentId: event.intentId,
        listingId: event.listingId,
      };

    case 'session.accepted':
      return {
        action: 'create_settlement',
        sessionId: event.sessionId,
        agreedPriceMinor: event.agreedPriceMinor,
        buyerId: event.buyerId,
        sellerId: event.sellerId,
      };

    case 'approval.approved':
      return {
        action: 'create_payment_intent',
        sessionId: event.sessionId,
        settlementId: event.settlementId,
      };

    case 'hold.expired':
      if (event.holdKind === 'SOFT_HOLD') {
        return {
          action: 'reprice_session',
          sessionId: event.sessionId,
          previousPriceMinor: event.heldPriceMinor,
        };
      }
      // SELLER_RESERVED hold expiry: no reprice needed, seller locked the price
      return {
        action: 'no_action',
        reason: 'SELLER_RESERVED hold expired — price was locked',
      };

    case 'session.terminal':
      return routeTerminalSession(event, context);

    case 'payment.settled':
      return {
        action: 'no_action',
        reason: 'payment settled — pipeline complete',
      };
  }
}

function routeTerminalSession(
  event: Extract<PipelineEvent, { type: 'session.terminal' }>,
  context: PipelineContext,
): PipelineAction {
  if (!context.rematchEnabled) {
    return { action: 'no_action', reason: 'rematch disabled' };
  }

  if (!event.intentId) {
    return { action: 'no_action', reason: 'no intent associated with session' };
  }

  const rematchCount = event.rematchCount ?? 0;
  if (rematchCount >= context.maxRematchCount) {
    return { action: 'no_action', reason: `max rematch count (${context.maxRematchCount}) reached` };
  }

  // SUPERSEDED sessions always eligible for rematch
  // REJECTED and EXPIRED checked against policy (handled by caller/context)
  return {
    action: 'rematch_intent',
    intentId: event.intentId,
    previousSessionId: event.sessionId,
  };
}
