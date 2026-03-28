// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewerTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";

export const TIER_WEIGHTS: Record<ReviewerTier, number> = {
  BRONZE: 0.75,
  SILVER: 0.90,
  GOLD: 1.05,
  PLATINUM: 1.20,
  DIAMOND: 1.40,
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
  /** True if K-Means fallback was used due to agreement failure. */
  fallback_used: boolean;
  /** K-Means cluster info, only present when fallback_used is true. */
  clusters?: KMeansCluster[];
}

// -- K-Means types --
export interface KMeansCluster {
  centroid: number;
  member_count: number;
  total_weight: number;
  is_majority: boolean;
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
    fallback_used: false,
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

  // Polarization check: even if zone ratio is OK, if no votes are near
  // the center (within ±15 points), the distribution is bimodal → "failed"
  const CENTER_BAND = 15;
  const centerLow = Math.max(0, center - CENTER_BAND);
  const centerHigh = Math.min(100, center + CENTER_BAND);
  let centerWeight = 0;
  for (const v of votes) {
    if (v.value >= centerLow && v.value <= centerHigh) {
      centerWeight += getWeight(v);
    }
  }
  const centerDensity = centerWeight / totalWeight;

  let strength: AgreementStrength;
  if (centerDensity < 0.10) {
    // Bimodal: less than 10% of weight near center → polarized, force failed
    strength = "failed";
  } else if (agreementRatio >= 0.75) strength = "strong";
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

// ---------------------------------------------------------------------------
// K-Means Fallback (deterministic, seeded PRNG)
// ---------------------------------------------------------------------------

/**
 * Seeded PRNG (Mulberry32). Deterministic: same seed = same sequence.
 * Used to make K-Means initialization reproducible.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simple string hash → integer seed.
 * Used to derive a deterministic seed from dispute_id.
 */
export function hashToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash;
}

interface WeightedPoint {
  value: number;
  weight: number;
  index: number;
}

/**
 * Deterministic K-Means clustering (K=2) for polarized vote detection.
 *
 * Used only when Trimmed Mean agreement fails (ratio < 0.45).
 * Seed is derived from dispute_id for reproducibility.
 */
function kMeans2(
  points: WeightedPoint[],
  seed: number,
  maxIter: number = 50,
): { clusters: [WeightedPoint[], WeightedPoint[]]; centroids: [number, number] } {
  const rng = mulberry32(seed);

  // Initialize centroids: pick two distinct random points
  let c1 = points[Math.floor(rng() * points.length)].value;
  let c2 = c1;
  let attempts = 0;
  while (c2 === c1 && attempts < 20) {
    c2 = points[Math.floor(rng() * points.length)].value;
    attempts++;
  }
  // If all identical, just split at midpoint
  if (c1 === c2) {
    c1 = Math.max(0, c1 - 1);
    c2 = Math.min(100, c2 + 1);
  }
  // Ensure c1 < c2
  if (c1 > c2) [c1, c2] = [c2, c1];

  for (let iter = 0; iter < maxIter; iter++) {
    const g1: WeightedPoint[] = [];
    const g2: WeightedPoint[] = [];

    for (const p of points) {
      if (Math.abs(p.value - c1) <= Math.abs(p.value - c2)) {
        g1.push(p);
      } else {
        g2.push(p);
      }
    }

    // Weighted centroids
    const w1 = g1.reduce((s, p) => s + p.weight, 0);
    const w2 = g2.reduce((s, p) => s + p.weight, 0);
    const nc1 = w1 > 0 ? g1.reduce((s, p) => s + p.value * p.weight, 0) / w1 : c1;
    const nc2 = w2 > 0 ? g2.reduce((s, p) => s + p.value * p.weight, 0) / w2 : c2;

    if (Math.abs(nc1 - c1) < 0.01 && Math.abs(nc2 - c2) < 0.01) {
      return { clusters: [g1, g2], centroids: [nc1, nc2] };
    }
    c1 = nc1;
    c2 = nc2;
  }

  // Final assignment
  const g1: WeightedPoint[] = [];
  const g2: WeightedPoint[] = [];
  for (const p of points) {
    if (Math.abs(p.value - c1) <= Math.abs(p.value - c2)) {
      g1.push(p);
    } else {
      g2.push(p);
    }
  }

  return { clusters: [g1, g2], centroids: [c1, c2] };
}

/**
 * Run K-Means fallback on a set of votes.
 * Returns the majority cluster's centroid as the result.
 */
function runKMeansFallback(
  votes: ReviewerVote[],
  seed: number,
): { result: number; clusters: KMeansCluster[]; agreement: AgreementZone } {
  const points: WeightedPoint[] = votes.map((v, i) => ({
    value: v.value,
    weight: getWeight(v),
    index: i,
  }));

  const { clusters, centroids } = kMeans2(points, seed);

  const w0 = clusters[0].reduce((s, p) => s + p.weight, 0);
  const w1 = clusters[1].reduce((s, p) => s + p.weight, 0);
  const majorIdx = w0 >= w1 ? 0 : 1;

  const kmClusters: KMeansCluster[] = clusters.map((c, i) => ({
    centroid: Math.round(centroids[i] * 100) / 100,
    member_count: c.length,
    total_weight: Math.round(c.reduce((s, p) => s + p.weight, 0) * 100) / 100,
    is_majority: i === majorIdx,
  }));

  const majorCentroid = centroids[majorIdx];
  const result = roundTo5(majorCentroid);

  // Recompute agreement zone around K-Means result
  const agreement = computeAgreementZone(votes, majorCentroid);

  return { result, clusters: kmClusters, agreement };
}

/**
 * Aggregate large panel votes with K-Means fallback.
 *
 * 1. Run Trimmed Mean → Agreement Zone
 * 2. If agreement.strength === "failed" (ratio < 0.45): run K-Means fallback
 * 3. K-Means uses seed derived from dispute_id for deterministic results
 *
 * @param votes Reviewer votes
 * @param dispute_id Used to seed K-Means PRNG (deterministic)
 * @param trimPct Trim percentage (default 0.20)
 */
export function aggregateWithFallback(
  votes: ReviewerVote[],
  dispute_id: string,
  trimPct: number = 0.2,
): LargePanelResult {
  const primary = aggregateLargePanel(votes, trimPct);

  if (primary.agreement.strength !== "failed") {
    return primary;
  }

  // Fallback: K-Means with deterministic seed
  const seed = hashToSeed(dispute_id);
  const fallback = runKMeansFallback(votes, seed);

  return {
    ...primary,
    result: fallback.result,
    agreement: fallback.agreement,
    fallback_used: true,
    clusters: fallback.clusters,
  };
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
