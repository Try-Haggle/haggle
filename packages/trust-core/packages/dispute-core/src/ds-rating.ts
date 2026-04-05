import type {
  DSInput,
  DSResult,
  DSTier,
  DSWeightConfig,
  PromotionResult,
  TagData,
  TagSpecialization,
  TierBoundary,
} from "./types.js";
import {
  DEFAULT_DS_WEIGHTS,
  DS_COLD_START_MIN_CASES,
  DS_TIER_BOUNDARIES,
  HYSTERESIS_MIN_RECENT_CASES,
  HYSTERESIS_POINTS,
} from "./types.js";

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeResponseSpeed(hours: number): number {
  // Faster = higher. 0 hours = 1.0, 48+ hours = 0.0
  return Math.max(0, 1 - Math.min(hours / 48, 1));
}

function normalizeCumulativeCases(cases: number): number {
  return Math.min(cases / 200, 1);
}

function normalizeCategoryDiversity(unique: number): number {
  return Math.min(unique / 10, 1);
}

function normalizeHighValueExperience(cases: number): number {
  return Math.min(cases / 50, 1);
}

// ---------------------------------------------------------------------------
// computeDSScore
// ---------------------------------------------------------------------------

export function computeDSScore(
  input: DSInput,
  weights: DSWeightConfig = DEFAULT_DS_WEIGHTS,
): DSResult {
  const is_cold_start = input.cumulative_cases < DS_COLD_START_MIN_CASES;

  if (is_cold_start) {
    return {
      score: 0,
      tier: "BRONZE",
      vote_weight: getVoteWeight("BRONZE"),
      is_cold_start: true,
    };
  }

  const normalized = {
    zone_hit_rate: clamp01(input.zone_hit_rate),
    result_proximity: clamp01(input.result_proximity),
    participation_rate: clamp01(input.participation_rate),
    response_speed: normalizeResponseSpeed(input.response_hours),
    cumulative_cases: normalizeCumulativeCases(input.cumulative_cases),
    category_diversity: normalizeCategoryDiversity(input.unique_categories),
    high_value_experience: normalizeHighValueExperience(input.high_value_cases),
  };

  const score =
    normalized.zone_hit_rate * weights.zone_hit_rate +
    normalized.result_proximity * weights.result_proximity +
    normalized.participation_rate * weights.participation_rate +
    normalized.response_speed * weights.response_speed +
    normalized.cumulative_cases * weights.cumulative_cases +
    normalized.category_diversity * weights.category_diversity +
    normalized.high_value_experience * weights.high_value_experience;

  const finalScore = Math.round(clamp(score * 100, 0, 100));
  const tier = getDSTier(finalScore);

  return {
    score: finalScore,
    tier,
    vote_weight: getVoteWeight(tier),
    is_cold_start: false,
  };
}

// ---------------------------------------------------------------------------
// getDSTier
// ---------------------------------------------------------------------------

export function getDSTier(score: number): DSTier {
  for (const boundary of DS_TIER_BOUNDARIES) {
    if (score >= boundary.min && score <= boundary.max) {
      return boundary.tier;
    }
  }
  // score > 100 → DIAMOND
  return "DIAMOND";
}

// ---------------------------------------------------------------------------
// getVoteWeight
// ---------------------------------------------------------------------------

export function getVoteWeight(tier: DSTier): number {
  const boundary = DS_TIER_BOUNDARIES.find(b => b.tier === tier);
  return boundary ? boundary.vote_weight : 0.63;
}

// ---------------------------------------------------------------------------
// checkPromotion — hysteresis-based tier change
// ---------------------------------------------------------------------------

export function checkPromotion(
  current_tier: DSTier,
  score: number,
  recent_cases: number,
): PromotionResult {
  const base: Pick<PromotionResult, "previous_tier"> = { previous_tier: current_tier };

  // Not enough recent activity
  if (recent_cases < HYSTERESIS_MIN_RECENT_CASES) {
    return { ...base, new_tier: current_tier, changed: false, direction: "none" };
  }

  const current = findBoundary(current_tier);
  if (!current) {
    return { ...base, new_tier: current_tier, changed: false, direction: "none" };
  }

  const currentIdx = DS_TIER_BOUNDARIES.indexOf(current);

  // Check promotion: score >= upper boundary + hysteresis
  if (currentIdx < DS_TIER_BOUNDARIES.length - 1) {
    const promotion_threshold = current.max + HYSTERESIS_POINTS;
    if (score >= promotion_threshold) {
      const new_tier = DS_TIER_BOUNDARIES[currentIdx + 1].tier;
      return { ...base, new_tier, changed: true, direction: "promoted" };
    }
  }

  // Check demotion: score <= lower boundary - hysteresis
  if (currentIdx > 0) {
    const demotion_threshold = current.min - HYSTERESIS_POINTS;
    if (score <= demotion_threshold) {
      const new_tier = DS_TIER_BOUNDARIES[currentIdx - 1].tier;
      return { ...base, new_tier, changed: true, direction: "demoted" };
    }
  }

  return { ...base, new_tier: current_tier, changed: false, direction: "none" };
}

// ---------------------------------------------------------------------------
// computeTagSpecialization
// ---------------------------------------------------------------------------

export function computeTagSpecialization(
  tag_data: TagData,
  weights: DSWeightConfig = DEFAULT_DS_WEIGHTS,
): TagSpecialization {
  const qualified = tag_data.case_count >= 10 && tag_data.zone_hit_rate >= 0.6;

  const input: DSInput = {
    zone_hit_rate: tag_data.zone_hit_rate,
    result_proximity: tag_data.result_proximity,
    participation_rate: tag_data.participation_rate,
    response_hours: tag_data.response_hours,
    cumulative_cases: tag_data.case_count,
    unique_categories: tag_data.unique_categories,
    high_value_cases: tag_data.high_value_cases,
  };

  const result = computeDSScore(input, weights);

  return {
    tag: tag_data.tag,
    score: result.score,
    tier: result.tier,
    vote_weight: result.vote_weight,
    case_count: tag_data.case_count,
    zone_hit_rate: tag_data.zone_hit_rate,
    qualified,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBoundary(tier: DSTier): TierBoundary | undefined {
  return DS_TIER_BOUNDARIES.find(b => b.tier === tier);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
