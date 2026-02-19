import type { NegotiationContext, UtilityResult } from '../types.js';
import { validateContext } from '../validation.js';
import { computeVp } from './v-price.js';
import { computeVt } from './v-time.js';
import { computeVr } from './v-risk.js';
import { computeVs } from './v-relationship.js';
import { adjustVpForCompetition } from './competition.js';

/**
 * Compute total utility from a NegotiationContext.
 * U_total = w_p * V_p + w_t * V_t + w_r * V_r + w_s * V_s
 *
 * Pure function: no side effects, deterministic.
 */
export function computeUtility(ctx: NegotiationContext): UtilityResult {
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
  const vt = computeVt(ctx.time);
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
