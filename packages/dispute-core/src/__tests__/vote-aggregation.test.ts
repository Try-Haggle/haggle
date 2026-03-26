import { describe, it, expect } from "vitest";
import {
  aggregateSmallPanel,
  aggregateLargePanel,
  aggregateVotes,
  getMajorityReviewers,
  calculateCompensation,
  TIER_WEIGHTS,
  PANEL_THRESHOLD,
  EXPERTISE_MATCH_BONUS,
  type ReviewerVote,
  type ReviewerTier,
} from "../vote-aggregation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVote(
  value: number,
  tier: ReviewerTier = "GOLD",
): ReviewerVote {
  return {
    reviewer_id: `r_${Math.random().toString(36).slice(2, 8)}`,
    tier,
    value,
  };
}

function makeVotes(
  values: number[],
  tier: ReviewerTier = "GOLD",
): ReviewerVote[] {
  return values.map((v, i) => ({
    reviewer_id: `r_${i}`,
    tier,
    value: v,
  }));
}

// ===========================================================================
// 1. Small Panel
// ===========================================================================

describe("aggregateSmallPanel", () => {
  it("clear winner (4 out of 5 vote same) -> strong", () => {
    const votes = makeVotes([75, 75, 75, 75, 25]);
    const result = aggregateSmallPanel(votes);

    expect(result.mode).toBe("small");
    expect(result.result).toBe(75);
    expect(result.winner_count).toBe(4);
    expect(result.strength).toBe("strong");
    expect(result.winner_pct).toBe(80); // 4/5 equal-weight voters
  });

  it("majority with ~75% weighted -> moderate when pct >= 45", () => {
    // 3 GOLD (1.10 each = 3.30) vote 50, 2 GOLD vote 25 (2.20)
    // winner pct = 3.30 / 5.50 = 60% -> strong actually
    // Use different split: 2 GOLD vote 50 (2.20), 2 GOLD vote 25 (2.20), 1 GOLD vote 75 (1.10)
    // winner pct = 2.20 / 5.50 = 40% -> weak
    // Adjust: 3 BRONZE vote 50 (1.89), 2 PLATINUM vote 25 (2.90)
    // 50 pct = 1.89 / 4.79 = 39.5% -> weak
    // 25 pct = 2.90 / 4.79 = 60.5% -> strong, winner is 25
    // Let's target moderate: need winner_pct between 45-60
    // 3 SILVER vote 50 (2.55), 2 GOLD vote 25 (2.20)
    // 50 pct = 2.55 / 4.75 = 53.7% -> moderate
    const votes = [
      ...makeVotes([50, 50, 50], "SILVER"),
      ...makeVotes([25, 25], "GOLD"),
    ];
    // Fix reviewer_ids to be unique
    votes.forEach((v, i) => (v.reviewer_id = `r_${i}`));

    const result = aggregateSmallPanel(votes);

    expect(result.result).toBe(50);
    expect(result.strength).toBe("moderate");
  });

  it("split votes -> weak or failed", () => {
    // 5 voters across 4 different options with equal tier
    const votes = makeVotes([0, 25, 50, 75, 100]);
    const result = aggregateSmallPanel(votes);

    // Each bucket gets 20%, winner_pct = 20% -> failed
    expect(result.strength).toBe("failed");
  });

  it("tier weights affect outcome (Diamond voter overrides Bronze majority)", () => {
    // 4 BRONZE vote 25 (4 * 0.63 = 2.52)
    // 1 DIAMOND votes 75 (1 * 2.0 = 2.0)
    // BRONZE total = 2.52, DIAMOND total = 2.0
    // Bronze still wins here. Use 3 BRONZE vs 1 DIAMOND:
    // 3 * 0.63 = 1.89 vs 2.0 -> DIAMOND wins
    const bronzeVotes: ReviewerVote[] = [
      { reviewer_id: "r_0", tier: "BRONZE", value: 25 },
      { reviewer_id: "r_1", tier: "BRONZE", value: 25 },
      { reviewer_id: "r_2", tier: "BRONZE", value: 25 },
    ];
    const diamondVote: ReviewerVote = {
      reviewer_id: "r_3",
      tier: "DIAMOND",
      value: 75,
    };
    const votes = [...bronzeVotes, diamondVote];

    const result = aggregateSmallPanel(votes);

    // DIAMOND weight (2.0) > 3 * BRONZE (1.89)
    expect(result.result).toBe(75);
    expect(result.winner_count).toBe(1); // only the Diamond voter
  });

  it("all same vote -> 100% strength", () => {
    const votes = makeVotes([50, 50, 50, 50, 50]);
    const result = aggregateSmallPanel(votes);

    expect(result.result).toBe(50);
    expect(result.winner_pct).toBe(100);
    expect(result.strength).toBe("strong");
  });

  it("single voter", () => {
    const votes = makeVotes([100]);
    const result = aggregateSmallPanel(votes);

    expect(result.result).toBe(100);
    expect(result.winner_count).toBe(1);
    expect(result.winner_pct).toBe(100);
    expect(result.strength).toBe("strong");
  });

  it("snaps non-standard values to nearest option", () => {
    // 30 snaps to 25, 60 snaps to 50, 90 snaps to 100
    const votes = makeVotes([30, 60, 90]);
    const result = aggregateSmallPanel(votes);

    // Each bucket has 1 vote -> 33.3% each -> failed
    expect(result.buckets[25].count).toBe(1);
    expect(result.buckets[50].count).toBe(1);
    expect(result.buckets[100].count).toBe(1);
  });
});

