import type {
  DSTier,
  DSInput,
  DSResult,
  PromotionResult,
  TagData,
  TagSpecialization,
} from "./types.js";
import { DS_TIER_BOUNDARIES, DS_VOTE_WEIGHTS } from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hysteresis buffer for tier transitions */
const HYSTERESIS_BUFFER = 3;

/** Minimum recent cases required for tier change */
const MIN_RECENT_CASES_FOR_CHANGE = 5;

/** Minimum cases for cold start threshold */
const COLD_START_THRESHOLD = 5;

/** Tag specialization minimum case count */
const TAG_MIN_CASES = 10;

/** Tag specialization minimum zone hit rate */
const TAG_MIN_ZONE_HIT_RATE = 0.6;

/** Input weights for DS score computation */
const DS_WEIGHTS = {
  zone_hit_rate:         0.30,
  result_proximity:      0.25,
  participation_rate:    0.15,
  response_speed:        0.10,
  cumulative_cases:      0.10,
  category_diversity:    0.05,
  high_value_experience: 0.05,
} as const;

/** Normalization caps */
const RESPONSE_SPEED_MAX_HOURS = 48;
const CUMULATIVE_CASES_CAP = 200;
const CATEGORY_DIVERSITY_CAP = 10;
const HIGH_VALUE_CASES_CAP = 50;

// ---------------------------------------------------------------------------
// Tier order for promotion/demotion
// ---------------------------------------------------------------------------

const TIER_ORDER: DSTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"];

function tierIndex(tier: DSTier): number {
  return TIER_ORDER.indexOf(tier);
}

// ---------------------------------------------------------------------------
// Public Functions
// ---------------------------------------------------------------------------

/**
 * Compute the DS (Dispute Specialist) score from 7 weighted inputs.
 * Score range: 0-100.
 *
 * @param input - 7 input metrics for the reviewer
 * @returns DSResult with score, tier, and vote weight
 */
export function computeDSScore(input: DSInput): DSResult {
  // Normalize inputs to 0-1
  const response_speed = 1 - Math.min(input.response_hours / RESPONSE_SPEED_MAX_HOURS, 1);
  const cumulative_norm = Math.min(input.cumulative_cases / CUMULATIVE_CASES_CAP, 1);
  const diversity_norm =
    input.total_categories > 0
      ? Math.min(input.unique_categories / CATEGORY_DIVERSITY_CAP, 1)
      : 0;
  const high_value_norm = Math.min(input.high_value_cases / HIGH_VALUE_CASES_CAP, 1);

  // Weighted sum (all inputs are 0-1, result is 0-1)
  const raw =
    input.zone_hit_rate       * DS_WEIGHTS.zone_hit_rate +
    input.result_proximity    * DS_WEIGHTS.result_proximity +
    input.participation_rate  * DS_WEIGHTS.participation_rate +
    response_speed            * DS_WEIGHTS.response_speed +
    cumulative_norm           * DS_WEIGHTS.cumulative_cases +
    diversity_norm            * DS_WEIGHTS.category_diversity +
    high_value_norm           * DS_WEIGHTS.high_value_experience;

  // Scale to 0-100
  const score = Math.round(Math.min(Math.max(raw * 100, 0), 100));
  const tier = getDSTier(score);
  const vote_weight = getVoteWeight(tier);

  return { score, tier, vote_weight };
}

/**
 * Map a numeric score (0-100) to a DS tier.
 *
 * @param score - Numeric score 0-100
 * @returns DSTier
 */
export function getDSTier(score: number): DSTier {
  const clamped = Math.round(Math.min(Math.max(score, 0), 100));

  for (const tier of TIER_ORDER) {
    const bounds = DS_TIER_BOUNDARIES[tier];
    if (clamped >= bounds.min && clamped <= bounds.max) {
      return tier;
    }
  }

  return "DIAMOND"; // score > 100 after clamping shouldn't happen, but safety
}

