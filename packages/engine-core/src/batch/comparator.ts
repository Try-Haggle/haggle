import type { SessionCompareResult, SessionSnapshot } from './types.js';

/**
 * Compare N session snapshots by u_total. Derive BATNA (2nd best) and recommendation.
 */
export function compareSessions(sessions: SessionSnapshot[]): SessionCompareResult {
  if (sessions.length === 0) {
    return { rankings: [], recommended_action: 'ESCALATE' };
  }

  const sorted = sessions
    .map((s) => ({
      session_id: s.session_id,
      u_total: s.utility.u_total,
      thresholds: s.thresholds,
    }))
    .sort((a, b) => b.u_total - a.u_total);

  const rankings = sorted.map((s, i) => ({
    session_id: s.session_id,
    rank: i + 1,
    u_total: s.u_total,
  }));

  const batna = sorted.length >= 2 ? sorted[1].u_total : undefined;

  const best = sorted[0];
  let recommendedAction: SessionCompareResult['recommended_action'];

  if (best.u_total >= best.thresholds.u_aspiration) {
    recommendedAction = 'ACCEPT_BEST';
  } else if (best.u_total >= best.thresholds.u_threshold) {
    recommendedAction = 'CONTINUE';
  } else {
    recommendedAction = 'ESCALATE';
  }

  return {
    rankings,
    batna,
    recommended_action: recommendedAction,
  };
}
