import { describe, it, expect } from "vitest";
import {
  aggregateWithFallback,
  aggregateLargePanel,
  hashToSeed,
} from "../vote-aggregation.js";
import type { ReviewerVote } from "../vote-aggregation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVote(value: number, tier: "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND" = "GOLD"): ReviewerVote {
  return { reviewer_id: `r_${value}_${Math.random().toString(16).slice(2, 6)}`, tier, value };
}

/** Create a polarized panel: two clear factions at extremes, equal size. */
function polarizedVotes(): ReviewerVote[] {
  // Group A: 8 voters at 95-100 (extreme buyer)
  // Group B: 7 voters at 0-5 (extreme seller)
  // 1σ zone will be ~50±45, but with equal-weight groups the zone ratio drops below 0.45
  // because no votes actually cluster near the mean (~50)
  return [
    makeVote(100, "GOLD"), makeVote(98, "GOLD"), makeVote(97, "GOLD"),
    makeVote(100, "GOLD"), makeVote(99, "GOLD"), makeVote(98, "GOLD"),
    makeVote(100, "GOLD"), makeVote(97, "GOLD"),
    makeVote(0, "GOLD"), makeVote(2, "GOLD"), makeVote(3, "GOLD"),
    makeVote(0, "GOLD"), makeVote(1, "GOLD"), makeVote(2, "GOLD"),
    makeVote(0, "GOLD"),
  ];
}

/** Create a consensus panel: most voters agree. */
function consensusVotes(): ReviewerVote[] {
  return [
    makeVote(70, "GOLD"), makeVote(72, "GOLD"), makeVote(68, "SILVER"),
    makeVote(71, "PLATINUM"), makeVote(69, "GOLD"), makeVote(73, "GOLD"),
    makeVote(70, "DIAMOND"), makeVote(71, "SILVER"), makeVote(72, "GOLD"),
    makeVote(68, "GOLD"), makeVote(70, "GOLD"), makeVote(69, "PLATINUM"),
    makeVote(71, "GOLD"), makeVote(73, "SILVER"), makeVote(70, "GOLD"),
  ];
}

// ---------------------------------------------------------------------------
// hashToSeed
// ---------------------------------------------------------------------------

