import type {
  ReviewerVote,
  AggregationResult,
  AgreementZone,
  KMeansResult,
  KMeansClusterInfo,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Agreement zone radius (plus/minus 15 from median) */
const AGREEMENT_ZONE_RADIUS = 15;

/** K-Means maximum iterations */
const KMEANS_MAX_ITERATIONS = 50;

/** Strength thresholds (percentage of total weight in agreement zone) */
const STRENGTH_STRONG = 0.80;
const STRENGTH_MODERATE = 0.60;
const STRENGTH_WEAK = 0.40;

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/**
 * Hash a string to a 32-bit unsigned integer.
 */
function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

/**
 * Mulberry32 PRNG - simple, deterministic, seeded from a 32-bit integer.
 */
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Public Functions
// ---------------------------------------------------------------------------

/**
 * Compute the weighted median of reviewer votes.
 *
 * Sorts votes by value, accumulates weights, and returns the vote value
 * at which cumulative weight reaches 50% of total weight.
 */
export function weightedMedian(votes: ReviewerVote[]): number {
  if (votes.length === 0) {
    throw new Error("votes array must not be empty");
  }

  const sorted = [...votes].sort((a, b) => a.vote - b.vote);
  const total_weight = sorted.reduce((sum, v) => sum + v.weight, 0);

  if (total_weight <= 0) {
    throw new Error("total weight must be positive");
  }

  const half_weight = total_weight / 2;
  let cumulative = 0;

  for (const v of sorted) {
    cumulative += v.weight;
    if (cumulative >= half_weight) {
      return v.vote;
    }
  }

  return sorted[sorted.length - 1].vote;
}

/**
 * Detect the agreement zone around the weighted median.
 *
 * Agreement zone = votes within AGREEMENT_ZONE_RADIUS of median.
 * Strength based on percentage of total weight in zone:
 * - >=80%: "strong"
 * - >=60%: "moderate"
 * - >=40%: "weak"
 * - <40%: "failed"
 */
export function detectAgreementZone(
  votes: ReviewerVote[],
  median: number,
): AgreementZone {
  const lower = Math.max(median - AGREEMENT_ZONE_RADIUS, 0);
  const upper = Math.min(median + AGREEMENT_ZONE_RADIUS, 100);

  const total_weight = votes.reduce((sum, v) => sum + v.weight, 0);
  const weight_in_zone = votes
    .filter((v) => v.vote >= lower && v.vote <= upper)
    .reduce((sum, v) => sum + v.weight, 0);

  const ratio = total_weight > 0 ? weight_in_zone / total_weight : 0;

  let strength: AgreementZone["strength"];
  if (ratio >= STRENGTH_STRONG) {
    strength = "strong";
  } else if (ratio >= STRENGTH_MODERATE) {
    strength = "moderate";
  } else if (ratio >= STRENGTH_WEAK) {
    strength = "weak";
  } else {
    strength = "failed";
  }

  return { lower, upper, weight_in_zone, total_weight, strength };
}

/**
 * K-Means fallback for when agreement zone detection fails.
 *
 * Uses K=2 clusters with seeded PRNG for deterministic results.
 * Picks the cluster with higher total weight as winner.
 * Returns weighted median of the winning cluster.
 */
export function kMeansFallback(
  votes: ReviewerVote[],
  dispute_id: string,
): KMeansResult {
  if (votes.length === 0) {
    throw new Error("votes array must not be empty");
  }

  if (votes.length === 1) {
    return {
      result: votes[0].vote,
      cluster_info: {
        cluster_a: { centroid: votes[0].vote, total_weight: votes[0].weight, vote_count: 1 },
        cluster_b: { centroid: votes[0].vote, total_weight: 0, vote_count: 0 },
        winning_cluster: "a",
        iterations: 0,
      },
    };
  }

  const rng = mulberry32(hashString(dispute_id));

  // Initialize two centroids using seeded random positions
  const min_vote = Math.min(...votes.map((v) => v.vote));
  const max_vote = Math.max(...votes.map((v) => v.vote));
  const range = max_vote - min_vote;

  let centroid_a = min_vote + rng() * range;
  let centroid_b = min_vote + rng() * range;

  // Ensure centroids are different
  if (centroid_a === centroid_b) {
    centroid_b = centroid_a + 1;
  }

  let assignments = new Array<"a" | "b">(votes.length);
  let iterations = 0;

  for (let iter = 0; iter < KMEANS_MAX_ITERATIONS; iter++) {
    iterations = iter + 1;

    // Assignment step: assign each vote to nearest centroid
    const new_assignments = votes.map((v) => {
      const dist_a = Math.abs(v.vote - centroid_a);
      const dist_b = Math.abs(v.vote - centroid_b);
      return dist_a <= dist_b ? "a" as const : "b" as const;
    });

    // Check convergence
    const converged =
      iter > 0 && new_assignments.every((a, i) => a === assignments[i]);
    assignments = new_assignments;

    if (converged) break;

    // Update step: recompute centroids using weighted mean
    let sum_a = 0, weight_a = 0;
    let sum_b = 0, weight_b = 0;

    for (let i = 0; i < votes.length; i++) {
      if (assignments[i] === "a") {
        sum_a += votes[i].vote * votes[i].weight;
        weight_a += votes[i].weight;
      } else {
        sum_b += votes[i].vote * votes[i].weight;
        weight_b += votes[i].weight;
      }
    }

    if (weight_a > 0) centroid_a = sum_a / weight_a;
    if (weight_b > 0) centroid_b = sum_b / weight_b;
  }

  // Compute final cluster stats
  const cluster_a_votes: ReviewerVote[] = [];
  const cluster_b_votes: ReviewerVote[] = [];

  for (let i = 0; i < votes.length; i++) {
    if (assignments[i] === "a") {
      cluster_a_votes.push(votes[i]);
    } else {
      cluster_b_votes.push(votes[i]);
    }
  }

  const total_weight_a = cluster_a_votes.reduce((s, v) => s + v.weight, 0);
  const total_weight_b = cluster_b_votes.reduce((s, v) => s + v.weight, 0);

  const winning_cluster = total_weight_a >= total_weight_b ? "a" as const : "b" as const;
  const winning_votes = winning_cluster === "a" ? cluster_a_votes : cluster_b_votes;

  const result = winning_votes.length > 0 ? weightedMedian(winning_votes) : 50;

  const cluster_info: KMeansClusterInfo = {
    cluster_a: {
      centroid: Math.round(centroid_a * 100) / 100,
      total_weight: Math.round(total_weight_a * 100) / 100,
      vote_count: cluster_a_votes.length,
    },
    cluster_b: {
      centroid: Math.round(centroid_b * 100) / 100,
      total_weight: Math.round(total_weight_b * 100) / 100,
      vote_count: cluster_b_votes.length,
    },
    winning_cluster,
    iterations,
  };

  return { result, cluster_info };
}

/**
 * Aggregate reviewer votes for dispute resolution.
 *
 * Primary method: weighted median with agreement zone detection.
 * Fallback: seeded K-Means when agreement fails (strength < 40%).
 */
export function aggregateVotes(
  votes: ReviewerVote[],
  dispute_id: string,
): AggregationResult {
  if (votes.length === 0) {
    throw new Error("votes array must not be empty");
  }

  const median = weightedMedian(votes);
  const zone = detectAgreementZone(votes, median);

  if (zone.strength !== "failed") {
    return {
      weighted_median: median,
      agreement_zone: { lower: zone.lower, upper: zone.upper },
      strength: zone.strength,
      method: "weighted_median",
    };
  }

  // Fallback to K-Means
  const kmeans = kMeansFallback(votes, dispute_id);

  return {
    weighted_median: kmeans.result,
    agreement_zone: null,
    strength: "failed",
    method: "kmeans_fallback",
    cluster_info: kmeans.cluster_info,
  };
}