// ===========================================================================
// 2. Large Panel
// ===========================================================================

describe("aggregateLargePanel", () => {
  it("consensus around 70 -> result ~ 70", () => {
    // 15 voters all near 70
    const values = [65, 68, 69, 70, 70, 70, 70, 71, 71, 72, 73, 68, 69, 70, 72];
    const votes = makeVotes(values);
    const result = aggregateLargePanel(votes);

    expect(result.mode).toBe("large");
    expect(result.result).toBe(70);
    // With 15 voters spread 65-73, stddev is small but agreement ratio depends on zone width
    expect(["strong", "moderate"]).toContain(result.agreement.strength);
  });

  it("outliers trimmed (2 extreme votes out of 15) -> result unaffected", () => {
    // 13 voters at 50, 1 at 0, 1 at 100
    const values = [0, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 100];
    const votes = makeVotes(values);
    const result = aggregateLargePanel(votes);

    expect(result.result).toBe(50);
    expect(result.trimmed_low_count).toBeGreaterThanOrEqual(1);
    expect(result.trimmed_high_count).toBeGreaterThanOrEqual(1);
  });

  it("polarized (split ~50/50) -> trimmed mean between groups", () => {
    // 8 voters at 20, 7 voters at 80
    const values = [20, 20, 20, 20, 20, 20, 20, 20, 80, 80, 80, 80, 80, 80, 80];
    const votes = makeVotes(values);
    const result = aggregateLargePanel(votes);

    // Trimmed mean should be between 20 and 80
    expect(result.raw_mean).toBeGreaterThan(20);
    expect(result.raw_mean).toBeLessThan(80);
  });

  it("all vote 50 -> result = 50, strong agreement", () => {
    const values = Array(15).fill(50);
    const votes = makeVotes(values);
    const result = aggregateLargePanel(votes);

    expect(result.result).toBe(50);
    expect(result.raw_mean).toBeCloseTo(50, 10);
    expect(result.agreement.strength).toBe("strong");
    expect(result.agreement.std_dev).toBeCloseTo(0, 10);
  });

  it("agreement zone contains majority of voters", () => {
    // Cluster with a few outliers
    const values = [45, 48, 49, 50, 50, 50, 51, 51, 52, 53, 55, 10, 90, 50, 50];
    const votes = makeVotes(values);
    const result = aggregateLargePanel(votes);

    expect(result.agreement.inside_count).toBeGreaterThan(
      result.agreement.outside_count,
    );
    expect(result.agreement.agreement_ratio).toBeGreaterThan(0.5);
  });

  it("tier weights affect trimmed mean", () => {
    // 15 voters: 7 BRONZE at 30, 8 DIAMOND at 70
    // Diamond weight >> Bronze, so mean should pull toward 70
    const bronzeVotes: ReviewerVote[] = Array.from({ length: 7 }, (_, i) => ({
      reviewer_id: `rb_${i}`,
      tier: "BRONZE" as ReviewerTier,
      value: 30,
    }));
    const diamondVotes: ReviewerVote[] = Array.from({ length: 8 }, (_, i) => ({
      reviewer_id: `rd_${i}`,
      tier: "DIAMOND" as ReviewerTier,
      value: 70,
    }));
    const votes = [...bronzeVotes, ...diamondVotes];
    const result = aggregateLargePanel(votes);

    // Unweighted mean would be ~51.3, weighted should be higher (toward 70)
    expect(result.raw_mean).toBeGreaterThan(55);
  });
});

