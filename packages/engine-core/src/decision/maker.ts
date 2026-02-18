import type { UtilityResult } from '../types.js';
import type { Decision, DecisionThresholds, SessionState } from './types.js';

/**
 * Decision Maker — converts UtilityResult into an action.
 *
 * Priority order (ref: architecture doc Section 10.1, Appendix A decide()):
 * 1. u >= u_aspiration         → ACCEPT
 * 2. u >= u_threshold && v_t < 0.1 → ACCEPT (deadline pressure)
 * 3. u >= u_threshold          → NEAR_DEAL
 * 4. rounds_no_concession >= 4 → ESCALATE (stalled)
 * 5. v_t < 0.05 && u < u_threshold → ESCALATE (deadline + no deal)
 * 6. u > 0                     → COUNTER
 * 7. else                      → REJECT
 */
export function makeDecision(
  utility: UtilityResult,
  thresholds: DecisionThresholds,
  session: SessionState,
): Decision {
  const u = utility.u_total;
  const { u_aspiration, u_threshold } = thresholds;
  const vt = utility.v_t;
  const roundsNoConcession = session.rounds_no_concession;

  if (u >= u_aspiration) {
    return { action: 'ACCEPT' };
  }
  if (u >= u_threshold && vt < 0.1) {
    return { action: 'ACCEPT' };
  }
  if (u >= u_threshold) {
    return { action: 'NEAR_DEAL' };
  }
  if (roundsNoConcession >= 4) {
    return { action: 'ESCALATE' };
  }
  if (vt < 0.05 && u < u_threshold) {
    return { action: 'ESCALATE' };
  }
  if (u > 0) {
    return { action: 'COUNTER' };
  }
  return { action: 'REJECT' };
}
