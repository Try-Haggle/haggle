/**
 * Admin action log writer (Step 58 Part A).
 *
 * Tiny helper around `admin_action_log` inserts so route handlers do not
 * have to know the schema shape. All admin mutations should flow through
 * this so audit trails are consistent.
 */

import { type Database, adminActionLog } from "@haggle/db";

export type AdminActionType =
  | "tag.approve"
  | "tag.reject"
  | "tag.merge"
  | "dispute.escalate"
  | "dispute.resolve"
  | "payment.mark_review"
  | "promotion.run"
  | "rule.update"
  | "rule.delete";

export async function writeAuditLog(
  db: Database,
  params: {
    actorId: string;
    actionType: AdminActionType;
    targetType?: string | null;
    targetId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(adminActionLog).values({
    actorId: params.actorId,
    actionType: params.actionType,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    payload: (params.payload ?? {}) as Record<string, unknown>,
  });
}
