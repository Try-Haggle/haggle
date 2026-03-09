/**
 * Inverse of computeVp — given a target v_p value, recover the price.
 *
 * computeVp formula (buyer, p_target < p_limit):
 *   v_p = ln(p_limit - p_effective + 1) / ln(p_limit - p_target + 1)
 *
 * Inverting:
 *   p_limit - p_effective + 1 = (p_limit - p_target + 1)^v_p
 *   p_effective = p_limit - (p_limit - p_target + 1)^v_p + 1
 *
 * computeVp formula (seller, p_target > p_limit):
 *   v_p = ln(p_effective - p_limit + 1) / ln(p_target - p_limit + 1)
 *
 * Inverting:
 *   p_effective - p_limit + 1 = (p_target - p_limit + 1)^v_p
 *   p_effective = p_limit + (p_target - p_limit + 1)^v_p - 1
 */
export function invertVp(
  vp_target: number,
  p_target: number,
  p_limit: number,
): number {
  const isBuyer = p_target < p_limit;

  if (isBuyer) {
    const base = p_limit - p_target + 1;
    return p_limit - Math.pow(base, vp_target) + 1;
  }

  // Seller
  const base = p_target - p_limit + 1;
  return p_limit + Math.pow(base, vp_target) - 1;
}
