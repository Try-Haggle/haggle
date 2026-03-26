// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewerTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";

export const TIER_WEIGHTS: Record<ReviewerTier, number> = {
  BRONZE: 0.63,
  SILVER: 0.85,
  GOLD: 1.10,
  PLATINUM: 1.45,
  DIAMOND: 2.0,
};

export const PANEL_THRESHOLD = 15;

export const SMALL_PANEL_OPTIONS = [0, 25, 50, 75, 100] as const;
export type SmallPanelOption = (typeof SMALL_PANEL_OPTIONS)[number];

/** Bonus multiplier when reviewer's expertise matches the dispute category */
export const EXPERTISE_MATCH_BONUS = 1.3;

export interface ReviewerVote {
  reviewer_id: string;
  tier: ReviewerTier;
  /** 0-100. For small panel, must be one of SMALL_PANEL_OPTIONS */
  value: number;
  weight?: number; // override — bypasses bonus calculation
  /** true if reviewer's expertise matches the dispute category (e.g., electronics expert on electronics dispute) */
  expertise_match?: boolean;
}

export type AgreementStrength = "strong" | "moderate" | "weak" | "failed";

export interface AgreementZone {
  low: number;
  high: number;
  std_dev: number;
  inside_count: number;
  outside_count: number;
  agreement_ratio: number;
  strength: AgreementStrength;
  refined_result: number;
}

// -- Small panel result --
export interface SmallPanelResult {
  mode: "small";
  result: SmallPanelOption;
  winner_weight: number;
  winner_pct: number;
  winner_count: number;
  total_weight: number;
  margin: number;
  strength: AgreementStrength;
  buckets: Record<number, { count: number; weight: number }>;
}

// -- Large panel result --
export interface LargePanelResult {
  mode: "large";
  result: number; // rounded to nearest 5
  raw_mean: number;
  trimmed_low_count: number;
  trimmed_high_count: number;
  included_count: number;
  total_voters: number;
  agreement: AgreementZone;
}

export type VoteAggregationResult = SmallPanelResult | LargePanelResult;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Calculate effective weight for a vote.
 * Final weight = tier_weight × expertise_bonus
 *
 * Tier already reflects reviewer reliability (higher tier = more trusted).
 * If `weight` is explicitly set, it overrides all calculations.
 */
function getWeight(vote: ReviewerVote): number {
  if (vote.weight != null) return vote.weight;

  let w = TIER_WEIGHTS[vote.tier];

  if (vote.expertise_match) {
    w *= EXPERTISE_MATCH_BONUS;
  }

  return w;
}

/** Snap a value to the nearest option in SMALL_PANEL_OPTIONS */
function snapToOption(value: number): SmallPanelOption {
  return SMALL_PANEL_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - value) < Math.abs(best - value) ? opt : best,
  );
}

/** Round to nearest 5 */
function roundTo5(value: number): number {
  return Math.round(value / 5) * 5;
}

// ---------------------------------------------------------------------------
// Small Panel: Weighted Majority (< 15 voters)
// ---------------------------------------------------------------------------

export function aggregateSmallPanel(votes: ReviewerVote[]): SmallPanelResult {
  const buckets: Record<number, { count: number; weight: number }> = {};
  for (const opt of SMALL_PANEL_OPTIONS) {
    buckets[opt] = { count: 0, weight: 0 };
  }

  const totalWeight = votes.reduce((sum, v) => sum + getWeight(v), 0);

  for (const vote of votes) {
    const snapped = snapToOption(vote.value);
    const w = getWeight(vote);
    buckets[snapped].count++;
    buckets[snapped].weight += w;
  }

  // Rank by weight descending
  const ranked = SMALL_PANEL_OPTIONS.map((opt) => ({
    option: opt,
    ...buckets[opt],
    pct: (buckets[opt].weight / totalWeight) * 100,
  })).sort((a, b) => b.weight - a.weight);

  const winner = ranked[0];
  const margin =
    ranked.length > 1 ? winner.pct - ranked[1].pct : 100;

  let strength: AgreementStrength;
  if (winner.pct >= 60) strength = "strong";
  else if (winner.pct >= 45) strength = "moderate";
  else if (winner.pct >= 35) strength = "weak";
  else strength = "failed";

  return {
    mode: "small",
    result: winner.option as SmallPanelOption,
    winner_weight: winner.weight,
    winner_pct: winner.pct,
    winner_count: winner.count,
    total_weight: totalWeight,
    margin,
    strength,
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Large Panel: Trimmed Mean (>= 15 voters)
// ---------------------------------------------------------------------------

export function aggregateLargePanel(
  votes: ReviewerVote[],
  trimPct: number = 0.2,
): LargePanelResult {
  // Sort by value ascending
  const sorted = [...votes].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, v) => sum + getWeight(v), 0);
  const trimWeight = totalWeight * trimPct;

  // Trim low end
  let cumLow = 0;
  const afterLow: ReviewerVote[] = [];
  let trimmedLowCount = 0;
  for (const v of sorted) {
    if (cumLow + getWeight(v) <= trimWeight) {
      cumLow += getWeight(v);
      trimmedLowCount++;
    } else {
      afterLow.push(v);
    }
  }

  // Trim high end
  let cumHigh = 0;
  const included: ReviewerVote[] = [];
  let trimmedHighCount = 0;
  for (const v of [...afterLow].reverse()) {
    if (cumHigh + getWeight(v) <= trimWeight) {
      cumHigh += getWeight(v);
      trimmedHighCount++;
    } else {
      included.push(v);
    }
  }

  // Fallback: if all trimmed, use afterLow
  if (included.length === 0) {
    included.push(...afterLow);
  }

  // Weighted mean of included votes
  const includedWeight = included.reduce((sum, v) => sum + getWeight(v), 0);
  const rawMean =
    included.reduce((sum, v) => sum + v.value * getWeight(v), 0) /
    includedWeight;
  const result = roundTo5(rawMean);

  // Agreement zone: center +/- 1 sigma
  const agreement = computeAgreementZone(votes, rawMean);

  return {
    mode: "large",
    result,
    raw_mean: rawMean,
    trimmed_low_count: trimmedLowCount,
    trimmed_high_count: trimmedHighCount,
    included_count: included.length,
    total_voters: votes.length,
    agreement,
  };
}

