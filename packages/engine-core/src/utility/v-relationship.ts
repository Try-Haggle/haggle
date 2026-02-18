import type { RelationshipContext } from '../types.js';
import { clamp } from '../utils.js';

/**
 * Compute V_s (relationship utility).
 * p_dispute = n_dispute_losses * (-0.3)
 * V_s = clamp(v_s_base + n_success / n_threshold + p_dispute, 0, 1)
 */
export function computeVs(rel: RelationshipContext): number {
  const pDispute = rel.n_dispute_losses * -0.3;
  return clamp(rel.v_s_base + rel.n_success / rel.n_threshold + pDispute, 0, 1);
}
