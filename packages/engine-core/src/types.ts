/** Utility dimension weights. Must sum to 1.0 (±1e-6). All non-negative. */
export interface UtilityWeights {
  w_p: number;
  w_t: number;
  w_r: number;
  w_s: number;
}

/** Price context. Role determined by p_target vs p_limit relationship. */
export interface PriceContext {
  p_effective: number;
  p_target: number;
  p_limit: number;
}

/** Time context with decay curve and floor. */
export interface TimeContext {
  t_elapsed: number;
  t_deadline: number;
  alpha: number;
  v_t_floor: number;
}

/** Risk context with reputation and information completeness. */
export interface RiskContext {
  r_score: number;
  i_completeness: number;
  w_rep: number;
  w_info: number;
}

/** Relationship context with success history and dispute penalties. */
export interface RelationshipContext {
  n_success: number;
  n_dispute_losses: number;
  n_threshold: number;
  v_s_base: number;
}

/** Optional competition context for 1:N / N:1 topologies. */
export interface CompetitionContext {
  n_competitors: number;
  best_alternative: number;
  market_position: number;
}

/** Full negotiation context — input to Engine Core. */
export interface NegotiationContext {
  weights: UtilityWeights;
  price: PriceContext;
  time: TimeContext;
  risk: RiskContext;
  relationship: RelationshipContext;
  competition?: CompetitionContext;
  gamma?: number;
}

/** Utility calculation result. */
export interface UtilityResult {
  u_total: number;
  v_p: number;
  v_t: number;
  v_r: number;
  v_s: number;
  error?: EngineError;
  error_detail?: string;
}

/** Engine validation errors. */
export enum EngineError {
  INVALID_WEIGHTS = 'INVALID_WEIGHTS',
  ZERO_PRICE_RANGE = 'ZERO_PRICE_RANGE',
  INVALID_DEADLINE = 'INVALID_DEADLINE',
  INVALID_ALPHA = 'INVALID_ALPHA',
  INVALID_RISK_INPUT = 'INVALID_RISK_INPUT',
  INVALID_THRESHOLD = 'INVALID_THRESHOLD',
}
