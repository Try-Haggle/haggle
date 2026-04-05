import { describe, it, expect } from "vitest";
import {
  computeDSScore,
  getDSTier,
  getVoteWeight,
  checkPromotion,
  computeTagSpecialization,
  isTagQualified,
  getColdStartThreshold,
} from "../ds-rating.js";
import type { DSInput, TagData } from "../types.js";

// ---------------------------------------------------------------------------
// Helper: create a full DSInput with defaults
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<DSInput> = {}): DSInput {
  return {
    zone_hit_rate: 0.5,
    result_proximity: 0.5,
    participation_rate: 0.5,
    response_hours: 24,
    cumulative_cases: 100,
    unique_categories: 5,
    total_categories: 16,
    high_value_cases: 25,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getDSTier
// ---------------------------------------------------------------------------

describe("getDSTier", () => {
  it("maps 0 to BRONZE", () => {
    expect(getDSTier(0)).toBe("BRONZE");
  });

  it("maps 30 to BRONZE", () => {
    expect(getDSTier(30)).toBe("BRONZE");
  });

  it("maps 31 to SILVER", () => {
    expect(getDSTier(31)).toBe("SILVER");
  });

  it("maps 50 to SILVER", () => {
    expect(getDSTier(50)).toBe("SILVER");
  });

  it("maps 51 to GOLD", () => {
    expect(getDSTier(51)).toBe("GOLD");
  });

  it("maps 70 to GOLD", () => {
    expect(getDSTier(70)).toBe("GOLD");
  });

  it("maps 71 to PLATINUM", () => {
    expect(getDSTier(71)).toBe("PLATINUM");
  });

  it("maps 85 to PLATINUM", () => {
    expect(getDSTier(85)).toBe("PLATINUM");
  });

  it("maps 86 to DIAMOND", () => {
    expect(getDSTier(86)).toBe("DIAMOND");
  });

  it("maps 100 to DIAMOND", () => {
    expect(getDSTier(100)).toBe("DIAMOND");
  });
});

// ---------------------------------------------------------------------------
// getVoteWeight
// ---------------------------------------------------------------------------

describe("getVoteWeight", () => {
  it("returns 0.63 for BRONZE", () => {
    expect(getVoteWeight("BRONZE")).toBe(0.63);
  });

  it("returns 0.85 for SILVER", () => {
    expect(getVoteWeight("SILVER")).toBe(0.85);
  });

  it("returns 1.10 for GOLD", () => {
    expect(getVoteWeight("GOLD")).toBe(1.10);
  });

  it("returns 1.45 for PLATINUM", () => {
    expect(getVoteWeight("PLATINUM")).toBe(1.45);
  });

  it("returns 2.0 for DIAMOND", () => {
    expect(getVoteWeight("DIAMOND")).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// computeDSScore
// ---------------------------------------------------------------------------

describe("computeDSScore", () => {
  it("returns score, tier, and vote_weight", () => {
    const result = computeDSScore(makeInput());
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("vote_weight");
  });

  it("computes score in 0-100 range", () => {
    const result = computeDSScore(makeInput());
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns high score for perfect inputs", () => {
    const result = computeDSScore(makeInput({
      zone_hit_rate: 1.0,
      result_proximity: 1.0,
      participation_rate: 1.0,
      response_hours: 0,
      cumulative_cases: 200,
      unique_categories: 10,
      total_categories: 16,
      high_value_cases: 50,
    }));
    expect(result.score).toBe(100);
    expect(result.tier).toBe("DIAMOND");
  });

  it("returns low score for poor inputs", () => {
    const result = computeDSScore(makeInput({
      zone_hit_rate: 0.1,
      result_proximity: 0.1,
      participation_rate: 0.1,
      response_hours: 48,
      cumulative_cases: 0,
      unique_categories: 0,
      total_categories: 16,
      high_value_cases: 0,
    }));
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.tier).toBe("BRONZE");
  });

  it("assigns correct tier based on computed score", () => {
    const result = computeDSScore(makeInput());
    const expected_tier = getDSTier(result.score);
    expect(result.tier).toBe(expected_tier);
  });

  it("assigns correct vote weight based on tier", () => {
    const result = computeDSScore(makeInput());
    const expected_weight = getVoteWeight(result.tier);
    expect(result.vote_weight).toBe(expected_weight);
  });
});

// ---------------------------------------------------------------------------
// checkPromotion - hysteresis
// ---------------------------------------------------------------------------

describe("checkPromotion", () => {
  it("promotes GOLD to PLATINUM at score 73 with enough cases", () => {
    // Gold upper bound is 70, promotion threshold = 70 + 3 = 73
    const result = checkPromotion("GOLD", 73, 5);
    expect(result.should_change).toBe(true);
    expect(result.new_tier).toBe("PLATINUM");
    expect(result.direction).toBe("promote");
  });

  it("does not promote GOLD at score 72 (below threshold)", () => {
    const result = checkPromotion("GOLD", 72, 5);
    expect(result.should_change).toBe(false);
  });

  it("demotes PLATINUM to GOLD at score 67 with enough cases", () => {
    // Platinum lower bound is 71, demotion threshold = 71 - 3 = 68
    const result = checkPromotion("PLATINUM", 67, 5);
    expect(result.should_change).toBe(true);
    expect(result.new_tier).toBe("GOLD");
    expect(result.direction).toBe("demote");
  });

  it("does not demote PLATINUM at score 69 (above threshold)", () => {
    const result = checkPromotion("PLATINUM", 69, 5);
    expect(result.should_change).toBe(false);
  });

  it("does not change tier with insufficient recent cases", () => {
    const result = checkPromotion("GOLD", 73, 4);
    expect(result.should_change).toBe(false);
  });

  it("does not promote DIAMOND (already highest)", () => {
    const result = checkPromotion("DIAMOND", 100, 10);
    expect(result.should_change).toBe(false);
  });

  it("does not demote BRONZE (already lowest)", () => {
    const result = checkPromotion("BRONZE", 0, 10);
    expect(result.should_change).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeTagSpecialization
// ---------------------------------------------------------------------------

describe("computeTagSpecialization", () => {
  it("computes tag specialization score and tier", () => {
    const tag_data: TagData = {
      tag: "electronics",
      case_count: 15,
      zone_hit_rate: 0.8,
      result_proximity: 0.7,
      participation_rate: 0.9,
      response_hours: 12,
    };
    const result = computeTagSpecialization(tag_data);
    expect(result.tag).toBe("electronics");
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.case_count).toBe(15);
    expect(result.zone_hit_rate).toBe(0.8);
  });

  it("returns high score for excellent tag performance", () => {
    const tag_data: TagData = {
      tag: "luxury",
      case_count: 50,
      zone_hit_rate: 1.0,
      result_proximity: 1.0,
      participation_rate: 1.0,
      response_hours: 0,
    };
    const result = computeTagSpecialization(tag_data);
    expect(result.score).toBe(100);
    expect(result.tier).toBe("DIAMOND");
  });
});

// ---------------------------------------------------------------------------
// isTagQualified
// ---------------------------------------------------------------------------

describe("isTagQualified", () => {
  it("qualifies with case_count >= 10 and zone_hit_rate >= 0.6", () => {
    const spec = computeTagSpecialization({
      tag: "electronics",
      case_count: 10,
      zone_hit_rate: 0.6,
      result_proximity: 0.5,
      participation_rate: 0.5,
      response_hours: 24,
    });
    expect(isTagQualified(spec)).toBe(true);
  });

  it("rejects with case_count < 10", () => {
    const spec = computeTagSpecialization({
      tag: "electronics",
      case_count: 9,
      zone_hit_rate: 0.8,
      result_proximity: 0.5,
      participation_rate: 0.5,
      response_hours: 24,
    });
    expect(isTagQualified(spec)).toBe(false);
  });

  it("rejects with zone_hit_rate < 0.6", () => {
    const spec = computeTagSpecialization({
      tag: "electronics",
      case_count: 15,
      zone_hit_rate: 0.59,
      result_proximity: 0.5,
      participation_rate: 0.5,
      response_hours: 24,
    });
    expect(isTagQualified(spec)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getColdStartThreshold
// ---------------------------------------------------------------------------

describe("getColdStartThreshold", () => {
  it("returns 5 as the cold start threshold", () => {
    expect(getColdStartThreshold()).toBe(5);
  });
});
