/**
 * snapshot-builder.ts
 *
 * DB 세션 rows → 엔진 SessionSnapshot / GroupSnapshot 변환.
 * orchestrateGroup, computeGroupCompetition의 입력 데이터를 조립한다.
 */

import type { SessionSnapshot } from "@haggle/engine-core";
import type { NegotiationGroup, GroupSnapshot } from "@haggle/engine-session";
import type { DbSession } from "./session-reconstructor.js";

// ---------------------------------------------------------------------------
// Session snapshots (for engine-core compareSessions)
// ---------------------------------------------------------------------------

/**
 * Convert DB session rows to engine SessionSnapshot[].
 * Only includes sessions with last_utility (at least 1 round completed).
 */
export function buildSessionSnapshots(sessions: DbSession[]): SessionSnapshot[] {
  return sessions
    .filter((s) => s.lastUtility !== null)
    .map((s) => ({
      session_id: s.id,
      utility: {
        u_total: s.lastUtility!.u_total,
        v_p: s.lastUtility!.v_p,
        v_t: s.lastUtility!.v_t,
        v_r: s.lastUtility!.v_r,
        v_s: s.lastUtility!.v_s,
      },
      // Default thresholds — actual strategy thresholds come from snapshot
      thresholds: extractThresholds(s.strategySnapshot),
    }));
}

// ---------------------------------------------------------------------------
// Group snapshot (for engine-session orchestrateGroup)
// ---------------------------------------------------------------------------

export interface DbGroup {
  id: string;
  topology: "1_BUYER_N_SELLERS" | "N_BUYERS_1_SELLER";
  anchorUserId: string;
  intentId: string | null;
  maxSessions: number;
  status: string;
  batna: string | null;
  bestSessionId: string | null;
  version: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Build an engine NegotiationGroup from DB group + session IDs.
 */
export function buildEngineGroup(
  dbGroup: DbGroup,
  sessionIds: string[],
): NegotiationGroup {
  return {
    group_id: dbGroup.id,
    topology: dbGroup.topology,
    anchor_user_id: dbGroup.anchorUserId,
    intent_id: dbGroup.intentId ?? undefined,
    max_sessions: dbGroup.maxSessions,
    session_ids: sessionIds,
    status: dbGroup.status as NegotiationGroup["status"],
    created_at: dbGroup.createdAt.getTime(),
    updated_at: dbGroup.updatedAt.getTime(),
  };
}

/**
 * Build a full GroupSnapshot for orchestration.
 */
export function buildGroupSnapshot(
  dbGroup: DbGroup,
  dbSessions: DbSession[],
): GroupSnapshot {
  const activeStatuses = new Set(["CREATED", "ACTIVE", "NEAR_DEAL", "STALLED", "WAITING"]);
  const activeSessions = dbSessions.filter((s) => activeStatuses.has(s.status));
  const sessionIds = dbSessions.map((s) => s.id);

  return {
    group: buildEngineGroup(dbGroup, sessionIds),
    sessions: buildSessionSnapshots(activeSessions),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractThresholds(snapshot: Record<string, unknown>): SessionSnapshot["thresholds"] {
  return {
    u_threshold: (snapshot.u_threshold as number) ?? 0.4,
    u_aspiration: (snapshot.u_aspiration as number) ?? 0.7,
  };
}
