// ---------------------------------------------------------------------------
// DS Rating — Dispute Skill rating for Reviewers
// ---------------------------------------------------------------------------

import type { ReviewerTier } from "./vote-aggregation.js";
import { TIER_WEIGHTS } from "./vote-aggregation.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DSInput {
  /** Agreement Zone hit rate: fraction of votes that landed inside the zone. 0-1. */
  zone_hit_rate: number;

  /** Result proximity: avg of (1 - |my_vote - final_result| / 100) across cases. 0-1. */
  result_proximity: number;

  /** Participation rate: voted / assigned. 0-1. */
  participation_rate: number;

  /** Response speed: normalized (faster = higher). 0-1. */
  response_speed: number;

  /** Total cases reviewed, normalized to 0-1 (e.g., cases / 200, capped at 1). */
  total_cases_norm: number;

  /** Category diversity: unique categories / total categories on platform, capped at 1. */
  category_diversity: number;

  /** High-value experience: fraction of cases that were $1K+, normalized. 0-1. */
  high_value_experience: number;

  /**
   * Consistency: consecutive Zone hits / streak target (e.g., 10 consecutive = 1.0).
   * Rewards steady, reliable voting. Helps Bronze recover by rewarding streaks.
   */
  consistency: number;
}

export type DSWeightKey = keyof DSInput;

export type DSWeights = Record<DSWeightKey, number>;

export const DS_WEIGHTS_V1: DSWeights = {
  zone_hit_rate: 0.25,
  result_proximity: 0.20,
  participation_rate: 0.12,
  response_speed: 0.10,
  total_cases_norm: 0.08,
  category_diversity: 0.05,
  high_value_experience: 0.05,
  consistency: 0.15,
};

// ---------------------------------------------------------------------------
// Tier boundaries
// ---------------------------------------------------------------------------

export interface TierBoundary {
  tier: ReviewerTier;
  min_score: number;
  max_score: number;
}

export const TIER_BOUNDARIES: TierBoundary[] = [
  { tier: "BRONZE", min_score: 0, max_score: 30 },
  { tier: "SILVER", min_score: 31, max_score: 50 },
  { tier: "GOLD", min_score: 51, max_score: 70 },
  { tier: "PLATINUM", min_score: 71, max_score: 85 },
  { tier: "DIAMOND", min_score: 86, max_score: 100 },
];

/** Hysteresis buffer: must exceed boundary by this many points to promote/demote. */
export const HYSTERESIS_BUFFER = 3;

/** Minimum recent cases required to allow tier change. */
export const MIN_RECENT_CASES_FOR_CHANGE = 5;

// ---------------------------------------------------------------------------
// Response speed normalization
// ---------------------------------------------------------------------------

/**
 * Normalize response time to a 0-1 score.
 * Faster response → higher score, with bonus tiers.
 *
 * @param response_hours Hours from assignment to vote
 * @param deadline_hours Total hours allowed (e.g., 48)
 */
export function normalizeResponseSpeed(
  response_hours: number,
  deadline_hours: number,
): number {
  if (response_hours <= 0 || deadline_hours <= 0) return 1.0;
  if (response_hours >= deadline_hours) return 0;

  const ratio = response_hours / deadline_hours;

  // Tiered scoring:
  // ≤12.5% of deadline (e.g., ≤6h of 48h): 1.0 (excellent)
  // ≤50% of deadline (e.g., ≤24h of 48h): 0.7-1.0 (good)
  // ≤100% of deadline: 0.1-0.7 (acceptable)
  if (ratio <= 0.125) return 1.0;
  if (ratio <= 0.50) return 1.0 - (ratio - 0.125) * 0.8; // 1.0 → 0.7
  return 0.7 - (ratio - 0.50) * 1.2; // 0.7 → 0.1
}

// ---------------------------------------------------------------------------
// Consistency calculation
// ---------------------------------------------------------------------------

/** Target streak length for max consistency score. */
export const CONSISTENCY_STREAK_TARGET = 10;

/**
 * Compute consistency score from consecutive Zone hits.
 * streak / target, capped at 1.0.
 * A single miss resets the streak to 0.
 */