/**
 * Get the vote weight for a given DS tier.
 *
 * @param tier - DSTier
 * @returns Vote weight multiplier
 */
export function getVoteWeight(tier: DSTier): number {
  return DS_VOTE_WEIGHTS[tier];
}

/**
 * Check if a reviewer should be promoted or demoted based on hysteresis rules.
 *
 * Promotion requires: score >= tier_upper_bound + HYSTERESIS_BUFFER AND recent_cases >= 5
 * Demotion requires: score <= tier_lower_bound - HYSTERESIS_BUFFER AND recent_cases >= 5
 *
 * @param current_tier - The reviewer's current tier
 * @param score - The reviewer's current score
 * @param recent_cases - Number of recent cases (for activity gate)
 * @returns PromotionResult indicating whether and how the tier should change
 */
export function checkPromotion(
  current_tier: DSTier,
  score: number,
  recent_cases: number,
): PromotionResult {
  const no_change: PromotionResult = {
    should_change: false,
    new_tier: current_tier,
    direction: "none",
  };

  // Activity gate: must have minimum recent cases
  if (recent_cases < MIN_RECENT_CASES_FOR_CHANGE) {
    return no_change;
  }

  const idx = tierIndex(current_tier);
  const bounds = DS_TIER_BOUNDARIES[current_tier];

  // Check promotion (can't promote above DIAMOND)
  if (idx < TIER_ORDER.length - 1) {
    const promotion_threshold = bounds.max + HYSTERESIS_BUFFER;
    if (score >= promotion_threshold) {
      const new_tier = TIER_ORDER[idx + 1];
      return { should_change: true, new_tier, direction: "promote" };
    }
  }

  // Check demotion (can't demote below BRONZE)
  if (idx > 0) {
    const demotion_threshold = bounds.min - HYSTERESIS_BUFFER;
    if (score <= demotion_threshold) {
      const new_tier = TIER_ORDER[idx - 1];
      return { should_change: true, new_tier, direction: "demote" };
    }
  }

  return no_change;
}

/**
 * Compute per-tag specialization for a reviewer.
 * Qualified if: tag_cases >= 10 AND zone_hit_rate >= 0.6
 *
 * @param tag_data - Per-tag performance data
 * @returns TagSpecialization with score, tier, and qualification status
 */
export function computeTagSpecialization(tag_data: TagData): TagSpecialization {
  // Use a simplified score based on available tag-level data
  const response_speed = 1 - Math.min(tag_data.response_hours / RESPONSE_SPEED_MAX_HOURS, 1);

  const raw =
    tag_data.zone_hit_rate     * DS_WEIGHTS.zone_hit_rate +
    tag_data.result_proximity  * DS_WEIGHTS.result_proximity +
    tag_data.participation_rate * DS_WEIGHTS.participation_rate +
    response_speed             * DS_WEIGHTS.response_speed;

  // Normalize: max possible from these weights = 0.80
  const max_possible = DS_WEIGHTS.zone_hit_rate +
    DS_WEIGHTS.result_proximity +
    DS_WEIGHTS.participation_rate +
    DS_WEIGHTS.response_speed;

  const score = Math.round(Math.min(Math.max((raw / max_possible) * 100, 0), 100));
  const tier = getDSTier(score);

  return {
    tag: tag_data.tag,
    score,
    tier,
    case_count: tag_data.case_count,
    zone_hit_rate: tag_data.zone_hit_rate,
  };
}

/**
 * Check if a tag specialization is qualified.
 * Requires: case_count >= 10 AND zone_hit_rate >= 0.6
 */
export function isTagQualified(spec: TagSpecialization): boolean {
  return spec.case_count >= TAG_MIN_CASES && spec.zone_hit_rate >= TAG_MIN_ZONE_HIT_RATE;
}

/**
 * Get the cold start threshold (minimum cases before first DS score).
 */
export function getColdStartThreshold(): number {
  return COLD_START_THRESHOLD;
}
