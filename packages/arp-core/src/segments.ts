import type { AmountTier, Category, SegmentData, SegmentKey } from "./types.js";
import {
  AMOUNT_TIER_BOUNDARIES,
  COLD_START_BY_AMOUNT,
  COLD_START_BY_CATEGORY,
  DEFAULT_ARP_CONFIG,
} from "./types.js";

// ---------------------------------------------------------------------------
// classifyAmountTier
// ---------------------------------------------------------------------------

const TIER_ORDER: AmountTier[] = ["MICRO", "LOW", "MID", "HIGH", "PREMIUM", "ULTRA"];

export function classifyAmountTier(amount_minor: number): AmountTier {
  for (const tier of TIER_ORDER) {
    const { min_minor, max_minor } = AMOUNT_TIER_BOUNDARIES[tier];
    if (amount_minor >= min_minor && amount_minor <= max_minor) {
      return tier;
    }
  }
  // Below minimum ($10) → MICRO
  if (amount_minor < AMOUNT_TIER_BOUNDARIES.MICRO.min_minor) return "MICRO";
  return "ULTRA";
}

// ---------------------------------------------------------------------------
// getColdStartHours — Math.max(category, amount) for buyer protection
// ---------------------------------------------------------------------------

export function getColdStartHours(category: Category, amount_tier: AmountTier): number {
  const byCategory = COLD_START_BY_CATEGORY[category];
  const byAmount = COLD_START_BY_AMOUNT[amount_tier];
  return Math.max(byCategory, byAmount);
}

// ---------------------------------------------------------------------------
// resolveSegment — find matching segment from data store
// ---------------------------------------------------------------------------

function keyMatches(data: SegmentKey, query: SegmentKey): boolean {
  if (query.category !== undefined && data.category !== query.category) return false;
  if (query.amount_tier !== undefined && data.amount_tier !== query.amount_tier) return false;
  if (query.tag !== undefined && data.tag !== query.tag) return false;
  return true;
}

function keyFieldCount(key: SegmentKey): number {
  let n = 0;
  if (key.category !== undefined) n++;
  if (key.amount_tier !== undefined) n++;
  if (key.tag !== undefined) n++;
  return n;
}

export function resolveSegment(
  query: SegmentKey,
  segments: SegmentData[],
  min_sample: number = DEFAULT_ARP_CONFIG.min_sample_count,
): SegmentData | null {
  // Exact match with sufficient samples
  for (const seg of segments) {
    if (
      seg.sample_count >= min_sample &&
      keyFieldCount(seg.key) === keyFieldCount(query) &&
      keyMatches(seg.key, query)
    ) {
      return seg;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolveReviewHours — 7-level priority fallback + Math.max rule
// ---------------------------------------------------------------------------

export function resolveReviewHours(
  category: Category,
  amount_tier: AmountTier,
  tags: string[],
  segments: SegmentData[],
  min_sample: number = DEFAULT_ARP_CONFIG.min_sample_count,
): number {
  const candidates: number[] = [];

  // For each tag, try all priority levels
  for (const tag of tags) {
    // Priority 1: category × amount × tag
    const p1 = resolveSegment({ category, amount_tier, tag }, segments, min_sample);
    if (p1) { candidates.push(p1.review_hours); continue; }

    // Priority 3: tag × amount (skip to tag-based fallbacks)
    const p3 = resolveSegment({ amount_tier, tag }, segments, min_sample);
    if (p3) { candidates.push(p3.review_hours); continue; }

    // Priority 5: tag alone
    const p5 = resolveSegment({ tag }, segments, min_sample);
    if (p5) { candidates.push(p5.review_hours); }
  }

  // Priority 2: category × amount (no tag)
  const p2 = resolveSegment({ category, amount_tier }, segments, min_sample);
  if (p2) {
    candidates.push(p2.review_hours);
  } else {
    // Priority 4: category alone
    const p4 = resolveSegment({ category }, segments, min_sample);
    if (p4) {
      candidates.push(p4.review_hours);
    } else {
      // Priority 6: amount alone
      const p6 = resolveSegment({ amount_tier }, segments, min_sample);
      if (p6) {
        candidates.push(p6.review_hours);
      }
    }
  }

  // If any segment data found → Math.max (longest protection wins)
  if (candidates.length > 0) {
    return Math.max(...candidates);
  }

  // Priority 7: cold-start default
  return getColdStartHours(category, amount_tier);
}
