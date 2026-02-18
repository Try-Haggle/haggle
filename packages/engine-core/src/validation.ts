import type {
  NegotiationContext,
  PriceContext,
  RelationshipContext,
  RiskContext,
  TimeContext,
  UtilityWeights,
} from './types.js';
import { EngineError } from './types.js';

const WEIGHT_TOLERANCE = 1e-6;

export function validateWeights(w: UtilityWeights): EngineError | null {
  if (w.w_p < 0 || w.w_t < 0 || w.w_r < 0 || w.w_s < 0) {
    return EngineError.INVALID_WEIGHTS;
  }
  const sum = w.w_p + w.w_t + w.w_r + w.w_s;
  if (Math.abs(sum - 1.0) > WEIGHT_TOLERANCE) {
    return EngineError.INVALID_WEIGHTS;
  }
  return null;
}

export function validatePriceContext(p: PriceContext): EngineError | null {
  if (p.p_target === p.p_limit) {
    return EngineError.ZERO_PRICE_RANGE;
  }
  return null;
}

export function validateTimeContext(t: TimeContext): EngineError | null {
  if (t.t_deadline <= 0) {
    return EngineError.INVALID_DEADLINE;
  }
  if (t.alpha <= 0) {
    return EngineError.INVALID_ALPHA;
  }
  return null;
}

export function validateRiskContext(r: RiskContext): EngineError | null {
  if (r.r_score < 0 || r.r_score > 1 || r.i_completeness < 0 || r.i_completeness > 1) {
    return EngineError.INVALID_RISK_INPUT;
  }
  return null;
}

export function validateRelationshipContext(rel: RelationshipContext): EngineError | null {
  if (rel.n_threshold <= 0) {
    return EngineError.INVALID_THRESHOLD;
  }
  return null;
}

/** Validate the full NegotiationContext. Returns first error found, or null. */
export function validateContext(ctx: NegotiationContext): { error: EngineError; detail?: string } | null {
  const wErr = validateWeights(ctx.weights);
  if (wErr) {
    const sum = ctx.weights.w_p + ctx.weights.w_t + ctx.weights.w_r + ctx.weights.w_s;
    const hasNeg = ctx.weights.w_p < 0 || ctx.weights.w_t < 0 || ctx.weights.w_r < 0 || ctx.weights.w_s < 0;
    const detail = hasNeg ? 'negative weight' : `sum=${sum}`;
    return { error: wErr, detail };
  }

  const pErr = validatePriceContext(ctx.price);
  if (pErr) return { error: pErr };

  const tErr = validateTimeContext(ctx.time);
  if (tErr) return { error: tErr };

  const rErr = validateRiskContext(ctx.risk);
  if (rErr) return { error: rErr };

  const relErr = validateRelationshipContext(ctx.relationship);
  if (relErr) return { error: relErr };

  return null;
}
