// Concession pattern classifier (Doc 30 §2).
// Classifies negotiation behavior as BOULWARE / LINEAR / CONCEDER
// based on the shape of the concession curve.

import type { ConcessionPattern } from './types.js';

/**
 * Classify a sequence of concession rates into a Faratin-style pattern.
 *
 * - BOULWARE: Most concessions happen late (back-loaded). β < 1.
 * - LINEAR:   Concessions are roughly uniform across rounds.
 * - CONCEDER: Most concessions happen early (front-loaded). β > 1.
 *
 * Algorithm: Compare the sum of first-half concessions to the sum of
 * second-half concessions. The ratio determines the pattern.
 *
 * @param concessions Array of per-round concession amounts (absolute, non-negative).
 *                    Must have at least 2 entries for meaningful classification.
 */
export function classifyConcessionPattern(concessions: number[]): ConcessionPattern {
  if (concessions.length < 2) return 'LINEAR';

  const total = concessions.reduce((sum, c) => sum + c, 0);
  if (total === 0) return 'LINEAR';

  const midpoint = Math.ceil(concessions.length / 2);
  const firstHalfSum = concessions.slice(0, midpoint).reduce((sum, c) => sum + c, 0);
  const secondHalfSum = concessions.slice(midpoint).reduce((sum, c) => sum + c, 0);

  // Compare average concession per round in each half
  const firstHalfAvg = firstHalfSum / midpoint;
  const secondHalfAvg = secondHalfSum / (concessions.length - midpoint);

  // Avoid division by zero — if one half is zero, classify by the other
  if (secondHalfAvg === 0) return firstHalfAvg > 0 ? 'CONCEDER' : 'LINEAR';
  if (firstHalfAvg === 0) return 'BOULWARE';

  const ratio = firstHalfAvg / secondHalfAvg;

  // Thresholds: if first half avg >> second half avg → CONCEDER (front-loaded)
  //             if second half avg >> first half avg → BOULWARE (back-loaded)
  if (ratio > 1.5) return 'CONCEDER';
  if (ratio < 0.67) return 'BOULWARE';
  return 'LINEAR';
}

/**
 * Compute per-round concession rates from a price trajectory for a given role.
 *
 * Concession = price movement toward the opponent's preference:
 * - Buyer concedes by raising price
 * - Seller concedes by lowering price
 *
 * Returns absolute concession amounts (always >= 0). Non-concession moves return 0.
 */
export function extractConcessions(
  prices: number[],
  role: 'BUYER' | 'SELLER',
): number[] {
  const concessions: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    if (role === 'BUYER') {
      // Buyer concedes by raising price (positive delta)
      concessions.push(delta > 0 ? delta : 0);
    } else {
      // Seller concedes by lowering price (negative delta)
      concessions.push(delta < 0 ? -delta : 0);
    }
  }
  return concessions;
}

/**
 * Compute per-round concession rates as fractions of the initial spread.
 *
 * @param prices Price trajectory for one role.
 * @param initialSpread Absolute difference between initial buyer and seller prices.
 * @param role BUYER or SELLER.
 */
export function computeConcessionRates(
  prices: number[],
  initialSpread: number,
  role: 'BUYER' | 'SELLER',
): number[] {
  if (initialSpread === 0) return prices.slice(1).map(() => 0);
  const concessions = extractConcessions(prices, role);
  return concessions.map((c) => c / initialSpread);
}