// ===========================================================================
// 3. aggregateVotes (auto mode selection)
// ===========================================================================

describe("aggregateVotes", () => {
  it("auto-selects small for < 15 voters", () => {
    const votes = makeVotes([50, 50, 75]);
    const result = aggregateVotes(votes);

    expect(result.mode).toBe("small");
  });

  it("auto-selects large for >= 15 voters", () => {
    const values = Array(15).fill(50);
    const votes = makeVotes(values);
    const result = aggregateVotes(votes);

    expect(result.mode).toBe("large");
  });

  it("throws on empty votes array", () => {
    expect(() => aggregateVotes([])).toThrow("Cannot aggregate zero votes");
  });
});

// ===========================================================================
// 4. getMajorityReviewers
// ===========================================================================

describe("getMajorityReviewers", () => {
  it("small panel: returns voters who chose the winning option", () => {
    const votes: ReviewerVote[] = [
      { reviewer_id: "r_0", tier: "GOLD", value: 50 },
      { reviewer_id: "r_1", tier: "GOLD", value: 50 },
      { reviewer_id: "r_2", tier: "GOLD", value: 50 },
      { reviewer_id: "r_3", tier: "GOLD", value: 25 },
    ];
    const result = aggregateSmallPanel(votes);
    const majority = getMajorityReviewers(votes, result);

    expect(majority).toEqual(["r_0", "r_1", "r_2"]);
  });

  it("small panel: excludes minority voters", () => {
    const votes: ReviewerVote[] = [
      { reviewer_id: "r_0", tier: "GOLD", value: 75 },
      { reviewer_id: "r_1", tier: "GOLD", value: 75 },
      { reviewer_id: "r_2", tier: "GOLD", value: 25 },
    ];
    const result = aggregateSmallPanel(votes);
    const majority = getMajorityReviewers(votes, result);

    expect(majority).not.toContain("r_2");
    expect(majority).toHaveLength(2);
  });

  it("large panel: returns voters inside agreement zone", () => {
    // Tight cluster at 50 with outliers
    const votes: ReviewerVote[] = Array.from({ length: 13 }, (_, i) => ({
      reviewer_id: `r_${i}`,
      tier: "GOLD" as ReviewerTier,
      value: 50,
    }));
    votes.push({ reviewer_id: "r_out_low", tier: "GOLD", value: 5 });
    votes.push({ reviewer_id: "r_out_high", tier: "GOLD", value: 95 });

    const result = aggregateLargePanel(votes);
    const majority = getMajorityReviewers(votes, result);

    // The 13 voters at 50 should all be in the majority
    for (let i = 0; i < 13; i++) {
      expect(majority).toContain(`r_${i}`);
    }
  });

  it("large panel: excludes outliers", () => {
    const votes: ReviewerVote[] = Array.from({ length: 13 }, (_, i) => ({
      reviewer_id: `r_${i}`,
      tier: "GOLD" as ReviewerTier,
      value: 50,
    }));
    votes.push({ reviewer_id: "r_out_low", tier: "GOLD", value: 0 });
    votes.push({ reviewer_id: "r_out_high", tier: "GOLD", value: 100 });

    const result = aggregateLargePanel(votes);
    const majority = getMajorityReviewers(votes, result);

    expect(majority).not.toContain("r_out_low");
    expect(majority).not.toContain("r_out_high");
  });
});

// ===========================================================================
// 5. calculateCompensation
// ===========================================================================

