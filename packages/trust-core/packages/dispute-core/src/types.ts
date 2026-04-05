// ---------------------------------------------------------------------------
// Dispute Tiers
// ---------------------------------------------------------------------------

export type DisputeTier = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Dispute Cost
// ---------------------------------------------------------------------------

export interface DisputeCostResult {
  tier: DisputeTier;
  cost_cents: number;
  breakdown?: ProgressiveBreakdown[];
}

export interface ProgressiveBreakdown {
  range_label: string;
  amount_cents: number;
  rate: number;
  cost_cents: number;
}

export interface Tier3DiscountResult {
  original_cost_cents: number;
  discount_rate: number;
  final_cost_cents: number;
  is_re_review: boolean;
}

// ---------------------------------------------------------------------------
// Reviewer Count & Escalation
// ---------------------------------------------------------------------------

export interface ReviewerCountBracket {
  max_cents: number;
  tier2: number;
  tier3: number;
}

// ---------------------------------------------------------------------------
// DS Rating
// ---------------------------------------------------------------------------

export type DSTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";

export interface DSInput {
  zone_hit_rate: number;        // 0-1
  result_proximity: number;     // 0-1
  participation_rate: number;   // 0-1
  response_hours: number;       // hours to respond
  cumulative_cases: number;     // total cases
  unique_categories: number;    // unique categories judged
  high_value_cases: number;     // high-value dispute count
}

export interface DSResult {
  score: number;
  tier: DSTier;
  vote_weight: number;
  is_cold_start: boolean;
}

export interface DSWeightConfig {
  zone_hit_rate: number;
  result_proximity: number;
  participation_rate: number;
  response_speed: number;
  cumulative_cases: number;
  category_diversity: number;
  high_value_experience: number;
}

export const DEFAULT_DS_WEIGHTS: DSWeightConfig = {
  zone_hit_rate: 0.30,
  result_proximity: 0.25,
  participation_rate: 0.15,
  response_speed: 0.10,
  cumulative_cases: 0.10,
  category_diversity: 0.05,
  high_value_experience: 0.05,
};

export interface TierBoundary {
  tier: DSTier;
  min: number;
  max: number;
  vote_weight: number;
}

export const DS_TIER_BOUNDARIES: TierBoundary[] = [
  { tier: "BRONZE",   min: 0,  max: 30, vote_weight: 0.63 },
  { tier: "SILVER",   min: 31, max: 50, vote_weight: 0.85 },
  { tier: "GOLD",     min: 51, max: 70, vote_weight: 1.10 },
  { tier: "PLATINUM", min: 71, max: 85, vote_weight: 1.45 },
  { tier: "DIAMOND",  min: 86, max: 100, vote_weight: 2.00 },
];

export const HYSTERESIS_POINTS = 3;
export const HYSTERESIS_MIN_RECENT_CASES = 5;
export const DS_COLD_START_MIN_CASES = 5;

export interface PromotionResult {
  previous_tier: DSTier;
  new_tier: DSTier;
  changed: boolean;
  direction: "promoted" | "demoted" | "none";
}

export interface TagSpecialization {
  tag: string;
  score: number;
  tier: DSTier;
  vote_weight: number;
  case_count: number;
  zone_hit_rate: number;
  qualified: boolean;
}

export interface TagData {
  tag: string;
  zone_hit_rate: number;
  result_proximity: number;
  participation_rate: number;
  response_hours: number;
  case_count: number;
  unique_categories: number;
  high_value_cases: number;
}

// ---------------------------------------------------------------------------
// Vote Aggregation
// ---------------------------------------------------------------------------

export interface ReviewerVote {
  reviewer_id: string;
  vote: number;       // 0-100 (percentage for buyer)
  weight: number;      // from DS tier
}

export interface AgreementZone {
  lower: number;
  upper: number;
  weight_in_zone: number;
  total_weight: number;
  ratio: number;
}

export type AgreementStrength = "strong" | "moderate" | "weak" | "failed";

export interface KMeansClusterInfo {
  cluster_a: { centroid: number; total_weight: number; count: number };
  cluster_b: { centroid: number; total_weight: number; count: number };
  winner: "a" | "b";
  iterations: number;
}

export interface AggregationResult {
  weighted_median: number;
  agreement_zone: AgreementZone | null;
  strength: AgreementStrength;
  method: "weighted_median" | "kmeans_fallback";
  cluster_info?: KMeansClusterInfo;
}

export const AGREEMENT_ZONE_RADIUS = 15;
export const KMEANS_MAX_ITERATIONS = 50;
