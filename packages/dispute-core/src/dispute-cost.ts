import type { DisputeTier, DisputeCostResult, Tier3DiscountResult } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tier 1 rate */
const TIER1_RATE = 0.005; // 0.5%

/** Tier 1 minimum in cents */
const TIER1_MIN_CENTS = 300; // $3

/** Tier 2 rate */
const TIER2_RATE = 0.02; // 2%

/** Tier 2 minimum in cents */
const TIER2_MIN_CENTS = 1_200; // $12

/** Tier 3 rate */
const TIER3_RATE = 0.05; // 5%

/** Tier 3 minimum in cents */
const TIER3_MIN_CENTS = 3_000; // $30

/** Escalation period boundaries (amount in cents → hours) */
const ESCALATION_BOUNDARIES: { up_to_cents: number; hours: number }[] = [
  { up_to_cents:   50_000, hours: 24 },  // ≤$500
  { up_to_cents:  300_000, hours: 48 },  // $500-$3K
  { up_to_cents: Infinity, hours: 72 },  // >$3K
];

/** Reviewer count lookup (amount in cents → [tier2, tier3]) */
const REVIEWER_COUNT_BOUNDARIES: { up_to_cents: number; tier2: number; tier3: number }[] = [
  { up_to_cents:    50_000, tier2:  5, tier3:  7 },  // ~$500
  { up_to_cents:   100_000, tier2:  7, tier3:  9 },  // $500-$1K
  { up_to_cents:   200_000, tier2:  7, tier3:  9 },  // $1K-$2K
  { up_to_cents:   500_000, tier2:  9, tier3: 11 },  // $2K-$5K
  { up_to_cents: 1_000_000, tier2: 11, tier3: 13 },  // $5K-$10K
  { up_to_cents: 1_500_000, tier2: 11, tier3: 13 },  // $10K-$15K
  { up_to_cents: 2_500_000, tier2: 15, tier3: 15 },  // $15K-$25K
  { up_to_cents: 3_000_000, tier2: 15, tier3: 19 },  // $25K-$30K
  { up_to_cents: 5_000_000, tier2: 21, tier3: 19 },  // $30K-$50K
  { up_to_cents:10_000_000, tier2: 29, tier3: 25 },  // $50K-$100K
  { up_to_cents: Infinity,  tier2: 29, tier3: 33 },  // $100K+
];

// ---------------------------------------------------------------------------
// Public Functions
// ---------------------------------------------------------------------------

/**
 * Compute the dispute cost for a given transaction amount and tier.
 *
 * Formula: max(amount × rate, minimum)
 *   T1: max(amount × 0.5%, $3)
 *   T2: max(amount × 2%, $12)
 *   T3: max(amount × 5%, $30)
 *
 * @param amount_cents - Transaction amount in cents (minor units)
 * @param tier - Dispute tier (1, 2, or 3)
 * @returns DisputeCostResult with cost, reviewer count, and escalation period
 */
export function computeDisputeCost(amount_cents: number, tier: DisputeTier): DisputeCostResult {
  if (amount_cents <= 0) {
    throw new Error("amount_cents must be positive");
  }

  const escalation_period_hours = getEscalationPeriod(amount_cents);

  switch (tier) {
    case 1: {
      const cost_cents = Math.max(Math.round(amount_cents * TIER1_RATE), TIER1_MIN_CENTS);
      return {
        tier: 1,
        cost_cents,
        reviewer_count: null,
        escalation_period_hours,
      };
    }
    case 2: {
      const cost_cents = Math.max(Math.round(amount_cents * TIER2_RATE), TIER2_MIN_CENTS);
      const reviewer_count = getReviewerCount(amount_cents, 2);
      return { tier: 2, cost_cents, reviewer_count, escalation_period_hours };
    }
    case 3: {
      const cost_cents = Math.max(Math.round(amount_cents * TIER3_RATE), TIER3_MIN_CENTS);
      const reviewer_count = getReviewerCount(amount_cents, 3);
      return { tier: 3, cost_cents, reviewer_count, escalation_period_hours };
    }
  }
}

/**
 * Get the escalation period in hours based on the transaction amount.
 *
 * @param amount_cents - Transaction amount in cents
 * @returns Escalation period in hours (24, 48, or 72)
 */
export function getEscalationPeriod(amount_cents: number): number {
  for (const boundary of ESCALATION_BOUNDARIES) {
    if (amount_cents <= boundary.up_to_cents) {
      return boundary.hours;
    }
  }
  return 72; // fallback
}

/**
 * Get the reviewer count for Tier 2 or Tier 3 disputes based on amount.
 *
 * @param amount_cents - Transaction amount in cents
 * @param tier - Either 2 or 3
 * @returns Number of reviewers required
 */
export function getReviewerCount(amount_cents: number, tier: 2 | 3): number {
  for (const boundary of REVIEWER_COUNT_BOUNDARIES) {
    if (amount_cents <= boundary.up_to_cents) {
      return tier === 2 ? boundary.tier2 : boundary.tier3;
    }
  }
  // fallback to largest
  const last = REVIEWER_COUNT_BOUNDARIES[REVIEWER_COUNT_BOUNDARIES.length - 1];
  return tier === 2 ? last.tier2 : last.tier3;
}

/**
 * Compute the Tier 3 discount based on the Tier 2 result margin.
 *
 * - Exact tie (margin 0): free Tier 2 re-review (cost = 0)
 * - 1-vote margin: 75% of base cost
 * - 2-vote margin: 90% of base cost
 * - 3+ vote margin: full price (100%)
 *
 * @param tier2_margin - Absolute margin (vote difference) from Tier 2
 * @param base_cost_cents - The base Tier 3 cost before discount
 * @returns Tier3DiscountResult with discounted cost and metadata
 */
export function computeTier3Discount(
  tier2_margin: number,
  base_cost_cents: number,
): Tier3DiscountResult {
  if (tier2_margin < 0) {
    throw new Error("tier2_margin must be non-negative");
  }
  if (base_cost_cents < 0) {
    throw new Error("base_cost_cents must be non-negative");
  }

  if (tier2_margin === 0) {
    return {
      original_cost_cents: base_cost_cents,
      discounted_cost_cents: 0,
      discount_pct: 100,
      is_free_rereview: true,
    };
  }

  let discount_pct: number;
  if (tier2_margin === 1) {
    discount_pct = 25; // pay 75%
  } else if (tier2_margin === 2) {
    discount_pct = 10; // pay 90%
  } else {
    discount_pct = 0; // full price
  }

  const discounted_cost_cents = Math.round(base_cost_cents * (1 - discount_pct / 100));

  return {
    original_cost_cents: base_cost_cents,
    discounted_cost_cents,
    discount_pct,
    is_free_rereview: false,
  };
}
