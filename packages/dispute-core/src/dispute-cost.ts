// ---------------------------------------------------------------------------
// Dispute Cost — Tier 1/2/3 fee calculation, escalation periods, reviewer counts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisputeTier = 1 | 2 | 3;

export interface TierCostBreakdown {
  bracket_label: string;
  bracket_amount_minor: number;
  rate: number;
  cost_minor: number;
}

export interface TierCostResult {
  tier: DisputeTier;
  cost_minor: number;
  breakdown: TierCostBreakdown[];
}

// ---------------------------------------------------------------------------
// Tier 1 — Progressive rate, min $1 (100 minor)
// ---------------------------------------------------------------------------

/**
 * Tier 1 progressive rate brackets.
 * Higher amounts use lower marginal rates (diminishing scale).
 *
 * First $1,000:      1.2%
 * $1,001 - $10,000:  0.7%
 * $10,001 - $100,000: 0.3%
 * $100,001+:          0.15%
 * Minimum:            $1 (100 minor)
 */
const TIER1_BRACKETS: { ceiling_minor: number; rate: number; label: string }[] = [
  { ceiling_minor: 100_000, rate: 0.012, label: "~$1,000" },
  { ceiling_minor: 1_000_000, rate: 0.007, label: "$1,001-$10,000" },
  { ceiling_minor: 10_000_000, rate: 0.003, label: "$10,001-$100,000" },
  { ceiling_minor: Infinity, rate: 0.0015, label: "$100,001+" },
];

const TIER1_MIN_MINOR = 100; // $1.00

export function computeTier1Cost(amount_minor: number): TierCostResult {
  if (amount_minor <= 0) {
    return { tier: 1, cost_minor: 0, breakdown: [] };
  }

  let remaining = amount_minor;
  let prevCeiling = 0;
  const breakdown: TierCostBreakdown[] = [];
  let total = 0;

  for (const bracket of TIER1_BRACKETS) {
    if (remaining <= 0) break;

    const bracketSize = bracket.ceiling_minor - prevCeiling;
    const inBracket = Math.min(remaining, bracketSize);
    const cost = Math.round(inBracket * bracket.rate);

    breakdown.push({
      bracket_label: bracket.label,
      bracket_amount_minor: inBracket,
      rate: bracket.rate,
      cost_minor: cost,
    });

    total += cost;
    remaining -= inBracket;
    prevCeiling = bracket.ceiling_minor;
  }

  const cost_minor = Math.max(TIER1_MIN_MINOR, total);

  return { tier: 1, cost_minor, breakdown };
}

// ---------------------------------------------------------------------------
// Tier 2 — 3%, min $20
// ---------------------------------------------------------------------------

const TIER2_RATE = 0.03;
const TIER2_MIN_MINOR = 2_000; // $20.00

export function computeTier2Cost(amount_minor: number): TierCostResult {
  if (amount_minor <= 0) {
    return { tier: 2, cost_minor: 0, breakdown: [] };
  }

  const raw = Math.round(amount_minor * TIER2_RATE);
  const cost_minor = Math.max(TIER2_MIN_MINOR, raw);

  return {
    tier: 2,
    cost_minor,
    breakdown: [
      {
        bracket_label: "3% flat",
        bracket_amount_minor: amount_minor,
        rate: TIER2_RATE,
        cost_minor: raw,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tier 3 — 6%, min $40
// ---------------------------------------------------------------------------

const TIER3_RATE = 0.06;
const TIER3_MIN_MINOR = 4_000; // $40.00

export function computeTier3Cost(amount_minor: number): TierCostResult {
  if (amount_minor <= 0) {
    return { tier: 3, cost_minor: 0, breakdown: [] };
  }

  const raw = Math.round(amount_minor * TIER3_RATE);
  const cost_minor = Math.max(TIER3_MIN_MINOR, raw);

  return {
    tier: 3,
    cost_minor,
    breakdown: [
      {
        bracket_label: "6% flat",
        bracket_amount_minor: amount_minor,
        rate: TIER3_RATE,
        cost_minor: raw,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Combined
// ---------------------------------------------------------------------------

export function computeDisputeCost(
  amount_minor: number,
  tier: DisputeTier,
): TierCostResult {
  switch (tier) {
    case 1:
      return computeTier1Cost(amount_minor);
    case 2:
      return computeTier2Cost(amount_minor);
    case 3:
      return computeTier3Cost(amount_minor);
  }
}

/**
 * Compute worst-case total cost if dispute goes through all 3 tiers.
 * Under deferred settlement, loser forfeits T1 + T2 + T3.
 */
export function computeWorstCaseCost(amount_minor: number): {
  tier1_minor: number;
  tier2_minor: number;
  tier3_minor: number;
  total_minor: number;
} {
  const t1 = computeTier1Cost(amount_minor).cost_minor;
  const t2 = computeTier2Cost(amount_minor).cost_minor;
  const t3 = computeTier3Cost(amount_minor).cost_minor;
  return {
    tier1_minor: t1,
    tier2_minor: t2,
    tier3_minor: t3,
    total_minor: t1 + t2 + t3,
  };
}

// ---------------------------------------------------------------------------
// Escalation periods
// ---------------------------------------------------------------------------

/**
 * Tier 1 → 2: always 24 hours.
 * Tier 2 → 3: amount-based (≤$500: 24h, $501-$5K: 48h, $5K+: 72h).
 */
export function getEscalationPeriodHours(
  from_tier: 1 | 2,
  amount_minor: number,
): number {
  if (from_tier === 1) return 24;

  // from_tier === 2 → 3
  if (amount_minor <= 50_000) return 24; // ≤ $500
  if (amount_minor <= 500_000) return 48; // $501 - $5,000
  return 72; // $5,001+
}

// ---------------------------------------------------------------------------
// Reviewer counts (v8.3)
// ---------------------------------------------------------------------------

interface ReviewerCountTier {
  max_minor: number;
  tier2: number;
  tier3: number;
}

const REVIEWER_COUNTS: ReviewerCountTier[] = [
  { max_minor: 50_000, tier2: 9, tier3: 15 },
  { max_minor: 100_000, tier2: 11, tier3: 19 },
  { max_minor: 300_000, tier2: 13, tier3: 23 },
  { max_minor: 500_000, tier2: 15, tier3: 27 },
  { max_minor: 1_000_000, tier2: 19, tier3: 33 },
  { max_minor: 2_000_000, tier2: 23, tier3: 41 },
  { max_minor: 5_000_000, tier2: 29, tier3: 51 },
  { max_minor: 10_000_000, tier2: 37, tier3: 65 },
  { max_minor: 50_000_000, tier2: 45, tier3: 81 },
  { max_minor: 100_000_000, tier2: 71, tier3: 121 },
  { max_minor: Infinity, tier2: 91, tier3: 151 },
];

export function getReviewerCount(
  amount_minor: number,
  tier: 2 | 3,
): number {
  for (const entry of REVIEWER_COUNTS) {
    if (amount_minor <= entry.max_minor) {
      return tier === 2 ? entry.tier2 : entry.tier3;
    }
  }
  return tier === 2 ? 91 : 151;
}
