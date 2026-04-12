import { computeUtility } from '@haggle/engine-core';
import type { NegotiationContext } from '@haggle/engine-core';
import type { WaitingIntent, MatchCandidate, MatchResult } from './types.js';

/** Options for enhanced intent matching with category/keyword filtering. */
export interface MatchOptions {
  listing_category?: string;
  listing_keywords?: string[];
  /** Bonus added to u_total per keyword match (default 0.05). */
  keyword_bonus?: number;
}

const DEFAULT_KEYWORD_BONUS = 0.05;

/**
 * Check if an intent's category matches the listing category.
 * Empty or undefined categories always match.
 */
function categoryMatches(intent: WaitingIntent, listingCategory?: string): boolean {
  if (!listingCategory || !intent.category) return true;
  return intent.category.toLowerCase() === listingCategory.toLowerCase();
}

/**
 * Count how many of the intent's keywords match the listing keywords.
 */
function countKeywordMatches(intent: WaitingIntent, listingKeywords?: string[]): number {
  if (!listingKeywords || listingKeywords.length === 0 || intent.keywords.length === 0) return 0;
  const lowerListing = new Set(listingKeywords.map(k => k.toLowerCase()));
  return intent.keywords.filter(k => lowerListing.has(k.toLowerCase())).length;
}

/**
 * Evaluate a single intent against a context (listing data assembled into NegotiationContext).
 * When options are provided, applies category filtering and keyword bonus.
 */
export function evaluateMatch(
  intent: WaitingIntent,
  context: NegotiationContext,
  options?: MatchOptions,
): MatchCandidate {
  const result = computeUtility(context);
  let utotal = result.u_total;

  if (options) {
    // Category mismatch → set utility to 0 (will be rejected)
    if (!categoryMatches(intent, options.listing_category)) {
      return { intent, utotal: 0 };
    }

    // Keyword bonus
    const matches = countKeywordMatches(intent, options.listing_keywords);
    const bonus = matches * (options.keyword_bonus ?? DEFAULT_KEYWORD_BONUS);
    utotal = Math.min(utotal + bonus, 1);
  }

  return {
    intent,
    utotal,
  };
}

/**
 * Evaluate multiple intents against one context (new listing -> find matching buyers).
 * Uses contextBuilder to create a per-intent NegotiationContext.
 */
export function evaluateIntents(
  intents: WaitingIntent[],
  contextBuilder: (intent: WaitingIntent) => NegotiationContext,
  options?: MatchOptions,
): MatchResult {
  const candidates = intents.map(intent => {
    const ctx = contextBuilder(intent);
    return evaluateMatch(intent, ctx, options);
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