export function computeConsistency(consecutive_zone_hits: number): number {
  return Math.min(1.0, consecutive_zone_hits / CONSISTENCY_STREAK_TARGET);
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

/**
 * Compute DS raw score (0-100) from inputs.
 * All inputs must be 0-1. Weighted sum × 100.
 */
export function computeDSScore(
  input: DSInput,
  weights: DSWeights = DS_WEIGHTS_V1,
): number {
  let sum = 0;
  for (const key of Object.keys(weights) as DSWeightKey[]) {
    const value = Math.max(0, Math.min(1, input[key]));
    sum += value * weights[key];
  }
  return Math.round(Math.max(0, Math.min(100, sum * 100)));
}

/**
 * Map a raw score to a tier without hysteresis.
 * Used for initial assignment or display purposes.
 */
export function mapScoreToTier(score: number): ReviewerTier {
  for (const boundary of TIER_BOUNDARIES) {
    if (score >= boundary.min_score && score <= boundary.max_score) {
      return boundary.tier;
    }
  }
  return "DIAMOND"; // score > 100 edge case
}

/**
 * Get the voting weight for a tier.
 */
export function getTierWeight(tier: ReviewerTier): number {
  return TIER_WEIGHTS[tier];
}

// ---------------------------------------------------------------------------
// Hysteresis — promotion / demotion with buffer
// ---------------------------------------------------------------------------

export interface DSRatingResult {
  score: number;
  tier: ReviewerTier;
  tier_weight: number;
  previous_tier: ReviewerTier;
  tier_changed: boolean;
  change_direction: "promoted" | "demoted" | "none";
}

/**
 * Apply hysteresis rules to determine actual tier.
 *
 * Promotion: score >= next tier's min_score + HYSTERESIS_BUFFER AND recent_cases >= MIN
 * Demotion: score <= current tier's min_score - HYSTERESIS_BUFFER AND recent_cases >= MIN
 * Otherwise: stay at current tier.
 *
 * @param score Raw DS score (0-100)
 * @param current_tier The reviewer's current tier before this evaluation
 * @param recent_cases Number of cases in recent evaluation window
 */
export function applyHysteresis(
  score: number,
  current_tier: ReviewerTier,
  recent_cases: number,
): DSRatingResult {
  const natural_tier = mapScoreToTier(score);

  // Not enough recent activity — stay at current tier
  if (recent_cases < MIN_RECENT_CASES_FOR_CHANGE) {
    return {
      score,
      tier: current_tier,
      tier_weight: getTierWeight(current_tier),
      previous_tier: current_tier,
      tier_changed: false,
      change_direction: "none",
    };
  }

  const currentBoundary = TIER_BOUNDARIES.find((b) => b.tier === current_tier)!;
  const currentIdx = TIER_BOUNDARIES.indexOf(currentBoundary);

  // Check promotion (is there a higher tier?)
  if (currentIdx < TIER_BOUNDARIES.length - 1) {
    const nextBoundary = TIER_BOUNDARIES[currentIdx + 1];
    if (score >= nextBoundary.min_score + HYSTERESIS_BUFFER) {
      // Could promote multiple tiers — find the right one
      const new_tier = mapScoreToTier(score);
      const newIdx = TIER_BOUNDARIES.findIndex((b) => b.tier === new_tier);
      if (newIdx > currentIdx) {
        return {
          score,
          tier: new_tier,
          tier_weight: getTierWeight(new_tier),
          previous_tier: current_tier,
          tier_changed: true,
          change_direction: "promoted",
        };
      }
    }
  }

  // Check demotion (is there a lower tier?)
  if (currentIdx > 0) {
    if (score <= currentBoundary.min_score - HYSTERESIS_BUFFER) {
      const new_tier = mapScoreToTier(score);
      const newIdx = TIER_BOUNDARIES.findIndex((b) => b.tier === new_tier);
      if (newIdx < currentIdx) {
        return {
          score,
          tier: new_tier,
          tier_weight: getTierWeight(new_tier),
          previous_tier: current_tier,
          tier_changed: true,
          change_direction: "demoted",
        };
      }
    }
  }

  // No change — within hysteresis band or at boundary tier
  return {
    score,
    tier: current_tier,
    tier_weight: getTierWeight(current_tier),
    previous_tier: current_tier,
    tier_changed: false,
    change_direction: "none",
  };
}

// ---------------------------------------------------------------------------
// Tag specialization
// ---------------------------------------------------------------------------

/** Minimum cases in a tag to qualify for specialization. */
export const TAG_SPEC_MIN_CASES = 10;

/** Minimum zone hit rate in a tag to qualify. */
export const TAG_SPEC_MIN_ZONE_HIT = 0.60;

export interface TagSpecialization {
  tag: string;
  score: number;
  tier: ReviewerTier;
  tier_weight: number;
  cases: number;
  zone_hit_rate: number;
  result_proximity: number;
  qualified: boolean;
}

/**
 * Compute specialization score for a specific tag.
 * Uses a simplified formula: 60% zone_hit_rate + 40% result_proximity.
 * Only qualifies if cases >= 10 AND zone_hit_rate >= 0.60.
 */
export function computeTagSpecialization(
  tag: string,
  cases: number,
  zone_hit_rate: number,
  result_proximity: number,
): TagSpecialization {
  const qualified =
    cases >= TAG_SPEC_MIN_CASES && zone_hit_rate >= TAG_SPEC_MIN_ZONE_HIT;

  const raw = zone_hit_rate * 0.60 + result_proximity * 0.40;
  const score = Math.round(Math.max(0, Math.min(100, raw * 100)));
  const tier = mapScoreToTier(score);

  return {
    tag,
    score,
    tier,
    tier_weight: getTierWeight(tier),
    cases,
    zone_hit_rate,
    result_proximity,
    qualified,
  };
}

/**
 * Resolve which weight to use for a reviewer on a specific dispute.
 * If the reviewer has a qualified tag specialization matching the dispute,
 * use the tag-specific tier weight. Otherwise use the global DS tier weight.
 */
export function resolveDisputeWeight(
  global_tier: ReviewerTier,
  tag_specializations: TagSpecialization[],
  dispute_tags: string[],
): { tier: ReviewerTier; weight: number; source: "global" | "tag"; tag?: string } {
  // Find best matching qualified tag specialization
  let bestMatch: TagSpecialization | null = null;

  for (const spec of tag_specializations) {
    if (!spec.qualified) continue;
    if (!dispute_tags.includes(spec.tag)) continue;
    if (!bestMatch || spec.score > bestMatch.score) {
      bestMatch = spec;
    }
  }

  if (bestMatch) {
    return {
      tier: bestMatch.tier,
      weight: bestMatch.tier_weight,
      source: "tag",
      tag: bestMatch.tag,
    };
  }

  return {
    tier: global_tier,
    weight: getTierWeight(global_tier),
    source: "global",
  };
}
