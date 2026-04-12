/**
 * group-executor.ts
 *
 * 라운드 완료 후 호출. 그룹 1:N 오케스트레이션 실행.
 * 엔진의 orchestrateGroup/handleSessionTerminal → DB 업데이트.
 */

import { type Database } from "@haggle/db";
import {
  orchestrateGroup,
  handleSessionTerminal,
  type GroupAction,
} from "@haggle/engine-session";

import { getGroupById, updateGroupMetadata } from "../services/negotiation-group.service.js";
import { getSessionsByGroupId, batchUpdateSessionStatus } from "../services/negotiation-session.service.js";
import { buildGroupSnapshot, type DbGroup } from "./snapshot-builder.js";
import type { DbSession } from "./session-reconstructor.js";
import type { EventDispatcher } from "./event-dispatcher.js";

// ---------------------------------------------------------------------------
// Group orchestration (called after each round completes)
// ---------------------------------------------------------------------------

/**
 * Execute group orchestration after a round completes.
 * Returns the GroupAction[] produced by the engine.
 *
 * Flow:
 * 1. Load group + all sessions (single SELECT each, group_id index)
 * 2. Build GroupSnapshot (pure function)
 * 3. orchestrateGroup (pure function, O(N log N))
 * 4. Apply each action to DB
 */
export async function executeGroupOrchestration(
  db: Database,
  groupId: string,
  eventDispatcher?: EventDispatcher,
): Promise<GroupAction[]> {
  const dbGroup = await getGroupById(db, groupId);
  if (!dbGroup || dbGroup.status !== "ACTIVE") {
    return [{ action: "no_action", reason: "group not found or not active" }];
  }

  const dbSessions = await getSessionsByGroupId(db, groupId);
  const snapshot = buildGroupSnapshot(dbGroup as DbGroup, dbSessions as DbSession[]);
  const actions = orchestrateGroup(snapshot);

  // Apply each action
  for (const action of actions) {
    await applyGroupAction(db, groupId, dbGroup as DbGroup, action, eventDispatcher);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Terminal session handler (called when a session reaches terminal state)
// ---------------------------------------------------------------------------

/**
 * Handle a session reaching terminal status within a group context.
 * This is typically called from the negotiation-executor after commit.
 */
export async function executeGroupTerminal(
  db: Database,
  groupId: string,
  terminalSessionId: string,
  terminalStatus: "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED",
  eventDispatcher?: EventDispatcher,
): Promise<GroupAction[]> {
  const dbGroup = await getGroupById(db, groupId);
  if (!dbGroup) {
    return [{ action: "no_action", reason: "group not found" }];
  }

  const dbSessions = await getSessionsByGroupId(db, groupId);
  const sessionIds = dbSessions.map((s) => s.id);

  const engineGroup = {
    group_id: dbGroup.id,
    topology: dbGroup.topology as "1_BUYER_N_SELLERS" | "N_BUYERS_1_SELLER",
    anchor_user_id: dbGroup.anchorUserId,
    intent_id: dbGroup.intentId ?? undefined,
    max_sessions: dbGroup.maxSessions,
    session_ids: sessionIds,
    status: dbGroup.status as "ACTIVE" | "RESOLVED" | "EXPIRED" | "CANCELLED",
    created_at: dbGroup.createdAt.getTime(),
    updated_at: dbGroup.updatedAt.getTime(),
  };

  const actions = handleSessionTerminal(engineGroup, terminalSessionId, terminalStatus);

  for (const action of actions) {
    await applyGroupAction(db, groupId, dbGroup as DbGroup, action, eventDispatcher);
  }

  // Auto-close group after ACCEPTED terminal: if supersede_losers was applied,
  // the group should be RESOLVED. Engine returns supersede_losers only, so we
  // add close_group at the API layer.
  if (terminalStatus === "ACCEPTED" && actions.some((a) => a.action === "supersede_losers")) {
    const closeAction: GroupAction = { action: "close_group", reason: "session accepted" };
    await applyGroupAction(db, groupId, dbGroup as DbGroup, closeAction, eventDispatcher);
    actions.push(closeAction);
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Apply a single GroupAction to DB
// ---------------------------------------------------------------------------

async function applyGroupAction(
  db: Database,
  groupId: string,
  dbGroup: DbGroup,
  action: GroupAction,
  eventDispatcher?: EventDispatcher,
): Promise<void> {
  switch (action.action) {
    case "supersede_losers": {
      // Batch update all loser sessions to SUPERSEDED
      await batchUpdateSessionStatus(db, action.loser_session_ids, "SUPERSEDED");

      // Dispatch terminal events for each superseded session
      if (eventDispatcher) {
        for (const loserId of action.loser_session_ids) {
          await eventDispatcher.dispatch({
            domain: "negotiation",
            type: "negotiation.session.terminal",
            payload: { session_id: loserId, terminal_status: "SUPERSEDED" },
            idempotency_key: `neg_terminal_${loserId}_SUPERSEDED`,
            timestamp: Date.now(),
          }).catch((err) => {
            console.error("[group-executor] event dispatch error:", err);
          });
        }
      }
      break;
    }

    case "close_group": {
      await updateGroupMetadata(db, groupId, dbGroup.version, { status: "RESOLVED" });
      break;
    }

    case "update_batna": {
      await updateGroupMetadata(db, groupId, dbGroup.version, {
        batna: String(action.batna),
        bestSessionId: action.best_session_id,
      });
      break;
    }

    case "update_competition": {
      // Competition context is per-session metadata — store in session round data
      // The next round for each session will pick this up from the group
      // For MVP, we just update the group metadata
      await updateGroupMetadata(db, groupId, dbGroup.version, {
        metadata: {
          ...(dbGroup.metadata ?? {}),
          competition: action.competition,
          competition_session_ids: action.session_ids,
        },
      });
      break;
    }

    case "no_action":
      break;
  }
}
