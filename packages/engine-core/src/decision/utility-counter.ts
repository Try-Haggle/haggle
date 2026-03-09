import type { UtilityWeights } from '../types.js';
import { invertVp } from '../utility/invert-vp.js';
import { clamp } from '../utils.js';

/** Parameters for utility-space counter-offer computation. */
export interface UtilityCounterParams {
  /** Aspiration utility level. */
  u_aspiration: number;
  /** Minimum acceptable utility threshold. */
  u_threshold: number;
  /** Time elapsed. */
  t: number;
  /** Total deadline. */
  T: number;
  /** Concession speed (dynamic beta). */
  beta: number;
  /** Utility dimension weights. */
  weights: UtilityWeights;
  /** Current time utility value. */
  v_t: number;
  /** Current risk utility value. */
  v_r: number;
  /** Current relationship utility value. */
  v_s: number;
  /** Target price (best case). */
  p_target: number;
  /** Limit price (worst case). */
  p_limit: number;
}

/**
 * Compute counter-offer in utility space.
 *
 * Instead of conceding in price-space (Faratin), we:
 * 1. Compute the target total utility U_target(t) using the Faratin curve in utility space
 * 2. Back out the required v_p from U_target and the other utility dimensions
 * 3. Invert v_p to get the actual price
 *
 * Formula:
 *   U_target(t) = u_aspiration + (u_threshold - u_aspiration) * (t/T)^(1/beta)
 *   v_p_target = (U_target - w_t*v_t - w_r*v_r - w_s*v_s) / w_p
 *   price = invertVp(v_p_target, p_target, p_limit)
 */
export function computeUtilitySpaceCounterOffer(params: UtilityCounterParams): number {
  const {
    u_aspiration,
    u_threshold,
    t,
    T,
    beta,
    weights,
    v_t,
    v_r,
    v_s,
    p_target,
    p_limit,
  } = params;

  // 1. Compute target utility using Faratin curve in utility space
  const ratio = Math.min(t / T, 1);
  const u_target = u_aspiration + (u_threshold - u_aspiration) * Math.pow(ratio, 1 / beta);

  // 2. Back out the required v_p
  const nonPriceUtility = weights.w_t * v_t + weights.w_r * v_r + weights.w_s * v_s;
  let vp_target: number;

  if (weights.w_p > 0) {
    vp_target = (u_target - nonPriceUtility) / weights.w_p;
  } else {
    // Degenerate case: no price weight, fall back to target price
    return p_target;
  }

  // Clamp v_p to valid range [0, 1]
  vp_target = clamp(vp_target, 0, 1);

  // 3. Invert v_p to get the price
  return invertVp(vp_target, p_target, p_limit);
}
