import { computeUtility } from '@haggle/engine-core';
import type { NegotiationContext } from '@haggle/engine-core';
import type { WaitingIntent, MatchCandidate, MatchResult } from './types.js';

/**
 * Evaluate a single intent against a context (listing data assembled into NegotiationContext).
 */
export function evaluateMatch(
  intent: WaitingIntent,
  context: NegotiationContext,
): MatchCandidate {
  const result = computeUtility(context);
  return {
    intent,
    utotal: result.u_total,
  };
}

/**
 * Evaluate multiple intents against one context (new listing -> find matching buyers).
 * Uses contextBuilder to create a per-intent NegotiationContext.
 */
export function evaluateIntents(
  intents: WaitingIntent[],
  contextBuilder: (intent: WaitingIntent) => NegotiationContext,
): MatchResult {
  const candidates = intents.map(intent => {
    const ctx = contextBuilder(intent);
    return evaluateMatch(intent, ctx);
  });

  const matched = candidates.filter(c =>
    c.utotal >= c.intent.minUtotal &&
    c.intent.currentActiveSessions < c.intent.maxActiveSessions
  );
  const rejected = candidates.filter(c =>
    c.utotal < c.intent.minUtotal ||
    c.intent.currentActiveSessions >= c.intent.maxActiveSessions
  );

  return {
    matched,
    rejected,
    totalEvaluated: candidates.length,
  };
}

/**
 * Bidirectional match: both buyer and seller must meet min_u_total
 * and have session capacity.
 */
export function evaluateBidirectionalMatch(
  buyerIntent: WaitingIntent,
  sellerIntent: WaitingIntent,
  buyerContext: NegotiationContext,
  sellerContext: NegotiationContext,
): { matched: boolean; buyerUtotal: number; sellerUtotal: number } {
  const buyerResult = computeUtility(buyerContext);
  const sellerResult = computeUtility(sellerContext);

  return {
    matched:
      buyerResult.u_total >= buyerIntent.minUtotal &&
      sellerResult.u_total >= sellerIntent.minUtotal &&
      buyerIntent.currentActiveSessions < buyerIntent.maxActiveSessions &&
      sellerIntent.currentActiveSessions < sellerIntent.maxActiveSessions,
    buyerUtotal: buyerResult.u_total,
    sellerUtotal: sellerResult.u_total,
  };
}
