import type {
  UtilityWeights,
  CompetitionContext,
  IssueWeight,
  IssueFaratinParams,
  RiskCostParams,
  RelationshipBonusParams,
} from '@haggle/engine-core';

/** Full negotiation strategy for a single product/session. */
export interface MasterStrategy {
  id: string;
  user_id: string;
  weights: UtilityWeights;
  p_target: number;
  p_limit: number;
  alpha: number;
  beta: number;
  t_deadline: number;
  v_t_floor: number;
  n_threshold: number;
  v_s_base: number;
  w_rep: number;
  w_info: number;
  u_threshold: number;
  u_aspiration: number;
  persona: string;
  gamma?: number;
  /** Dynamic beta: competition sensitivity (default 0.5). */
  kappa?: number;
  /** Dynamic beta: opponent response sensitivity (default 0.3). */
  lambda?: number;
  /** Use utility-space concession curve instead of price-space (default false). */
  use_utility_space?: boolean;
  created_at: number;
  expires_at: number;
}

// ---------------------------------------------------------------------------
// Multi-Issue Strategy (vNext)
// ---------------------------------------------------------------------------

/** Full negotiation strategy for multi-issue sessions. */
export interface MultiIssueMasterStrategy {
  id: string;
  user_id: string;
  /** Reference to the IssueSchema being used. */
  issue_schema_ref: string;
  /** Per-issue weights for utility computation. */
  issue_weights: IssueWeight[];
  /** Per-issue Faratin parameters (start/limit values). */
  issue_params: IssueFaratinParams[];
  /** Risk cost parameters. */
  risk: RiskCostParams;
  /** Relationship bonus parameters. */
  relationship: RelationshipBonusParams;
  /** Acceptance threshold base params. */
  u_batna: number;
  u_min: number;
  u_0: number;
  /** Faratin beta. */
  beta: number;
  /** Total deadline (seconds or rounds). */
  t_deadline: number;
  /** Stall threshold. */
  stall_threshold?: number;
  /** Deadline critical zone. */
  deadline_critical?: number;
  /** Offer search alpha (self-utility weight). */
  alpha?: number;
  /** Move cost penalty eta. */
  eta?: number;
  /** NEAR_DEAL band width (default 0.05). */
  near_deal_band?: number;
  /** Persona for LLM escalation. */
  persona: string;
  created_at: number;
  expires_at: number;
}

/** Per-round situational data for multi-issue negotiations. */
export interface MultiIssueRoundData {
  /** Normalized time progress [0, 1]. */
  tau: number;
  /** Current round number. */
  round: number;
  /** Risk signals for this round. */
  risk: RiskCostParams;
  /** Relationship signals for this round. */
  relationship: RelationshipBonusParams;
  /** Response time from opponent in ms (optional). */
  response_time_ms?: number;
}

// ---------------------------------------------------------------------------
// v1 Price-Only Strategy
// ---------------------------------------------------------------------------

/** Per-round situational data provided by the application layer. */
export interface RoundData {
  p_effective: number;
  r_score: number;
  i_completeness: number;
  t_elapsed: number;
  n_success: number;
  n_dispute_losses: number;
  competition?: CompetitionContext;
}
