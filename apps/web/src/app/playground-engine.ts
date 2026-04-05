export type DecisionAction = "ACCEPT" | "COUNTER" | "REJECT" | "NEAR_DEAL" | "ESCALATE";

export interface UtilityWeights {
  w_p: number;
  w_t: number;
  w_r: number;
  w_s: number;
}

export interface PriceContext {
  p_effective: number;
  p_target: number;
  p_limit: number;
}

export interface TimeContext {
  t_elapsed: number;
  t_deadline: number;
  alpha: number;
  v_t_floor: number;
}

export interface RiskContext {
  r_score: number;
  i_completeness: number;
  w_rep: number;
  w_info: number;
}

export interface RelationshipContext {
  n_success: number;
  n_dispute_losses: number;
  n_threshold: number;
  v_s_base: number;
}

export interface NegotiationContext {
  weights: UtilityWeights;
  price: PriceContext;
  time: TimeContext;
  risk: RiskContext;
  relationship: RelationshipContext;
}

export interface UtilityResult {
  u_total: number;
  v_p: number;
  v_t: number;
  v_r: number;
  v_s: number;
}

export interface SessionState {
  rounds_no_concession: number;
}

export interface DecisionThresholds {
  u_threshold: number;
  u_aspiration: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeVp(price: PriceContext): number {
  const { p_effective, p_target, p_limit } = price;
  const isBuyer = p_target < p_limit;

  if (isBuyer) {
    if (p_effective >= p_limit) return 0;
  } else if (p_effective <= p_limit) {
    return 0;
  }

  const diffOffer = Math.abs(p_limit - p_effective);
  const diffTarget = Math.abs(p_limit - p_target);
  return clamp(Math.log(diffOffer + 1) / Math.log(diffTarget + 1), 0, 1);
}

function computeVt(time: TimeContext): number {
  const { t_elapsed, t_deadline, alpha, v_t_floor } = time;
  const vtRaw = Math.max(0, 1 - t_elapsed / t_deadline) ** alpha;
  return Math.max(v_t_floor, vtRaw);
}

function computeVr(risk: RiskContext): number {
  return risk.w_rep * risk.r_score + risk.w_info * risk.i_completeness;
}

function computeVs(rel: RelationshipContext): number {
  const pDispute = rel.n_dispute_losses * -0.3;
  return clamp(rel.v_s_base + rel.n_success / rel.n_threshold + pDispute, 0, 1);
}

export function computeUtility(ctx: NegotiationContext): UtilityResult {
  const v_p = computeVp(ctx.price);
  const v_t = computeVt(ctx.time);
  const v_r = computeVr(ctx.risk);
  const v_s = computeVs(ctx.relationship);
  const { w_p, w_t, w_r, w_s } = ctx.weights;

  return {
    u_total: w_p * v_p + w_t * v_t + w_r * v_r + w_s * v_s,
    v_p,
    v_t,
    v_r,
    v_s,
  };
}

export function computeCounterOffer(params: {
  p_start: number;
  p_limit: number;
  t: number;
  T: number;
  beta: number;
}): number {
  const { p_start, p_limit, t, T, beta } = params;
  const ratio = Math.min(t / T, 1);
  return p_start + (p_limit - p_start) * ratio ** (1 / beta);
}

export function makeDecision(
  utility: UtilityResult,
  thresholds: DecisionThresholds,
  session: SessionState,
): { action: DecisionAction } {
  const u = utility.u_total;
  const vt = utility.v_t;

  if (u >= thresholds.u_aspiration) {
    return { action: "ACCEPT" };
  }
  if (u >= thresholds.u_threshold && vt < 0.1) {
    return { action: "ACCEPT" };
  }
  if (u >= thresholds.u_threshold) {
    return { action: "NEAR_DEAL" };
  }
  if (session.rounds_no_concession >= 4) {
    return { action: "ESCALATE" };
  }
  if (vt < 0.05 && u < thresholds.u_threshold) {
    return { action: "ESCALATE" };
  }
  if (u > 0) {
    return { action: "COUNTER" };
  }
  return { action: "REJECT" };
}
