import type {
  DisputeCostResult,
  DisputeTier,
  ProgressiveBreakdown,
  ReviewerCountBracket,
  Tier3DiscountResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Tier 2 Progressive Rate Brackets (amount in cents)
// ---------------------------------------------------------------------------

const TIER2_BRACKETS = [
  { max_cents: 50_000,     rate: 0.012 },   // first $500: 1.2%
  { max_cents: 100_000,    rate: 0.007 },   // $500-1K: 0.7%
  { max_cents: 500_000,    rate: 0.003 },   // $1K-5K: 0.3%
  { max_cents: Infinity,   rate: 0.0015 },  // $5K+: 0.15%
];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER1_FIXED_CENTS = 500;       // $5
const TIER2_MIN_CENTS = 2_000;       // $20
const TIER3_RATE = 0.06;             // 6%
const TIER3_MIN_CENTS = 4_000;       // $40

// ---------------------------------------------------------------------------
// Reviewer count brackets
// ---------------------------------------------------------------------------

const REVIEWER_BRACKETS: ReviewerCountBracket[] = [
  { max_cents:    50_000, tier2:  9, tier3:  15 },
  { max_cents:   100_000, tier2: 11, tier3:  19 },
  { max_cents:   300_000, tier2: 13, tier3:  23 },
  { max_cents:   500_000, tier2: 15, tier3:  27 },
  { max_cents: 1_000_000, tier2: 19, tier3:  33 },
  { max_cents: 2_500_000, tier2: 25, tier3:  43 },
  { max_cents: 5_000_000, tier2: 35, tier3:  61 },
  { max_cents:  Infinity, tier2: 51, tier3:  91 },
];

// ---------------------------------------------------------------------------
// computeDisputeCost
// ---------------------------------------------------------------------------

export function computeDisputeCost(
  amount_cents: number,
  tier: DisputeTier,
): DisputeCostResult {
  if (tier === 1) {
    return { tier: 1, cost_cents: TIER1_FIXED_CENTS };
  }

  if (tier === 2) {
    return computeTier2Cost(amount_cents);
  }

  // Tier 3
  const raw = Math.round(amount_cents * TIER3_RATE);
  const cost_cents = Math.max(raw, TIER3_MIN_CENTS);
  return { tier: 3, cost_cents };
}

// ---------------------------------------------------------------------------
// Tier 2 progressive calculation
// ---------------------------------------------------------------------------

function computeTier2Cost(amount_cents: number): DisputeCostResult {
  const breakdown: ProgressiveBreakdown[] = [];
  let remaining = amount_cents;
  let prev_max = 0;
  let total = 0;

  for (const bracket of TIER2_BRACKETS) {
    if (remaining <= 0) break;

    const bracket_size = bracket.max_cents === Infinity
      ? remaining
      : bracket.max_cents - prev_max;

    const applicable = Math.min(remaining, bracket_size);
    const cost = Math.round(applicable * bracket.rate);

    breakdown.push({
      range_label: `${formatDollars(prev_max)}-${bracket.max_cents === Infinity ? "∞" : formatDollars(bracket.max_cents)}`,
      amount_cents: applicable,
      rate: bracket.rate,
      cost_cents: cost,
    });

    total += cost;
    remaining -= applicable;
    prev_max = bracket.max_cents;
  }

  const cost_cents = Math.max(total, TIER2_MIN_CENTS);

  return { tier: 2, cost_cents, breakdown };
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ---------------------------------------------------------------------------
// getEscalationPeriod — returns hours
// ---------------------------------------------------------------------------

export function getEscalationPeriod(amount_cents: number): number {
  if (amount_cents <= 50_000) return 24;    // ≤$500
  if (amount_cents <= 300_000) return 48;   // $500-$3K
  return 72;                                 // >$3K
}

// ---------------------------------------------------------------------------
// getReviewerCount
// ---------------------------------------------------------------------------

export function getReviewerCount(amount_cents: number, tier: 2 | 3): number {
  for (const bracket of REVIEWER_BRACKETS) {
    if (amount_cents <= bracket.max_cents) {
      return tier === 2 ? bracket.tier2 : bracket.tier3;
    }
  }
  // Fallback (shouldn't reach here due to Infinity)
  const last = REVIEWER_BRACKETS[REVIEWER_BRACKETS.length - 1];
  return tier === 2 ? last.tier2 : last.tier3;
}

// ---------------------------------------------------------------------------
// computeTier3Discount — discount based on Tier 2 vote margin
// ---------------------------------------------------------------------------

export function computeTier3Discount(
  tier2_margin: number,
  base_cost_cents: number,
): Tier3DiscountResult {
  // Exact tie → free re-review
  if (tier2_margin === 0) {
    return {
      original_cost_cents: base_cost_cents,
      discount_rate: 1.0,
      final_cost_cents: 0,
      is_re_review: true,
    };
  }

  // 1-vote margin → 75%
  if (tier2_margin === 1) {
    return {
      original_cost_cents: base_cost_cents,
      discount_rate: 0.25,
      final_cost_cents: Math.round(base_cost_cents * 0.75),
      is_re_review: false,
    };
  }

  // 2-vote margin → 90%
  if (tier2_margin === 2) {
    return {
      original_cost_cents: base_cost_cents,
      discount_rate: 0.10,
      final_cost_cents: Math.round(base_cost_cents * 0.90),
      is_re_review: false,
    };
  }

  // 3+ vote margin → full price
  return {
    original_cost_cents: base_cost_cents,
    discount_rate: 0,
    final_cost_cents: base_cost_cents,
    is_re_review: false,
  };
}
