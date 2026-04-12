import type { CompetitionContext } from '../types.js';
import { clamp } from '../utils.js';

const DEFAULT_GAMMA = 0.1;

/**
 * Adjust V_p for competition.
 * adjustment = 1 + gamma * ln(n_competitors + 1) * competition_signal
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
  const effectiveN = comp.n_competitors + (comp.n_hold_competitors ?? 0);
  const competitionSignal = comp.competitive_pressure ?? comp.market_position;
  const adjustment = 1 + gamma * Math.log(effectiveN + 1) * competitionSignal;
  return clamp(vp * adjustment, 0, 1);
}
