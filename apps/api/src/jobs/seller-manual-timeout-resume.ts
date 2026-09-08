/**
 * Seller Manual Soft timeout → Soft Auto resume (Eng1 M1 / SoT §7).
 * Draft: first Manual reply 30m / later 2h. Notify stub via control-mode service.
 */

import { type Database, sql } from "@haggle/db";
import {
  isSellerManualTimedOut,
  resumeSellerSoftAutoAfterTimeout,
  SELLER_MANUAL_FIRST_TIMEOUT_MS,
  SELLER_MANUAL_LATER_TIMEOUT_MS,
  type ControlModeSessionRow,
} from "../services/control-mode.service.js";

const BATCH_LIMIT = 50;

export async function runSellerManualTimeoutResume(db: Database): Promise<{ resumed: number }> {
  const now = Date.now();
  // Broad candidates: Manual sellers with since older than the shortest timeout.
  const cutoff = new Date(now - SELLER_MANUAL_FIRST_TIMEOUT_MS).toISOString();
  const rows = await db.execute(sql`
    SELECT id, buyer_id, seller_id, status, version,
           buyer_control_mode, seller_control_mode,
           buyer_pending_control_mode, seller_pending_control_mode,
           soft_ai_inflight_party, buyer_soft_ai_credits_charged,
           seller_manual_since, seller_manual_timeout_phase,
           negotiation_agent_snapshot
    FROM negotiation_sessions
    WHERE seller_control_mode = 'manual'
      AND seller_manual_since IS NOT NULL
      AND seller_manual_since <= ${cutoff}::timestamptz
      AND status IN ('CREATED', 'ACTIVE', 'NEAR_DEAL', 'STALLED', 'WAITING', 'NEGOTIATING_VERSION')
    ORDER BY seller_manual_since ASC
    LIMIT ${BATCH_LIMIT}
  `);

  let resumed = 0;
  for (const raw of rows as unknown as Record<string, unknown>[]) {
    const phase = raw.seller_manual_timeout_phase === "later" ? "later" : "first";
    const since = raw.seller_manual_since ? new Date(String(raw.seller_manual_since)) : null;
    const probe = {
      sellerControlMode: "manual" as const,
      sellerManualSince: since,
      sellerManualTimeoutPhase: phase as "first" | "later",
    };
    // Later phase needs the longer window; skip until due.
    if (phase === "later" && since) {
      if (now - since.getTime() < SELLER_MANUAL_LATER_TIMEOUT_MS) continue;
    }
    if (!isSellerManualTimedOut(probe as Pick<ControlModeSessionRow, "sellerControlMode" | "sellerManualSince" | "sellerManualTimeoutPhase">, now)) {
      continue;
    }
    const result = await resumeSellerSoftAutoAfterTimeout(db, {
      sessionId: String(raw.id),
      haggleEnv: process.env.HAGGLE_ENV,
      nowMs: now,
    });
    if (result.resumed) resumed += 1;
  }
  return { resumed };
}
