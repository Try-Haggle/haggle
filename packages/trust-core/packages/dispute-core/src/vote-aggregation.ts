import type {
  AggregationResult,
  AgreementStrength,
  AgreementZone,
  KMeansClusterInfo,
  ReviewerVote,
} from "./types.js";
import { AGREEMENT_ZONE_RADIUS, KMEANS_MAX_ITERATIONS } from "./types.js";

// ---------------------------------------------------------------------------
// Seeded PRNG — deterministic based on dispute_id
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

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
// weightedMedian
// ---------------------------------------------------------------------------

export function weightedMedian(votes: ReviewerVote[]): number {
  if (votes.length === 0) return 0;
  if (votes.length === 1) return votes[0].vote;

  const sorted = [...votes].sort((a, b) => a.vote - b.vote);
  const totalWeight = sorted.reduce((sum, v) => sum + v.weight, 0);
  const halfWeight = totalWeight / 2;

  let cumulative = 0;
  for (const v of sorted) {
    cumulative += v.weight;
    if (cumulative >= halfWeight) {
      return v.vote;
    }
  }

  return sorted[sorted.length - 1].vote;
}

// ---------------------------------------------------------------------------
// detectAgreementZone
// ---------------------------------------------------------------------------

export function detectAgreementZone(
  votes: ReviewerVote[],
  median: number,
  radius: number = AGREEMENT_ZONE_RADIUS,
): AgreementZone {
  const lower = Math.max(0, median - radius);
  const upper = Math.min(100, median + radius);

  const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
  const inZoneWeight = votes
    .filter(v => v.vote >= lower && v.vote <= upper)
    .reduce((sum, v) => sum + v.weight, 0);

  return {
    lower,
    upper,
    weight_in_zone: inZoneWeight,
    total_weight: totalWeight,
    ratio: totalWeight > 0 ? inZoneWeight / totalWeight : 0,
  };
}

// ---------------------------------------------------------------------------
// classifyStrength
// ---------------------------------------------------------------------------

export function classifyStrength(ratio: number): AgreementStrength {
  if (ratio >= 0.80) return "strong";
  if (ratio >= 0.60) return "moderate";
  if (ratio >= 0.40) return "weak";
  return "failed";
}

// ---------------------------------------------------------------------------
// kMeansFallback — K=2 with seeded PRNG
// ---------------------------------------------------------------------------

export function kMeansFallback(
  votes: ReviewerVote[],
  dispute_id: string,
): { median: number; cluster_info: KMeansClusterInfo } {
  const rng = mulberry32(hashString(dispute_id));

  // Initialize centroids: pick 2 random votes
  const indices = votes.map((_, i) => i);
  const i1 = Math.floor(rng() * indices.length);
  let i2 = Math.floor(rng() * indices.length);
  if (i2 === i1) i2 = (i2 + 1) % indices.length;

  let centroid_a = votes[i1].vote;
  let centroid_b = votes[i2].vote;

  // Ensure a < b for consistency
  if (centroid_a > centroid_b) {
    [centroid_a, centroid_b] = [centroid_b, centroid_a];
  }

  let assignments: ("a" | "b")[] = new Array(votes.length);
  let iterations = 0;

  for (iterations = 0; iterations < KMEANS_MAX_ITERATIONS; iterations++) {
    // Assign each vote to nearest centroid
    const newAssignments: ("a" | "b")[] = votes.map(v => {
      const dist_a = Math.abs(v.vote - centroid_a);
      const dist_b = Math.abs(v.vote - centroid_b);
      return dist_a <= dist_b ? "a" : "b";
    });

    // Check convergence
    const converged = assignments.length === newAssignments.length &&
      assignments.every((a, idx) => a === newAssignments[idx]);

    assignments = newAssignments;

    if (converged && iterations > 0) break;

    // Recalculate centroids (weighted)
    const new_a = weightedCentroid(votes, assignments, "a");
    const new_b = weightedCentroid(votes, assignments, "b");

    if (new_a !== null) centroid_a = new_a;
    if (new_b !== null) centroid_b = new_b;
  }

  // Calculate cluster stats
  const cluster_a = clusterStats(votes, assignments, "a", centroid_a);
  const cluster_b = clusterStats(votes, assignments, "b", centroid_b);

  // Winner = cluster with higher total weight
  const winner: "a" | "b" = cluster_a.total_weight >= cluster_b.total_weight ? "a" : "b";

  // Weighted median of winning cluster
  const winnerVotes = votes.filter((_, i) => assignments[i] === winner);
  const median = weightedMedian(winnerVotes);

  return {
    median,
    cluster_info: {
      cluster_a,
      cluster_b,
      winner,
      iterations: iterations + 1,
    },
  };
}

function weightedCentroid(
  votes: ReviewerVote[],
  assignments: ("a" | "b")[],
  cluster: "a" | "b",
): number | null {
  let sumWeightedVote = 0;
  let sumWeight = 0;

  for (let i = 0; i < votes.length; i++) {
    if (assignments[i] === cluster) {
      sumWeightedVote += votes[i].vote * votes[i].weight;
      sumWeight += votes[i].weight;
    }
  }

  return sumWeight > 0 ? sumWeightedVote / sumWeight : null;
}

function clusterStats(
  votes: ReviewerVote[],
  assignments: ("a" | "b")[],
  cluster: "a" | "b",
  centroid: number,
): { centroid: number; total_weight: number; count: number } {
  let total_weight = 0;
  let count = 0;

  for (let i = 0; i < votes.length; i++) {
    if (assignments[i] === cluster) {
      total_weight += votes[i].weight;
      count++;
    }
  }

  return { centroid: Math.round(centroid * 100) / 100, total_weight, count };
}

// ---------------------------------------------------------------------------
// aggregateVotes — main entry point
// ---------------------------------------------------------------------------

export function aggregateVotes(
  votes: ReviewerVote[],
  dispute_id: string,
): AggregationResult {
  if (votes.length === 0) {
    return {
      weighted_median: 0,
      agreement_zone: null,
      strength: "failed",
      method: "weighted_median",
    };
  }

  const median = weightedMedian(votes);
  const zone = detectAgreementZone(votes, median);
  const strength = classifyStrength(zone.ratio);

  if (strength === "failed") {
    // K-Means fallback
    const fallback = kMeansFallback(votes, dispute_id);
    const fallbackZone = detectAgreementZone(votes, fallback.median);

    return {
      weighted_median: fallback.median,
      agreement_zone: fallbackZone,
      strength: "failed",
      method: "kmeans_fallback",
      cluster_info: fallback.cluster_info,
    };
  }

  return {
    weighted_median: median,
    agreement_zone: zone,
    strength,
    method: "weighted_median",
  };
}
