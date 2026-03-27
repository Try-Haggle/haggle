import { describe, it, expect } from "vitest";
import {
  computeDSScore,
  mapScoreToTier,
  applyHysteresis,
  computeTagSpecialization,
  resolveDisputeWeight,
  getTierWeight,
  normalizeResponseSpeed,
  computeConsistency,
  HYSTERESIS_BUFFER,
  MIN_RECENT_CASES_FOR_CHANGE,
  TAG_SPEC_MIN_CASES,
  TAG_SPEC_MIN_ZONE_HIT,
  CONSISTENCY_STREAK_TARGET,
} from "../ds-rating.js";
import type { DSInput } from "../ds-rating.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function goodReviewer(overrides: Partial<DSInput> = {}): DSInput {
  return {
    zone_hit_rate: 0.85,
    result_proximity: 0.90,
    participation_rate: 0.95,
    response_speed: 0.80,
    total_cases_norm: 0.50,
    category_diversity: 0.60,
    high_value_experience: 0.40,
    consistency: 0.80,
    ...overrides,
  };
}

function weakReviewer(overrides: Partial<DSInput> = {}): DSInput {
  return {
    zone_hit_rate: 0.30,
    result_proximity: 0.35,
    participation_rate: 0.50,
    response_speed: 0.40,
    total_cases_norm: 0.10,
    category_diversity: 0.20,
    high_value_experience: 0.05,
    consistency: 0.20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDSScore
// ---------------------------------------------------------------------------

describe("computeDSScore", () => {
  it("computes score for a good reviewer", () => {
    const score = computeDSScore(goodReviewer());
    expect(score).toBeGreaterThan(70);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("computes score for a weak reviewer", () => {
    const score = computeDSScore(weakReviewer());
    expect(score).toBeLessThan(40);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns 100 for perfect inputs", () => {
    const perfect: DSInput = {
      zone_hit_rate: 1.0,
      result_proximity: 1.0,
      participation_rate: 1.0,
      response_speed: 1.0,
      total_cases_norm: 1.0,
      category_diversity: 1.0,
      high_value_experience: 1.0,
      consistency: 1.0,
    };
    expect(computeDSScore(perfect)).toBe(100);
  });

  it("returns 0 for zero inputs", () => {
    const zero: DSInput = {
      zone_hit_rate: 0,
      result_proximity: 0,
      participation_rate: 0,
      response_speed: 0,
      total_cases_norm: 0,
      category_diversity: 0,
      high_value_experience: 0,
      consistency: 0,
    };
    expect(computeDSScore(zero)).toBe(0);
  });

  it("clamps values above 1", () => {
    const over: DSInput = {
      zone_hit_rate: 1.5, // should clamp to 1
      result_proximity: 1.0,
      participation_rate: 1.0,
      response_speed: 1.0,
      total_cases_norm: 1.0,
      category_diversity: 1.0,
      high_value_experience: 1.0,
      consistency: 1.0,
    };
    expect(computeDSScore(over)).toBe(100);
  });

  it("consistency has significant impact (15% weight)", () => {
    const highConsistency = computeDSScore(goodReviewer({ consistency: 1.0 }));
    const lowConsistency = computeDSScore(goodReviewer({ consistency: 0.0 }));
    expect(highConsistency - lowConsistency).toBeGreaterThan(10);
  });

  it("Bronze reviewer with high consistency can reach Silver+", () => {
    // Weak reviewer but very consistent
    const recovering = computeDSScore(weakReviewer({
      consistency: 1.0,       // 10 consecutive zone hits
      zone_hit_rate: 0.60,    // improving
      result_proximity: 0.55, // improving
    }));
    expect(recovering).toBeGreaterThan(30); // above Bronze ceiling
  });

  it("zone_hit_rate has most impact (30% weight)", () => {
    const highZone = computeDSScore(goodReviewer({ zone_hit_rate: 1.0 }));
    const lowZone = computeDSScore(goodReviewer({ zone_hit_rate: 0.2 }));
    expect(highZone - lowZone).toBeGreaterThan(15); // 0.8 × 0.30 × 100 = 24
  });
});

// ---------------------------------------------------------------------------
// mapScoreToTier
// ---------------------------------------------------------------------------

describe("mapScoreToTier", () => {
  it("maps 0 to BRONZE", () => {
    expect(mapScoreToTier(0)).toBe("BRONZE");
  });

  it("maps 30 to BRONZE", () => {
    expect(mapScoreToTier(30)).toBe("BRONZE");
  });

  it("maps 31 to SILVER", () => {
    expect(mapScoreToTier(31)).toBe("SILVER");
  });

  it("maps 50 to SILVER", () => {
    expect(mapScoreToTier(50)).toBe("SILVER");
  });

  it("maps 51 to GOLD", () => {
    expect(mapScoreToTier(51)).toBe("GOLD");
  });

  it("maps 70 to GOLD", () => {
    expect(mapScoreToTier(70)).toBe("GOLD");
  });

  it("maps 71 to PLATINUM", () => {
    expect(mapScoreToTier(71)).toBe("PLATINUM");
  });

  it("maps 85 to PLATINUM", () => {
    expect(mapScoreToTier(85)).toBe("PLATINUM");
  });

  it("maps 86 to DIAMOND", () => {
    expect(mapScoreToTier(86)).toBe("DIAMOND");
  });

  it("maps 100 to DIAMOND", () => {
    expect(mapScoreToTier(100)).toBe("DIAMOND");
  });
});

// ---------------------------------------------------------------------------
// applyHysteresis
// ---------------------------------------------------------------------------

describe("applyHysteresis", () => {
  it("promotes Gold→Platinum at 74+ with 5+ cases", () => {
    // Gold range is 51-70. Platinum starts at 71.
    // Promotion needs: score >= 71 + 3 = 74
    const r = applyHysteresis(74, "GOLD", 10);
    expect(r.tier).toBe("PLATINUM");
    expect(r.tier_changed).toBe(true);
    expect(r.change_direction).toBe("promoted");
    expect(r.previous_tier).toBe("GOLD");
  });

  it("does NOT promote Gold→Platinum at 72 (within buffer)", () => {
    const r = applyHysteresis(72, "GOLD", 10);
    expect(r.tier).toBe("GOLD");
    expect(r.tier_changed).toBe(false);
  });

  it("does NOT promote with insufficient cases", () => {
    const r = applyHysteresis(80, "GOLD", 3); // only 3 cases
    expect(r.tier).toBe("GOLD");
    expect(r.tier_changed).toBe(false);
  });

  it("demotes Platinum→Gold at 67 or below with 5+ cases", () => {
    // Platinum min is 71. Demotion needs: score <= 71 - 3 = 68
    // But mapScoreToTier(67) = GOLD (51-70), so 67 works
    const r = applyHysteresis(67, "PLATINUM", 10);
    expect(r.tier).toBe("GOLD");
    expect(r.tier_changed).toBe(true);
    expect(r.change_direction).toBe("demoted");
  });

  it("does NOT demote Platinum at 69 (within buffer)", () => {
    const r = applyHysteresis(69, "PLATINUM", 10);
    expect(r.tier).toBe("PLATINUM");
    expect(r.tier_changed).toBe(false);
  });

  it("does NOT demote with insufficient cases", () => {
    const r = applyHysteresis(50, "PLATINUM", 2);
    expect(r.tier).toBe("PLATINUM");
    expect(r.tier_changed).toBe(false);
  });

  it("stays at BRONZE even with score 0", () => {
    // BRONZE is lowest — can't demote further
    const r = applyHysteresis(0, "BRONZE", 10);
    expect(r.tier).toBe("BRONZE");
    expect(r.tier_changed).toBe(false);
  });

  it("stays at DIAMOND even with score 100", () => {
    // DIAMOND is highest — can't promote further
    const r = applyHysteresis(100, "DIAMOND", 10);
    expect(r.tier).toBe("DIAMOND");
    expect(r.tier_changed).toBe(false);
  });

  it("can skip tiers on large score jump (Bronze→Gold)", () => {
    // Bronze, but score is 54 (Gold range 51-70)
    // Promotion to Silver needs 31+3=34 → yes
    // But mapScoreToTier(54) = GOLD, and GOLD idx > BRONZE idx
    const r = applyHysteresis(54, "BRONZE", 10);
    expect(r.tier).toBe("GOLD");
    expect(r.tier_changed).toBe(true);
    expect(r.change_direction).toBe("promoted");
  });

  it("returns correct tier_weight", () => {
    const r = applyHysteresis(74, "GOLD", 10);
    expect(r.tier_weight).toBe(getTierWeight("PLATINUM"));
    expect(r.tier_weight).toBe(1.20);
  });
});

// ---------------------------------------------------------------------------
// computeTagSpecialization
// ---------------------------------------------------------------------------

describe("computeTagSpecialization", () => {
  it("qualifies with 10+ cases and 60%+ zone hit", () => {
    const r = computeTagSpecialization("#electronics", 15, 0.75, 0.80);
    expect(r.qualified).toBe(true);
    expect(r.tag).toBe("#electronics");
    expect(r.score).toBeGreaterThan(0);
  });

  it("does not qualify with <10 cases", () => {
    const r = computeTagSpecialization("#electronics", 5, 0.90, 0.90);
    expect(r.qualified).toBe(false);
  });

  it("does not qualify with <60% zone hit rate", () => {
    const r = computeTagSpecialization("#electronics", 20, 0.50, 0.90);
    expect(r.qualified).toBe(false);
  });

  it("computes score as 60% zone + 40% proximity", () => {
    const r = computeTagSpecialization("#luxury", 10, 0.80, 0.70);
    // 0.80 × 0.60 + 0.70 × 0.40 = 0.48 + 0.28 = 0.76 → 76
    expect(r.score).toBe(76);
    expect(r.tier).toBe("PLATINUM"); // 71-85
  });

  it("maps score to correct tier", () => {
    const r = computeTagSpecialization("#books", 10, 0.60, 0.50);
    // 0.60 × 0.60 + 0.50 × 0.40 = 0.36 + 0.20 = 0.56 → 56
    expect(r.score).toBe(56);
    expect(r.tier).toBe("GOLD"); // 51-70
  });
});

// ---------------------------------------------------------------------------
// resolveDisputeWeight
// ---------------------------------------------------------------------------

describe("resolveDisputeWeight", () => {
  it("uses global tier when no tag match", () => {
    const r = resolveDisputeWeight("GOLD", [], ["#electronics"]);
    expect(r.source).toBe("global");
    expect(r.tier).toBe("GOLD");
    expect(r.weight).toBe(1.05);
  });

  it("uses tag specialization when matched and qualified", () => {
    const specs = [
      computeTagSpecialization("#electronics", 15, 0.80, 0.85),
    ];
    const r = resolveDisputeWeight("GOLD", specs, ["#electronics"]);
    expect(r.source).toBe("tag");
    expect(r.tag).toBe("#electronics");
    expect(r.tier).not.toBe("GOLD"); // tag spec likely higher
  });

  it("ignores unqualified tag specialization", () => {
    const specs = [
      computeTagSpecialization("#electronics", 3, 0.80, 0.85), // too few cases
    ];
    const r = resolveDisputeWeight("GOLD", specs, ["#electronics"]);
    expect(r.source).toBe("global");
  });

  it("ignores tag specialization that doesn't match dispute tags", () => {
    const specs = [
      computeTagSpecialization("#electronics", 15, 0.80, 0.85),
    ];
    const r = resolveDisputeWeight("GOLD", specs, ["#luxury"]); // no match
    expect(r.source).toBe("global");
  });

  it("picks best matching tag when multiple match", () => {
    const specs = [
      computeTagSpecialization("#electronics", 15, 0.70, 0.75), // lower score
      computeTagSpecialization("#apple", 20, 0.90, 0.88),       // higher score
    ];
    const r = resolveDisputeWeight("SILVER", specs, ["#electronics", "#apple"]);
    expect(r.source).toBe("tag");
    expect(r.tag).toBe("#apple"); // higher score wins
  });
});

// ---------------------------------------------------------------------------
// normalizeResponseSpeed
// ---------------------------------------------------------------------------

describe("normalizeResponseSpeed", () => {
  it("returns 1.0 for very fast response (≤12.5% of deadline)", () => {
    // 48h deadline, 5h response = 10.4%
    expect(normalizeResponseSpeed(5, 48)).toBe(1.0);
  });

  it("returns 1.0 for exactly 12.5% of deadline", () => {
    expect(normalizeResponseSpeed(6, 48)).toBe(1.0);
  });

  it("returns ~0.7-1.0 for mid-range response (12.5-50%)", () => {
    const score = normalizeResponseSpeed(24, 48); // 50%
    expect(score).toBeCloseTo(0.7, 1);
  });

  it("returns low score for slow response (near deadline)", () => {
    const score = normalizeResponseSpeed(44, 48); // ~92%
    expect(score).toBeLessThanOrEqual(0.2);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 for response at or past deadline", () => {
    expect(normalizeResponseSpeed(48, 48)).toBe(0);
    expect(normalizeResponseSpeed(50, 48)).toBe(0);
  });

  it("returns 1.0 for 0 or negative response time", () => {
    expect(normalizeResponseSpeed(0, 48)).toBe(1.0);
    expect(normalizeResponseSpeed(-1, 48)).toBe(1.0);
  });

  it("works with 72h deadline", () => {
    // 72h deadline, 6h response = 8.3%
    expect(normalizeResponseSpeed(6, 72)).toBe(1.0);
    // 72h deadline, 36h response = 50%
    expect(normalizeResponseSpeed(36, 72)).toBeCloseTo(0.7, 1);
  });
});

// ---------------------------------------------------------------------------
// computeConsistency
// ---------------------------------------------------------------------------

describe("computeConsistency", () => {
  it("returns 0 for 0 consecutive hits", () => {
    expect(computeConsistency(0)).toBe(0);
  });

  it("returns 0.5 for 5 consecutive hits (target 10)", () => {
    expect(computeConsistency(5)).toBe(0.5);
  });

  it("returns 1.0 for target streak (10)", () => {
    expect(computeConsistency(CONSISTENCY_STREAK_TARGET)).toBe(1.0);
  });

  it("caps at 1.0 for above target", () => {
    expect(computeConsistency(15)).toBe(1.0);
  });

  it("returns proportional value for partial streak", () => {
    expect(computeConsistency(3)).toBeCloseTo(0.3);
    expect(computeConsistency(7)).toBeCloseTo(0.7);
  });
});
