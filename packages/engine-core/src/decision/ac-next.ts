/**
 * AC_next acceptance condition.
 *
 * If the incoming offer is already at least as good as our counter-offer,
 * there is no point countering — accept immediately.
 *
 * Role detection uses the same convention as the rest of the engine:
 * - Buyer: p_target < p_limit → lower price is better → accept if incoming ≤ counter
 * - Seller: p_target > p_limit → higher price is better → accept if incoming ≥ counter
 */
export function shouldAcceptNext(
  incomingPrice: number,
  counterPrice: number,
  p_target: number,
  p_limit: number,
): boolean {
  const isBuyer = p_target < p_limit;

  if (isBuyer) {
    return incomingPrice <= counterPrice;
  }
  // Seller
  return incomingPrice >= counterPrice;
}
