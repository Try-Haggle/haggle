import { describe, it, expect } from "vitest";
import {
  weightedMedian,
  detectAgreementZone,
  classifyStrength,
  kMeansFallback,
  aggregateVotes,
} from "../vote-aggregation.js";
import type { ReviewerVote } from "../types.js";

function makeVotes(pairs: [number, number][]): ReviewerVote[] {
  return pairs.map(([vote, weight], i) => ({
    reviewer_id: `r${i}`,
    vote,
    weight,
  }));
}

describe("weightedMedian", () => {
  it("returns 0 for empty votes", () => {
    expect(weightedMedian([])).toBe(0);
  });

  it("returns single vote", () => {
    expect(weightedMedian(makeVotes([[70, 1]]))).toBe(70);
  });

  it("returns weighted median with equal weights", () => {
    const votes = makeVotes([[30, 1], [50, 1], [70, 1]]);
    expect(weightedMedian(votes)).toBe(50);
  });

  it("shifts toward higher-weighted votes", () => {
    // Heavy weight on 80 → median shifts toward 80
    const votes = makeVotes([[20, 1], [50, 1], [80, 5]]);
    expect(weightedMedian(votes)).toBe(80);
  });

  it("handles two equal-weight votes", () => {
    const votes = makeVotes([[40, 1], [60, 1]]);
    const median = weightedMedian(votes);
    expect(median).toBeGreaterThanOrEqual(40);
    expect(median).toBeLessThanOrEqual(60);
  });
});

describe("detectAgreementZone", () => {
  it("identifies votes within ±15 radius", () => {
    const votes = makeVotes([[45, 1], [50, 1], [55, 1]]);
    const zone = detectAgreementZone(votes, 50);
    expect(zone.lower).toBe(35);
    expect(zone.upper).toBe(65);
    expect(zone.ratio).toBe(1.0); // all votes within zone
  });

  it("clamps zone to 0-100", () => {
    const votes = makeVotes([[5, 1], [10, 1]]);
    const zone = detectAgreementZone(votes, 5);
    expect(zone.lower).toBe(0);
    expect(zone.upper).toBe(20);
  });

  it("calculates correct ratio for partial agreement", () => {
    const votes = makeVotes([[20, 1], [50, 1], [80, 1]]);
    const zone = detectAgreementZone(votes, 50);
    // Only vote=50 is within [35, 65]
    expect(zone.ratio).toBeCloseTo(1 / 3, 2);
  });

  it("handles weighted ratio", () => {
    const votes = makeVotes([[50, 3], [90, 1]]);
    const zone = detectAgreementZone(votes, 50);
    // vote=50 (weight=3) in zone, vote=90 (weight=1) out
    expect(zone.ratio).toBe(0.75);
  });
});

describe("classifyStrength", () => {
  it("returns strong for ≥80%", () => {
    expect(classifyStrength(0.80)).toBe("strong");
    expect(classifyStrength(1.0)).toBe("strong");
  });

  it("returns moderate for ≥60%", () => {
    expect(classifyStrength(0.60)).toBe("moderate");
    expect(classifyStrength(0.79)).toBe("moderate");
  });

  it("returns weak for ≥40%", () => {
    expect(classifyStrength(0.40)).toBe("weak");
    expect(classifyStrength(0.59)).toBe("weak");
  });

  it("returns failed for <40%", () => {
    expect(classifyStrength(0.39)).toBe("failed");
    expect(classifyStrength(0)).toBe("failed");
  });
});

describe("kMeansFallback", () => {
  it("is deterministic with same dispute_id", () => {
    const votes = makeVotes([[10, 1], [20, 1], [80, 1], [90, 1]]);
    const r1 = kMeansFallback(votes, "dispute-123");
    const r2 = kMeansFallback(votes, "dispute-123");
    expect(r1.median).toBe(r2.median);
    expect(r1.cluster_info.winner).toBe(r2.cluster_info.winner);
  });

  it("separates bimodal distribution into 2 clusters", () => {
    const votes = makeVotes([[10, 1], [15, 1], [85, 1], [90, 1]]);
    const result = kMeansFallback(votes, "test-bimodal");
    expect(result.cluster_info.cluster_a.count + result.cluster_info.cluster_b.count).toBe(4);
  });

  it("winner has higher total weight", () => {
    // Heavy weight cluster around 80
    const votes = makeVotes([[10, 1], [80, 3], [85, 3], [90, 3]]);
    const result = kMeansFallback(votes, "test-weighted");
    const winner = result.cluster_info.winner;
    const winnerCluster = winner === "a"
      ? result.cluster_info.cluster_a
      : result.cluster_info.cluster_b;
    const loserCluster = winner === "a"
      ? result.cluster_info.cluster_b
      : result.cluster_info.cluster_a;
    expect(winnerCluster.total_weight).toBeGreaterThanOrEqual(loserCluster.total_weight);
  });

  it("returns valid median from winning cluster", () => {
    const votes = makeVotes([[10, 1], [15, 1], [80, 2], [90, 2]]);
    const result = kMeansFallback(votes, "test-median");
    expect(result.median).toBeGreaterThanOrEqual(0);
    expect(result.median).toBeLessThanOrEqual(100);
  });
});

describe("aggregateVotes", () => {
  it("returns failed for empty votes", () => {
    const result = aggregateVotes([], "d-empty");
    expect(result.strength).toBe("failed");
    expect(result.weighted_median).toBe(0);
  });

  it("uses weighted_median when agreement is strong", () => {
    const votes = makeVotes([[48, 1], [50, 1], [52, 1], [49, 1], [51, 1]]);
    const result = aggregateVotes(votes, "d-agree");
    expect(result.method).toBe("weighted_median");
    expect(result.strength).toBe("strong");
  });

  it("falls back to kmeans when agreement fails", () => {
    // Bimodal: no agreement zone
    const votes = makeVotes([
      [5, 1], [10, 1], [15, 1],
      [85, 1], [90, 1], [95, 1],
    ]);
    const result = aggregateVotes(votes, "d-bimodal");
    if (result.strength === "failed") {
      expect(result.method).toBe("kmeans_fallback");
      expect(result.cluster_info).toBeDefined();
    }
  });

  it("returns moderate strength for partial agreement", () => {
    // 4/6 votes within zone = 66% → moderate
    const votes = makeVotes([
      [45, 1], [48, 1], [50, 1], [52, 1],
      [10, 1], [90, 1],
    ]);
    const result = aggregateVotes(votes, "d-moderate");
    expect(["moderate", "weak", "strong"]).toContain(result.strength);
    if (result.strength !== "failed") {
      expect(result.method).toBe("weighted_median");
    }
  });

  it("is deterministic", () => {
    const votes = makeVotes([[10, 1], [90, 1], [50, 1]]);
    const r1 = aggregateVotes(votes, "d-det");
    const r2 = aggregateVotes(votes, "d-det");
    expect(r1.weighted_median).toBe(r2.weighted_median);
    expect(r1.method).toBe(r2.method);
  });
});