describe("calculateCompensation", () => {
  it("distributes 70% of fee to pool", () => {
    const comp = calculateCompensation(10000, ["r_0", "r_1", "r_2"]);

    expect(comp.pool_minor).toBe(7000);
  });

  it("splits equally among majority reviewers", () => {
    const comp = calculateCompensation(10000, ["r_0", "r_1", "r_2"]);

    expect(comp.per_reviewer_minor).toBe(2333); // floor(7000 / 3)
    expect(comp.reviewer_count).toBe(3);
  });

  it("zero reviewers -> 0 per reviewer", () => {
    const comp = calculateCompensation(10000, []);

    expect(comp.pool_minor).toBe(7000);
    expect(comp.per_reviewer_minor).toBe(0);
    expect(comp.reviewer_count).toBe(0);
  });
});

// ===========================================================================
// 6. Determinism
// ===========================================================================

describe("deterministic", () => {
  it("same votes twice -> identical result (trimmed mean is deterministic)", () => {
    const makeFixedVotes = (): ReviewerVote[] =>
      Array.from({ length: 20 }, (_, i) => ({
        reviewer_id: `r_${i}`,
        tier: "GOLD" as ReviewerTier,
        value: 40 + (i % 5) * 5, // 40, 45, 50, 55, 60 repeating
      }));

    const result1 = aggregateVotes(makeFixedVotes());
    const result2 = aggregateVotes(makeFixedVotes());

    expect(result1).toEqual(result2);
  });
});

// ---------------------------------------------------------------------------
// Expertise & Accuracy Bonuses
// ---------------------------------------------------------------------------
describe("expertise and accuracy bonuses", () => {
  it("expertise match increases effective weight", () => {
    // 2 experts vote 100, 3 non-experts vote 0 — experts should win due to bonus
    const votes: ReviewerVote[] = [
      { reviewer_id: "r_1", tier: "GOLD", value: 100, expertise_match: true },
      { reviewer_id: "r_2", tier: "GOLD", value: 100, expertise_match: true },
      { reviewer_id: "r_3", tier: "GOLD", value: 0 },
      { reviewer_id: "r_4", tier: "GOLD", value: 0 },
      { reviewer_id: "r_5", tier: "GOLD", value: 0 },
    ];
    const result = aggregateSmallPanel(votes);
    // Expert weight: 1.10 * 1.3 = 1.43 × 2 = 2.86
    // Non-expert weight: 1.10 × 3 = 3.30
    // Non-experts still win by raw weight, but margin is much smaller
    expect(result.result).toBe(0); // 3 non-experts still outnumber
    // Non-expert: 1.10×3=3.30 (53.5%) vs Expert: 1.10×1.3×2=2.86 (46.5%)
    // 53.5% is "moderate" (45-60%), not "strong" — experts pulled it close
    expect(result.strength).toBe("moderate");
  });

  it("expertise match weight is tier × 1.3", () => {
    const expert: ReviewerVote = {
      reviewer_id: "r_expert",
      tier: "GOLD",
      value: 50,
      expertise_match: true,
    };
    // Expected: 1.10 × 1.3 = 1.43
    const votes = [expert];
    const result = aggregateSmallPanel(votes);
    expect(result.total_weight).toBeCloseTo(1.43, 2);
  });

  it("bonuses work with Trimmed Mean (large panel, deterministic)", () => {
    const votes: ReviewerVote[] = [];
    // 10 experts voting ~70
    for (let i = 0; i < 10; i++) {
      votes.push({ reviewer_id: `exp_${i}`, tier: "GOLD", value: 65 + i, expertise_match: true });
    }
    // 8 non-experts voting ~30
    for (let i = 0; i < 8; i++) {
      votes.push({ reviewer_id: `non_${i}`, tier: "GOLD", value: 25 + i });
    }

    const result1 = aggregateVotes(votes);
    const result2 = aggregateVotes(votes);
    expect(result1).toEqual(result2); // deterministic
    expect(result1.mode).toBe("large");
    // Experts have higher weight → trimmed mean should lean toward ~70
    expect((result1 as any).raw_mean).toBeGreaterThan(45);
  });
});
