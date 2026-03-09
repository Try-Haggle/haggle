import type { UtilityWeights, CompetitionContext } from '@haggle/engine-core';

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
