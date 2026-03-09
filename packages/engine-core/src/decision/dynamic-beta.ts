import type { DynamicBetaParams } from './types.js';
import { clamp } from '../utils.js';

const DEFAULT_KAPPA = 0.5;
const DEFAULT_LAMBDA = 0.3;
const BETA_MIN = 0.1;
const BETA_MAX = 10.0;

/**
 * Compute dynamic beta based on competition and opponent behavior.
 *
 * Formula:
 *   beta_competition = beta_base * (1 + kappa * ln(n_competitors + 1))
 *   beta_dynamic = beta_competition * (1 + lambda * opponent_concession_rate)
 *   result = clamp(beta_dynamic, 0.1, 10.0)
 *
 * Intuition:
 * - More competitors → higher beta → concede slower (more alternatives)
 * - Opponent conceding → higher beta → concede slower (reciprocity)
 * - Opponent rigid → lower beta → concede faster (break deadlock)
 * - No competition/opponent data → returns beta_base unchanged
 */
export function computeDynamicBeta(params: DynamicBetaParams): number {
  const {
    beta_base,
    n_competitors = 0,
    opponent_concession_rate = 0,
    kappa = DEFAULT_KAPPA,
    lambda = DEFAULT_LAMBDA,
  } = params;

  // Competition adjustment
  const beta_competition = beta_base * (1 + kappa * Math.log(n_competitors + 1));

  // Opponent behavior adjustment
  const beta_dynamic = beta_competition * (1 + lambda * opponent_concession_rate);

  return clamp(beta_dynamic, BETA_MIN, BETA_MAX);
}
