// ---------------------------------------------------------------------------
// Legacy Dispute Types (service.ts, state-machine.ts, evidence-validator.ts)
// ---------------------------------------------------------------------------

export type DisputeStatus =
  | "OPEN"
  | "UNDER_REVIEW"
  | "WAITING_FOR_BUYER"
  | "WAITING_FOR_SELLER"
  | "RESOLVED_BUYER_FAVOR"
  | "RESOLVED_SELLER_FAVOR"
  | "PARTIAL_REFUND"
  | "CLOSED";

export interface DisputeEvidence {
  id: string;
  dispute_id: string;
  submitted_by: "buyer" | "seller" | "system";
  type: "text" | "image" | "tracking_snapshot" | "payment_proof" | "other";
  uri?: string;
  text?: string;
  created_at: string;
}

export interface DisputeResolution {
  outcome:
    | "buyer_favor"
    | "seller_favor"
    | "partial_refund"
    | "no_action";
  summary: string;
  refund_amount_minor?: number;
  resolved_at?: string;
}

export interface DisputeCase {
  id: string;
  order_id: string;
  reason_code: string;
  status: DisputeStatus;
  opened_by: "buyer" | "seller" | "system";
  opened_at: string;
  evidence: DisputeEvidence[];
  resolution?: DisputeResolution;
}

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
  reviewer_count: number | null;
  escalation_period_hours: number;
}

export interface Tier3DiscountResult {
  original_cost_cents: number;
  discounted_cost_cents: number;
  discount_pct: number;
  is_free_rereview: boolean;
}

// ---------------------------------------------------------------------------
// DS Rating
// ---------------------------------------------------------------------------

export type DSTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" | "DIAMOND";

export const DS_TIER_BOUNDARIES: Record<DSTier, { min: number; max: number }> = {
  BRONZE:   { min:  0, max: 30 },
  SILVER:   { min: 31, max: 50 },
  GOLD:     { min: 51, max: 70 },
  PLATINUM: { min: 71, max: 85 },
  DIAMOND:  { min: 86, max: 100 },
};

export const DS_VOTE_WEIGHTS: Record<DSTier, number> = {
  BRONZE:   0.63,
  SILVER:   0.85,
  GOLD:     1.10,
  PLATINUM: 1.45,
  DIAMOND:  2.0,
};

export interface DSInput {
  zone_hit_rate: number;        // 0-1
  result_proximity: number;     // 0-1
  participation_rate: number;   // 0-1
  response_hours: number;       // hours taken to respond
  cumulative_cases: number;     // total cases judged
  unique_categories: number;    // unique dispute categories
  total_categories: number;     // total categories available
  high_value_cases: number;     // cases with high-value disputes
}

export interface DSResult {
  score: number;
  tier: DSTier;
  vote_weight: number;
}

export interface PromotionResult {
  should_change: boolean;
  new_tier: DSTier;
  direction: "promote" | "demote" | "none";
}

export interface TagData {
  tag: string;
  case_count: number;
  zone_hit_rate: number;
  result_proximity: number;
  participation_rate: number;
  response_hours: number;
}

export interface TagSpecialization {
  tag: string;
  score: number;
  tier: DSTier;
  case_count: number;
  zone_hit_rate: number;
}

// ---------------------------------------------------------------------------
// Vote Aggregation
// ---------------------------------------------------------------------------

export interface ReviewerVote {
  reviewer_id: string;
  vote: number;   // 0-100 (percentage for buyer)
  weight: number;  // from DS tier
}

export interface AgreementZone {
  lower: number;
  upper: number;
  weight_in_zone: number;
  total_weight: number;
  strength: "strong" | "moderate" | "weak" | "failed";
}

export interface KMeansClusterInfo {
  cluster_a: { centroid: number; total_weight: number; vote_count: number };
  cluster_b: { centroid: number; total_weight: number; vote_count: number };
  winning_cluster: "a" | "b";
  iterations: number;
}

export interface AggregationResult {
  weighted_median: number;
  agreement_zone: { lower: number; upper: number } | null;
  strength: "strong" | "moderate" | "weak" | "failed";
  method: "weighted_median" | "kmeans_fallback";
  cluster_info?: KMeansClusterInfo;
}

export interface KMeansResult {
  result: number;
  cluster_info: KMeansClusterInfo;
}

// ---------------------------------------------------------------------------
// Dispute Deposit
// ---------------------------------------------------------------------------

export type DepositStatus = "PENDING" | "DEPOSITED" | "FORFEITED" | "REFUNDED";

export interface DisputeDeposit {
  dispute_id: string;
  amount_cents: number;
  status: DepositStatus;
  deposited_at?: string;
  resolved_at?: string;
}

export interface DepositRequirement {
  dispute_id: string;
  tier: 2 | 3;
  amount_cents: number;
  deadline_hours: number;
  seller_deposit: DisputeDeposit;
}

export interface DefaultJudgmentResult {
  winning_party: "buyer";
  reason: "seller_deposit_timeout";
}

// ---------------------------------------------------------------------------
// Dispute Settlement
// ---------------------------------------------------------------------------

export type SettlementHoldStatus = "HELD" | "RELEASED" | "REFUNDED" | "PARTIAL_REFUND";

export interface SettlementHold {
  dispute_id: string;
  order_id: string;
  held_amount_cents: number;
  status: SettlementHoldStatus;
  held_at: string;
  released_at?: string;
}

export interface SettlementResolution {
  hold: SettlementHold;
  buyer_receives_cents: number;
  seller_receives_cents: number;
  dispute_cost_cents: number;         // total dispute cost (from loser)
  reviewer_receives_cents: number;    // 70% of dispute cost
  platform_receives_cents: number;    // 30% of dispute cost + forfeited deposit
  deposit_refund_cents: number;       // seller deposit returned (if seller won)
}

/** Reviewer compensation share of dispute cost */
export const REVIEWER_SHARE = 0.70;
/** Platform share of dispute cost */
export const PLATFORM_SHARE = 0.30;