// ---------------------------------------------------------------------------
// Agreement Zone (1 sigma)
// ---------------------------------------------------------------------------

function computeAgreementZone(
  votes: ReviewerVote[],
  center: number,
): AgreementZone {
  const totalWeight = votes.reduce((sum, v) => sum + getWeight(v), 0);
  const wVariance =
    votes.reduce(
      (sum, v) => sum + getWeight(v) * (v.value - center) ** 2,
      0,
    ) / totalWeight;
  const stdDev = Math.sqrt(wVariance);

  const low = Math.max(0, center - stdDev);
  const high = Math.min(100, center + stdDev);

  let insideWeight = 0;
  let insideCount = 0;
  let outsideCount = 0;

  for (const v of votes) {
    if (v.value >= low && v.value <= high) {
      insideWeight += getWeight(v);
      insideCount++;
    } else {
      outsideCount++;
    }
  }

  const agreementRatio = insideWeight / totalWeight;

  // Refined result from inside votes only
  let refinedResult = center;
  if (insideCount > 0) {
    const insideVotes = votes.filter(
      (v) => v.value >= low && v.value <= high,
    );
    const iw = insideVotes.reduce((s, v) => s + getWeight(v), 0);
    refinedResult = roundTo5(
      insideVotes.reduce((s, v) => s + v.value * getWeight(v), 0) / iw,
    );
  }

  let strength: AgreementStrength;
  if (agreementRatio >= 0.75) strength = "strong";
  else if (agreementRatio >= 0.6) strength = "moderate";
  else if (agreementRatio >= 0.45) strength = "weak";
  else strength = "failed";

  return {
    low,
    high,
    std_dev: stdDev,
    inside_count: insideCount,
    outside_count: outsideCount,
    agreement_ratio: agreementRatio,
    strength,
    refined_result: refinedResult,
  };
}

// ---------------------------------------------------------------------------
// Main: Auto-select mode based on panel size
// ---------------------------------------------------------------------------

export function aggregateVotes(votes: ReviewerVote[]): VoteAggregationResult {
  if (votes.length === 0) {
    throw new Error("Cannot aggregate zero votes");
  }
  if (votes.length < PANEL_THRESHOLD) {
    return aggregateSmallPanel(votes);
  }
  return aggregateLargePanel(votes);
}

/**
 * Determine which Reviewers are in the majority (inside agreement zone)
 * and therefore eligible for compensation.
 *
 * Small panel: voters who chose the winning option
 * Large panel: voters inside the 1 sigma agreement zone
 */
export function getMajorityReviewers(
  votes: ReviewerVote[],
  result: VoteAggregationResult,
): string[] {
  if (result.mode === "small") {
    return votes
      .filter((v) => snapToOption(v.value) === result.result)
      .map((v) => v.reviewer_id);
  }
  // Large panel: inside agreement zone
  const { low, high } = result.agreement;
  return votes
    .filter((v) => v.value >= low && v.value <= high)
    .map((v) => v.reviewer_id);
}

/**
 * Calculate compensation distribution.
 * 70% of dispute fee goes to majority Reviewers, split equally.
 */
export function calculateCompensation(
  dispute_fee_minor: number,
  majority_reviewer_ids: string[],
): {
  pool_minor: number;
  per_reviewer_minor: number;
  reviewer_count: number;
} {
  const pool = Math.floor(dispute_fee_minor * 0.7);
  const count = majority_reviewer_ids.length;
  const perReviewer = count > 0 ? Math.floor(pool / count) : 0;
  return {
    pool_minor: pool,
    per_reviewer_minor: perReviewer,
    reviewer_count: count,
  };
}
