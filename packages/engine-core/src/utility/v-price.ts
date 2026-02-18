import type { PriceContext } from '../types.js';
import { clamp } from '../utils.js';

/**
 * Compute V_p (economic utility).
 *
 * Buyer (p_target < p_limit): V_p = 0 if p_effective >= p_limit,
 *   else clamp(ln(p_limit - p_effective + 1) / ln(p_limit - p_target + 1))
 *
 * Seller (p_target > p_limit): V_p = 0 if p_effective <= p_limit,
 *   else clamp(ln(p_effective - p_limit + 1) / ln(p_target - p_limit + 1))
 */
export function computeVp(price: PriceContext): number {
  const { p_effective, p_target, p_limit } = price;
  const isBuyer = p_target < p_limit;

  if (isBuyer) {
    if (p_effective >= p_limit) return 0;
  } else {
    if (p_effective <= p_limit) return 0;
  }

  const diffOffer = Math.abs(p_limit - p_effective);
  const diffTarget = Math.abs(p_limit - p_target);

  return clamp(Math.log(diffOffer + 1) / Math.log(diffTarget + 1), 0, 1);
}
