import type { CompetitionContext, SessionSnapshot } from '@haggle/engine-core';
import { compareSessions } from '@haggle/engine-core';
import type { GroupSnapshot, GroupAction, NegotiationGroup } from './types.js';

/**
 * Compute group-level competition context from active sessions.
 *
 * - n_competitors = active session count - 1
 * - competitive_pressure = batna / best_u_total (if batna exists), else 0
 * - market_position is per-session, so only a base is returned here
 */
export function computeGroupCompetition(
  snapshot: GroupSnapshot,
): Partial<CompetitionContext> {
  const active = snapshot.sessions;

  if (active.length <= 1) {
    return {
      n_competitors: 0,
      competitive_pressure: 0,
    };
  }

  const compareResult = compareSessions(active);
  const best = compareResult.rankings[0];
  const batna = compareResult.batna;

  const competitivePressure =
    batna !== undefined && best.u_total > 0 ? batna / best.u_total : 0;

  return {
    n_competitors: active.length - 1,
    competitive_pressure: competitivePressure,
  };
}

/**
 * Main orchestration function. Inspect group snapshot and produce actions.
 *
 * Logic:
 * 1. active sessions = 0 → close_group
 * 2. ACCEPTED session found (u_total >= thresholds.u_threshold as proxy) → supersede_losers
 *    - We detect "accepted" by checking if any session's u_total >= u_aspiration
 *      Actually, we don't know session status from SessionSnapshot alone.
 *      The brief says "ACCEPTED 세션 발견". We need to check if any session in
 *      snapshot matches a session that has been accepted. Since SessionSnapshot
 *      doesn't carry status, we rely on the caller to include only relevant sessions.
 *      However, the brief's orchestrateGroup checks the snapshot — we'll look at
 *      compareResult.recommended_action === 'ACCEPT_BEST' as the indicator.
 *
 * Re-reading the brief more carefully:
 * - "ACCEPTED 세션 발견 → supersede_losers (나머지 전부)"
 * - This means: if compareSessions recommends ACCEPT_BEST, the best session
 *   should be accepted and all others superseded.
 *
 * 3. active sessions 2+ → update_competition + update_batna
 * 4. active sessions 1 → no_action
 */
export function orchestrateGroup(snapshot: GroupSnapshot): GroupAction[] {
  const { group, sessions } = snapshot;
  const actions: GroupAction[] = [];

  // Non-ACTIVE group → no action
  if (group.status !== 'ACTIVE') {
    return [{ action: 'no_action', reason: `group status is ${group.status}` }];
  }

  const active = sessions;

  // Case 1: no active sessions
  if (active.length === 0) {
    return [{ action: 'close_group', reason: 'no active sessions remaining' }];
  }

  // Use compareSessions for BATNA and rankings
  const compareResult = compareSessions(active);

  // Case 2: ACCEPT_BEST recommended → supersede losers
  if (compareResult.recommended_action === 'ACCEPT_BEST' && active.length >= 1) {
    const best = compareResult.rankings[0];
    const losers = compareResult.rankings
      .slice(1)
      .map((r) => r.session_id);

    if (losers.length > 0) {
      actions.push({
        action: 'supersede_losers',
        winner_session_id: best.session_id,
        loser_session_ids: losers,
      });
    }

    return actions;
  }

  // Case 3: 2+ active sessions → update competition + batna
  if (active.length >= 2) {
    const competition = computeGroupCompetition(snapshot);
    const sessionIds = active.map((s) => s.session_id);

    actions.push({
      action: 'update_competition',
      session_ids: sessionIds,
      competition,
    });

    if (compareResult.batna !== undefined) {
      actions.push({
        action: 'update_batna',
        batna: compareResult.batna,
        best_session_id: compareResult.rankings[0].session_id,
      });
    }

    return actions;
  }

  // Case 4: exactly 1 active session → no competition
  return [{ action: 'no_action', reason: 'single active session, no competition' }];
}

/**
 * React to a session reaching terminal status at the group level.
 *
 * - ACCEPTED → supersede all other sessions in the group
 * - REJECTED / EXPIRED → if no active sessions remain → close_group, else no_action
 * - SUPERSEDED → no_action (already handled)
 */
export function handleSessionTerminal(
  group: NegotiationGroup,
  terminalSessionId: string,
  terminalStatus: 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'SUPERSEDED',
): GroupAction[] {
  if (terminalStatus === 'SUPERSEDED') {
    return [{ action: 'no_action', reason: 'session already superseded' }];
  }

  if (terminalStatus === 'ACCEPTED') {
    const losers = group.session_ids.filter((id) => id !== terminalSessionId);
    if (losers.length === 0) {
      return [{ action: 'no_action', reason: 'no other sessions to supersede' }];
    }
    return [
      {
        action: 'supersede_losers',
        winner_session_id: terminalSessionId,
        loser_session_ids: losers,
      },
    ];
  }

  // REJECTED or EXPIRED
  // Remaining active sessions = session_ids minus the terminal one
  // We don't know exact active count from NegotiationGroup alone (session_ids includes all),
  // but the terminal session just ended, so remaining = session_ids.length - 1
  // However, some may already be terminal. We can only count session_ids minus terminal.
  // The brief says "active 세션 수 확인 → 0개면 close_group, 아니면 no_action"
  // Since we only have session_ids (all sessions), and one just terminated,
  // remaining = session_ids.length - 1 (but others may also be terminal).
  // With just NegotiationGroup, we estimate: if only 1 session in group, close.
  // Otherwise, no_action (caller should recheck with full snapshot).
  const remainingIds = group.session_ids.filter((id) => id !== terminalSessionId);
  if (remainingIds.length === 0) {
    return [{ action: 'close_group', reason: `last session ${terminalStatus.toLowerCase()}, no sessions remaining` }];
  }

  return [{ action: 'no_action', reason: `session ${terminalStatus.toLowerCase()}, ${remainingIds.length} session(s) remain` }];
}
