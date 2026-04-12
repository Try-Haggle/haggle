import type { NegotiationContext, UtilityResult } from '../types.js';
import { validateContext } from '../validation.js';
import { computeVp } from './v-price.js';
import { computeVt } from './v-time.js';
import { computeVr } from './v-risk.js';
import { computeVs } from './v-relationship.js';
import { adjustVpForCompetition } from './competition.js';
import { computeMultiTermUtility, validateTermSpace } from '../term/evaluator.js';

/**
 * Compute total utility from a NegotiationContext.
 *
 * Two evaluation paths:
 * 1. term_space provided → multi-term evaluation (weighted term utility)
 * 2. No term_space → classic 4-dimension: U = w_p*V_p + w_t*V_t + w_r*V_r + w_s*V_s
 *
 * Pure function: no side effects, deterministic.
 */
export function computeUtility(ctx: NegotiationContext): UtilityResult {
  // Multi-term path: when term_space is provided, bypass classic 4D
  if (ctx.term_space) {
    const tsError = validateTermSpace(ctx.term_space);
    if (tsError) {
      return {
        u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0,
        error: tsError,
        error_detail: 'term_space validation failed',
      };
    }
    const u = computeMultiTermUtility(ctx.term_space);
    return { u_total: u, v_p: 0, v_t: 0, v_r: 0, v_s: 0 };
  }

  // Classic 4-dimension path
  const validationError = validateContext(ctx);
  if (validationError) {
    return {
      u_total: 0,
      v_p: 0,
      v_t: 0,
      v_r: 0,
      v_s: 0,
      error: validationError.error,
      error_detail: validationError.detail,
    };
  }

  const vp = computeVp(ctx.price);
  const vpAdjusted = adjustVpForCompetition(vp, ctx.competition, ctx.gamma);
  const vt = computeVt(ctx.time, ctx.hold);
  const vr = computeVr(ctx.risk);
  const vs = computeVs(ctx.relationship);

  const { w_p, w_t, w_r, w_s } = ctx.weights;
  const uTotal = w_p * vpAdjusted + w_t * vt + w_r * vr + w_s * vs;

  return {
    u_total: uTotal,
    v_p: vpAdjusted,
    v_t: vt,
    v_r: vr,
    v_s: vs,
  };
}