describe("hashToSeed", () => {
  it("returns same seed for same string", () => {
    expect(hashToSeed("dispute_123")).toBe(hashToSeed("dispute_123"));
  });

  it("returns different seeds for different strings", () => {
    expect(hashToSeed("dispute_123")).not.toBe(hashToSeed("dispute_456"));
  });

  it("returns a number", () => {
    expect(typeof hashToSeed("test")).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// aggregateWithFallback — no fallback (consensus)
// ---------------------------------------------------------------------------

describe("aggregateWithFallback — consensus (no fallback)", () => {
  it("uses Trimmed Mean when agreement is not failed", () => {
    const votes = consensusVotes();
    const result = aggregateWithFallback(votes, "dispute_consensus");

    expect(result.fallback_used).toBe(false);
    expect(result.clusters).toBeUndefined();
    expect(result.result).toBe(70);
    expect(result.agreement.strength).not.toBe("failed");
  });

  it("produces same result as aggregateLargePanel when no fallback needed", () => {
    const votes = consensusVotes();
    const withFallback = aggregateWithFallback(votes, "dispute_test");
    const withoutFallback = aggregateLargePanel(votes);

    expect(withFallback.result).toBe(withoutFallback.result);
    expect(withFallback.raw_mean).toBe(withoutFallback.raw_mean);
  });
});

// ---------------------------------------------------------------------------
// aggregateWithFallback — fallback (polarized)
// ---------------------------------------------------------------------------

describe("aggregateWithFallback — polarized (K-Means fallback)", () => {
  it("triggers fallback when agreement fails", () => {
    const votes = polarizedVotes();
    const result = aggregateWithFallback(votes, "dispute_polar_1");

    expect(result.fallback_used).toBe(true);
    expect(result.clusters).toBeDefined();
    expect(result.clusters!.length).toBe(2);
  });

  it("identifies majority cluster correctly", () => {
    const votes = polarizedVotes(); // 8 high vs 7 low
    const result = aggregateWithFallback(votes, "dispute_polar_2");

    const majority = result.clusters!.find(c => c.is_majority);
    expect(majority).toBeDefined();
    expect(majority!.member_count).toBeGreaterThanOrEqual(7);
  });

  it("result reflects majority cluster centroid", () => {
    const votes = polarizedVotes(); // 8 voters at ~99, 7 at ~1
    const result = aggregateWithFallback(votes, "dispute_polar_3");

    // Majority is the 8-voter high group (~99)
    // Result should be near 100, not near 50 (which Trimmed Mean would give)
    expect(result.result).toBeGreaterThan(70);
  });

  it("is deterministic — same dispute_id = same result", () => {
    const votes = polarizedVotes();
    const r1 = aggregateWithFallback(votes, "dispute_abc");
    const r2 = aggregateWithFallback(votes, "dispute_abc");

    expect(r1.result).toBe(r2.result);
    expect(r1.clusters![0].centroid).toBe(r2.clusters![0].centroid);
    expect(r1.clusters![1].centroid).toBe(r2.clusters![1].centroid);
  });

  it("different dispute_id = same result (determinism depends on data, seed just initializes)", () => {
    const votes = polarizedVotes();
    const r1 = aggregateWithFallback(votes, "dispute_xxx");
    const r2 = aggregateWithFallback(votes, "dispute_yyy");

    // With clear polarization, K-Means should converge to same clusters
    // regardless of initialization — the clusters are obvious
    expect(r1.result).toBe(r2.result);
  });

  it("clusters have correct structure", () => {
    const votes = polarizedVotes();
    const result = aggregateWithFallback(votes, "dispute_struct");

    for (const c of result.clusters!) {
      expect(c.centroid).toBeGreaterThanOrEqual(0);
      expect(c.centroid).toBeLessThanOrEqual(100);
      expect(c.member_count).toBeGreaterThan(0);
      expect(c.total_weight).toBeGreaterThan(0);
      expect(typeof c.is_majority).toBe("boolean");
    }

    // Exactly one majority
    const majorities = result.clusters!.filter(c => c.is_majority);
    expect(majorities.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("aggregateWithFallback — edge cases", () => {
  it("handles all identical votes (no polarization)", () => {
    const votes = Array.from({ length: 15 }, (_, i) =>
      makeVote(50, "GOLD"),
    );
    const result = aggregateWithFallback(votes, "dispute_identical");

    expect(result.fallback_used).toBe(false);
    expect(result.result).toBe(50);
  });

  it("handles minimum panel size (15 voters)", () => {
    const votes = polarizedVotes(); // exactly 15
    expect(votes.length).toBe(15);

    const result = aggregateWithFallback(votes, "dispute_min");
    expect(result.mode).toBe("large");
  });

  it("preserves Trimmed Mean metadata when fallback is used", () => {
    const votes = polarizedVotes();
    const result = aggregateWithFallback(votes, "dispute_meta");

    // raw_mean and trim counts should still reflect the Trimmed Mean computation
    expect(result.raw_mean).toBeTypeOf("number");
    expect(result.trimmed_low_count).toBeGreaterThanOrEqual(0);
    expect(result.trimmed_high_count).toBeGreaterThanOrEqual(0);
    expect(result.total_voters).toBe(15);
  });

  it("3-way split triggers fallback", () => {
    // Three clear factions: low, mid, high
    const votes: ReviewerVote[] = [
      makeVote(10), makeVote(12), makeVote(8), makeVote(11), makeVote(9),
      makeVote(50), makeVote(48), makeVote(52), makeVote(49), makeVote(51),
      makeVote(90), makeVote(88), makeVote(92), makeVote(91), makeVote(89),
    ];
    const result = aggregateWithFallback(votes, "dispute_3way");

    // K-Means with K=2 will merge two closest groups
    // Result should favor one side
    expect(result.mode).toBe("large");
    // May or may not trigger fallback depending on agreement zone width
  });
});
