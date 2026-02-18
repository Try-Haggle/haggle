import type { RiskContext } from '../types.js';

/**
 * Compute V_r (risk utility).
 * V_r = w_rep * r_score + w_info * i_completeness
 */
export function computeVr(risk: RiskContext): number {
  return risk.w_rep * risk.r_score + risk.w_info * risk.i_completeness;
}
