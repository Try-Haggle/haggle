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
  /**
   * 승인 후 실제 결제/이행까지 이어질 확률 [0, 1].
   * 미결제/노쇼/배송 SLA 위반 등이 누적되면 감소한다.
   */
  settlement_reliability?: number;
  /**
   * settlement_reliability 가 있을 때의 가중치.
   */
  w_settlement?: number;
  /**
   * 승인 이후 결제나 이행으로 이어지지 않은 비율 [0, 1].
   * settlement_reliability 를 직접 계산하지 못하는 레이어를 위한 보조 입력.
   */
  approval_default_rate?: number;
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
  /**
   * 검증된 경쟁 세션 수.
   * 상대가 주장한 임의의 카운터 오퍼 수가 아니라, 플랫폼이 실제로 확인한
   * 병렬 경쟁 상대 수를 의미한다.
   */
  n_competitors: number;
  /**
   * 경쟁 강도 [0, 1].
   * "더 좋은 다른 딜이 있다"는 가격 압박이 아니라, 현재 시장에 유효한
   * 경쟁자가 존재한다는 신호를 정규화한 값이다.
   */
  competitive_pressure?: number;
  /**
   * 우리 제안/세션의 상대적 위치 [0, 1].
   * 정확한 타 경쟁 가격이 아니라, 현재 세션이 시장에서 얼마나 불리하거나
   * 유리한 위치인지 나타내는 값이다.
   */
  /**
   * @deprecated exact competitor price should not be used as a direct pressure
   * input. Keep only for backward compatibility with older evaluation paths.
   */
  best_alternative: number;
  market_position: number;
  /** Additional competitors who have a hold on the item. */
  n_hold_competitors?: number;
}

/** Hold state affecting negotiation urgency and competition. */
export interface HoldContext {
  is_held: boolean;
  hold_kind?: 'SOFT_HOLD' | 'SELLER_RESERVED';
  held_price_minor?: number;
  hold_remaining_ms?: number;
  hold_total_ms?: number;
  resume_reprice_required: boolean;
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
  /** Optional multi-term space. When provided, uses multi-term evaluation path. */
  term_space?: import('./term/types.js').TermSpace;
  /** Optional hold context for time pressure from inventory holds. */
  hold?: HoldContext;
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
