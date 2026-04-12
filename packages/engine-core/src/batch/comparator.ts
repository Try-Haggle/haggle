import type { SessionCompareResult, SessionSnapshot } from './types.js';

const HOLD_SELLER_RESERVED_BONUS = 0.02;
const HOLD_REPRICE_PENALTY = -0.02;

/**
 * Apply hold-based bonus/penalty to u_total for BATNA comparison.
 * SELLER_RESERVED: +0.02 bonus (seller committed to holding item)
 * SOFT_HOLD with reprice required: -0.02 penalty (price may change)
 */
function applyHoldAdjustment(snapshot: SessionSnapshot): number {
  const base = snapshot.utility.u_total;
  if (!snapshot.hold_status) return base;

  if (snapshot.hold_status.hold_kind === 'SELLER_RESERVED') {
    return base + HOLD_SELLER_RESERVED_BONUS;
  }
  if (snapshot.hold_status.hold_kind === 'SOFT_HOLD' && snapshot.hold_status.resume_reprice_required) {
    return base + HOLD_REPRICE_PENALTY;
  }
  return base;
}

/**
 * Compare N session snapshots by u_total. Derive BATNA (2nd best) and recommendation.
 * When hold_status is provided, applies bonus/penalty adjustments.
 */
export function compareSessions(sessions: SessionSnapshot[]): SessionCompareResult {
  if (sessions.length === 0) {
    return { rankings: [], recommended_action: 'ESCALATE' };
  }

  const sorted = sessions
    .map((s) => ({
      session_id: s.session_id,
      u_total: applyHoldAdjustment(s),
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
