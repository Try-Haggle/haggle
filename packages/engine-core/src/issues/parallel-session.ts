/**
 * Parallel Session Expected Utility (Section 11.5)
 *
 * EU_s = P̂_close_s · U_total(ω*_s, c_s) + (1 − P̂_close_s) · U_BATNA_neg_s − κ · T_s
 *
 * Used to rank concurrent negotiation sessions and compute dynamic BATNA.
 * Pure functions, no side effects.
 */

import type { ParallelSessionEval } from './types.js';

/**
 * Compute the expected utility for a single parallel session.
 *
 * EU_s = p_close * u_best + (1 - p_close) * u_batna_other - kappa * t_spent
 */
export function computeParallelSessionEU(
  session: Omit<ParallelSessionEval, 'eu'>,
): ParallelSessionEval {
  const eu =
    session.p_close * session.u_best +
    (1 - session.p_close) * session.u_batna_other -
    session.kappa * session.t_spent;

  return { ...session, eu };
}

/**
 * Rank parallel sessions by expected utility (descending).
 *
 * Computes EU for each session and returns them sorted from highest to lowest.
 */
export function rankParallelSessions(
  sessions: Omit<ParallelSessionEval, 'eu'>[],
): ParallelSessionEval[] {
  return sessions
    .map(computeParallelSessionEU)
    .sort((a, b) => b.eu - a.eu);
}

/**
 * Compute dynamic BATNA for a session by looking at the best alternative
 * among all other parallel sessions.
 *
 * BATNA_s = max over other sessions of (p_close_j * u_best_j)
 *
 * Returns 0 if no other sessions exist.
 */
export function computeDynamicBatna(
  sessions: ParallelSessionEval[],
  excludeSessionId: string,
): number {
  const others = sessions.filter((s) => s.session_id !== excludeSessionId);
  if (others.length === 0) return 0;
  return Math.max(...others.map((s) => s.p_close * s.u_best));
}
