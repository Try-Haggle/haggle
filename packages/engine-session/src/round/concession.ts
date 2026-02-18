import type { HnpRole } from '../protocol/types.js';

/**
 * Determines whether a price movement constitutes a concession.
 *
 * - Buyer concedes by raising price (moving toward seller's preference).
 * - Seller concedes by lowering price (moving toward buyer's preference).
 *
 * Returns true if the price moved in the opponent's favor.
 */
export function trackConcession(
  prevOfferPrice: number,
  currentOfferPrice: number,
  role: HnpRole,
): boolean {
  if (role === 'BUYER') {
    return currentOfferPrice > prevOfferPrice;
  }
  // SELLER concedes by lowering price
  return currentOfferPrice < prevOfferPrice;
}
