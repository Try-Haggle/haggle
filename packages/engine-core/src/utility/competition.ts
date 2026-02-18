import type { CompetitionContext } from '../types.js';
import { clamp } from '../utils.js';

const DEFAULT_GAMMA = 0.1;

/**
 * Adjust V_p for competition.
 * adjustment = 1 + gamma * ln(n_competitors + 1) * market_position
 * v_p_adjusted = clamp(vp * adjustment, 0, 1)
 *
 * If comp is undefined, returns vp unchanged.
 */
export function adjustVpForCompetition(
  vp: number,
  comp: CompetitionContext | undefined,
  gamma: number = DEFAULT_GAMMA,
): number {
  if (!comp) return vp;
  const adjustment = 1 + gamma * Math.log(comp.n_competitors + 1) * comp.market_position;
  return clamp(vp * adjustment, 0, 1);
}
