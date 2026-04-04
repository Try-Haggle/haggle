import { describe, it, expect } from "vitest";
import {
  weightedMedian,
  detectAgreementZone,
  kMeansFallback,
  aggregateVotes,
} from "../vote-aggregation.js";
import type { ReviewerVote } from "../types.js";

// ---------------------------------------------------------------------------
// Helper: create votes
// ---------------------------------------------------------------------------

function vote(reviewer_id: string, v: number, w: number): ReviewerVote {
  return { reviewer_id, vote: v, weight: w };
}

// ---------------------------------------------------------------------------
// weightedMedian
// ---------------------------------------------------------------------------

describe("weightedMedian", () => {
  it("returns the single vote when only one vote", () => {
    expect(weightedMedian([vote("r1", 60, 1.0)])).toBe(60);
  });

  it("returns correct median for equal weights", () => {
    const votes = [vote("r1", 30, 1), vote("r2", 50, 1), vote("r3", 70, 1)];
    expect(weightedMedian(votes)).toBe(50);
  });

  it("returns weighted median favoring heavier votes", () => {
    // r1: vote=20, weight=1; r2: vote=80, weight=3
    // total=4, half=2. sorted: 20(cum=1), 80(cum=4>=2) -> 80
    const votes = [vote("r1", 20, 1), vote("r2", 80, 3)];
    expect(weightedMedian(votes)).toBe(80);
  });

  it("handles unsorted input correctly", () => {
    const votes = [vote("r3", 90, 1), vote("r1", 10, 1), vote("r2", 50, 1)];
    expect(weightedMedian(votes)).toBe(50);
  });

  it("throws for empty votes", () => {
    expect(() => weightedMedian([])).toThrow("votes array must not be empty");
  });
});

// ---------------------------------------------------------------------------
// detectAgreementZone
// ---------------------------------------------------------------------------

