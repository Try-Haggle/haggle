import type { RiskContext } from '../types.js';
import { clamp } from '../utils.js';

/**
 * Compute V_r (risk utility).
 * Backward compatible:
 *   V_r = w_rep * r_score + w_info * i_completeness
 *
 * If settlement reliability is supplied:
 *   V_r = weighted average of reputation, information completeness,
 *         and settlement reliability.
 */
export function computeVr(risk: RiskContext): number {
  const settlement =
    risk.settlement_reliability ?? (risk.approval_default_rate !== undefined ? 1 - risk.approval_default_rate : undefined);

  if (settlement === undefined || !risk.w_settlement || risk.w_settlement <= 0) {
    return risk.w_rep * risk.r_score + risk.w_info * risk.i_completeness;
  }

  const totalWeight = risk.w_rep + risk.w_info + risk.w_settlement;
  if (totalWeight <= 0) {
    return 0;
  }

  return clamp(
    (risk.w_rep * risk.r_score + risk.w_info * risk.i_completeness + risk.w_settlement * settlement) / totalWeight,
    0,
    1,
  );
}
