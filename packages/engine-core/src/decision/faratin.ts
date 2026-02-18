import type { FaratinParams } from './types.js';

/**
 * Faratin concession curve — compute counter-offer price.
 * P(t) = P_start + (P_limit - P_start) * (t/T)^(1/beta)
 */
export function computeCounterOffer(params: FaratinParams): number {
  const { p_start, p_limit, t, T, beta } = params;
  const ratio = Math.min(t / T, 1); // clamp t/T to [0, 1]
  return p_start + (p_limit - p_start) * ratio ** (1 / beta);
}