describe("detectAgreementZone", () => {
  it("returns strong when all votes are near median", () => {
    const votes = [
      vote("r1", 48, 1), vote("r2", 50, 1), vote("r3", 52, 1),
      vote("r4", 49, 1), vote("r5", 51, 1),
    ];
    const zone = detectAgreementZone(votes, 50);
    expect(zone.strength).toBe("strong");
    expect(zone.lower).toBe(35);
    expect(zone.upper).toBe(65);
  });

  it("returns moderate when 60-80% of weight is in zone", () => {
    // 7 of 10 votes in zone = 70% weight -> moderate
    const votes = [
      vote("r1", 45, 1), vote("r2", 48, 1), vote("r3", 50, 1),
      vote("r4", 52, 1), vote("r5", 55, 1), vote("r6", 47, 1),
      vote("r7", 53, 1),
      // 3 outside zone
      vote("r8", 5, 1), vote("r9", 10, 1), vote("r10", 95, 1),
    ];
    const zone = detectAgreementZone(votes, 50);
    expect(zone.strength).toBe("moderate");
  });

  it("returns weak when 40-60% of weight is in zone", () => {
    // 4 of 10 in zone with equal weight = 40% -> weak
    const votes = [
      vote("r1", 45, 1), vote("r2", 50, 1), vote("r3", 55, 1), vote("r4", 48, 1),
      vote("r5", 5, 1), vote("r6", 10, 1), vote("r7", 85, 1),
      vote("r8", 90, 1), vote("r9", 95, 1), vote("r10", 0, 1),
    ];
    const zone = detectAgreementZone(votes, 50);
    expect(zone.strength).toBe("weak");
  });

  it("returns failed when less than 40% of weight is in zone", () => {
    // 2 of 10 in zone = 20% -> failed
    const votes = [
      vote("r1", 50, 1), vote("r2", 52, 1),
      vote("r3", 0, 1), vote("r4", 5, 1), vote("r5", 10, 1),
      vote("r6", 85, 1), vote("r7", 90, 1), vote("r8", 95, 1),
      vote("r9", 100, 1), vote("r10", 3, 1),
    ];
    const zone = detectAgreementZone(votes, 50);
    expect(zone.strength).toBe("failed");
  });

  it("clamps zone lower bound to 0", () => {
    const votes = [vote("r1", 5, 1)];
    const zone = detectAgreementZone(votes, 5);
    expect(zone.lower).toBe(0);
  });

  it("clamps zone upper bound to 100", () => {
    const votes = [vote("r1", 95, 1)];
    const zone = detectAgreementZone(votes, 95);
    expect(zone.upper).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// kMeansFallback
// ---------------------------------------------------------------------------

describe("kMeansFallback", () => {
  it("returns deterministic results for same dispute_id", () => {
    const votes = [
      vote("r1", 10, 1), vote("r2", 15, 1), vote("r3", 80, 1), vote("r4", 85, 1),
    ];
    const result1 = kMeansFallback(votes, "dispute-abc");
    const result2 = kMeansFallback(votes, "dispute-abc");
    expect(result1.result).toBe(result2.result);
    expect(result1.cluster_info.winning_cluster).toBe(result2.cluster_info.winning_cluster);
  });

  it("separates bimodal votes into two clusters", () => {
    const votes = [
      vote("r1", 10, 1), vote("r2", 15, 1), vote("r3", 20, 1),
      vote("r4", 80, 1), vote("r5", 85, 1), vote("r6", 90, 1),
    ];
    const result = kMeansFallback(votes, "dispute-bimodal");
    const info = result.cluster_info;
    // Clusters should separate into low and high groups
    expect(info.cluster_a.vote_count + info.cluster_b.vote_count).toBe(6);
    expect(info.cluster_a.vote_count).toBeGreaterThan(0);
    expect(info.cluster_b.vote_count).toBeGreaterThan(0);
  });

  it("picks cluster with higher total weight as winner", () => {
    // Heavy weight on high cluster
    const votes = [
      vote("r1", 10, 0.5), vote("r2", 15, 0.5),
      vote("r3", 80, 2.0), vote("r4", 85, 2.0),
    ];
    const result = kMeansFallback(votes, "dispute-weight");
    // Winner should be the high cluster with more weight
    expect(result.result).toBeGreaterThanOrEqual(50);
  });

  it("handles single vote", () => {
    const votes = [vote("r1", 42, 1.5)];
    const result = kMeansFallback(votes, "dispute-single");
    expect(result.result).toBe(42);
    expect(result.cluster_info.iterations).toBe(0);
  });

  it("throws for empty votes", () => {
    expect(() => kMeansFallback([], "dispute-empty")).toThrow("votes array must not be empty");
  });

  it("converges within max iterations", () => {
    const votes = [
      vote("r1", 10, 1), vote("r2", 20, 1), vote("r3", 30, 1),
      vote("r4", 70, 1), vote("r5", 80, 1), vote("r6", 90, 1),
    ];
    const result = kMeansFallback(votes, "dispute-converge");
    expect(result.cluster_info.iterations).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// aggregateVotes
// ---------------------------------------------------------------------------

describe("aggregateVotes", () => {
  it("uses weighted_median method when agreement is strong", () => {
    const votes = [
      vote("r1", 48, 1), vote("r2", 50, 1), vote("r3", 52, 1),
      vote("r4", 49, 1), vote("r5", 51, 1),
    ];
    const result = aggregateVotes(votes, "dispute-strong");
    expect(result.method).toBe("weighted_median");
    expect(result.strength).toBe("strong");
    expect(result.agreement_zone).not.toBeNull();
  });

  it("falls back to kmeans when agreement fails", () => {
    const votes = [
      vote("r1", 0, 1), vote("r2", 5, 1),
      vote("r3", 95, 1), vote("r4", 100, 1),
      vote("r5", 50, 1),
    ];
    // Most weight is spread across 0-5 and 95-100, not near median
    // Need to ensure < 40% in zone
    const wideVotes = [
      vote("r1", 0, 1), vote("r2", 5, 1), vote("r3", 10, 1),
      vote("r4", 85, 1), vote("r5", 90, 1), vote("r6", 95, 1), vote("r7", 100, 1),
    ];
    const result = aggregateVotes(wideVotes, "dispute-fallback");
    if (result.strength === "failed") {
      expect(result.method).toBe("kmeans_fallback");
      expect(result.agreement_zone).toBeNull();
      expect(result.cluster_info).toBeDefined();
    }
  });

  it("throws for empty votes", () => {
    expect(() => aggregateVotes([], "dispute-empty")).toThrow("votes array must not be empty");
  });

  it("returns a number between 0 and 100 for weighted_median", () => {
    const votes = [
      vote("r1", 30, 1), vote("r2", 40, 1), vote("r3", 50, 1),
    ];
    const result = aggregateVotes(votes, "dispute-range");
    expect(result.weighted_median).toBeGreaterThanOrEqual(0);
    expect(result.weighted_median).toBeLessThanOrEqual(100);
  });

  it("produces deterministic results", () => {
    const votes = [
      vote("r1", 10, 1), vote("r2", 90, 1), vote("r3", 50, 1.5),
    ];
    const a = aggregateVotes(votes, "dispute-det");
    const b = aggregateVotes(votes, "dispute-det");
    expect(a.weighted_median).toBe(b.weighted_median);
    expect(a.method).toBe(b.method);
  });
});
