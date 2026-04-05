import { describe, it, expect } from "vitest";
import {
  computeDSScore,
  getDSTier,
  getVoteWeight,
  checkPromotion,
  computeTagSpecialization,
} from "../ds-rating.js";
import type { DSInput, TagData } from "../types.js";

const PERFECT_INPUT: DSInput = {
  zone_hit_rate: 1.0,
  result_proximity: 1.0,
  participation_rate: 1.0,
  response_hours: 0,
  cumulative_cases: 200,
  unique_categories: 10,
  high_value_cases: 50,
};

const MEDIOCRE_INPUT: DSInput = {
  zone_hit_rate: 0.5,
  result_proximity: 0.5,
  participation_rate: 0.5,
  response_hours: 24,
  cumulative_cases: 50,
  unique_categories: 3,
  high_value_cases: 10,
};

describe("getDSTier", () => {
  it("maps score 0-30 to BRONZE", () => {
    expect(getDSTier(0)).toBe("BRONZE");
    expect(getDSTier(15)).toBe("BRONZE");
    expect(getDSTier(30)).toBe("BRONZE");
  });

  it("maps score 31-50 to SILVER", () => {
    expect(getDSTier(31)).toBe("SILVER");
    expect(getDSTier(50)).toBe("SILVER");
  });

  it("maps score 51-70 to GOLD", () => {
    expect(getDSTier(51)).toBe("GOLD");
    expect(getDSTier(70)).toBe("GOLD");
  });

  it("maps score 71-85 to PLATINUM", () => {
    expect(getDSTier(71)).toBe("PLATINUM");
    expect(getDSTier(85)).toBe("PLATINUM");
  });

  it("maps score 86-100 to DIAMOND", () => {
    expect(getDSTier(86)).toBe("DIAMOND");
    expect(getDSTier(100)).toBe("DIAMOND");
  });
});

describe("getVoteWeight", () => {
  it("returns correct weights per tier", () => {
    expect(getVoteWeight("BRONZE")).toBe(0.63);
    expect(getVoteWeight("SILVER")).toBe(0.85);
    expect(getVoteWeight("GOLD")).toBe(1.10);
    expect(getVoteWeight("PLATINUM")).toBe(1.45);
    expect(getVoteWeight("DIAMOND")).toBe(2.00);
  });
});

describe("computeDSScore", () => {
  it("returns cold start for < 5 cases", () => {
    const result = computeDSScore({ ...PERFECT_INPUT, cumulative_cases: 3 });
    expect(result.is_cold_start).toBe(true);
    expect(result.score).toBe(0);
    expect(result.tier).toBe("BRONZE");
  });

  it("computes score for 5+ cases", () => {
    const result = computeDSScore({ ...MEDIOCRE_INPUT, cumulative_cases: 5 });
    expect(result.is_cold_start).toBe(false);
    expect(result.score).toBeGreaterThan(0);
  });

  it("perfect inputs yield DIAMOND", () => {
    const result = computeDSScore(PERFECT_INPUT);
    expect(result.score).toBe(100);
    expect(result.tier).toBe("DIAMOND");
  });

  it("score is clamped to 0-100", () => {
    const result = computeDSScore(PERFECT_INPUT);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("slower response lowers score", () => {
    const fast = computeDSScore({ ...PERFECT_INPUT, response_hours: 0 });
    const slow = computeDSScore({ ...PERFECT_INPUT, response_hours: 48 });
    expect(fast.score).toBeGreaterThan(slow.score);
  });

  it("higher zone_hit_rate raises score", () => {
    const high = computeDSScore({ ...MEDIOCRE_INPUT, zone_hit_rate: 0.9 });
    const low = computeDSScore({ ...MEDIOCRE_INPUT, zone_hit_rate: 0.2 });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("vote_weight matches tier", () => {
    const result = computeDSScore(MEDIOCRE_INPUT);
    expect(result.vote_weight).toBe(getVoteWeight(result.tier));
  });
});

describe("checkPromotion", () => {
  it("no change with insufficient recent cases", () => {
    const result = checkPromotion("GOLD", 74, 3);
    expect(result.changed).toBe(false);
    expect(result.direction).toBe("none");
  });

  it("promotes Gold→Platinum at score 73 (70+3)", () => {
    const result = checkPromotion("GOLD", 73, 5);
    expect(result.changed).toBe(true);
    expect(result.new_tier).toBe("PLATINUM");
    expect(result.direction).toBe("promoted");
  });

  it("does not promote Gold at score 72", () => {
    const result = checkPromotion("GOLD", 72, 5);
    expect(result.changed).toBe(false);
  });

  it("demotes Platinum→Gold at score 68 (71-3)", () => {
    const result = checkPromotion("PLATINUM", 68, 5);
    expect(result.changed).toBe(true);
    expect(result.new_tier).toBe("GOLD");
    expect(result.direction).toBe("demoted");
  });

  it("does not demote Platinum at score 69", () => {
    const result = checkPromotion("PLATINUM", 69, 5);
    expect(result.changed).toBe(false);
  });

  it("cannot promote beyond DIAMOND", () => {
    const result = checkPromotion("DIAMOND", 100, 10);
    expect(result.changed).toBe(false);
    expect(result.new_tier).toBe("DIAMOND");
  });

  it("cannot demote below BRONZE", () => {
    const result = checkPromotion("BRONZE", -5, 10);
    expect(result.changed).toBe(false);
    expect(result.new_tier).toBe("BRONZE");
  });
});

describe("computeTagSpecialization", () => {
  const TAG_DATA: TagData = {
    tag: "electronics",
    zone_hit_rate: 0.8,
    result_proximity: 0.9,
    participation_rate: 0.85,
    response_hours: 6,
    case_count: 30,
    unique_categories: 5,
    high_value_cases: 10,
  };

  it("marks as qualified when case_count >= 10 and zone_hit_rate >= 0.6", () => {
    const result = computeTagSpecialization(TAG_DATA);
    expect(result.qualified).toBe(true);
  });

  it("marks as not qualified when case_count < 10", () => {
    const result = computeTagSpecialization({ ...TAG_DATA, case_count: 8 });
    expect(result.qualified).toBe(false);
  });

  it("marks as not qualified when zone_hit_rate < 0.6", () => {
    const result = computeTagSpecialization({ ...TAG_DATA, zone_hit_rate: 0.5 });
    expect(result.qualified).toBe(false);
  });

  it("computes score and tier for tag", () => {
    const result = computeTagSpecialization(TAG_DATA);
    expect(result.score).toBeGreaterThan(0);
    expect(result.tier).toBeDefined();
    expect(result.tag).toBe("electronics");
  });
});
