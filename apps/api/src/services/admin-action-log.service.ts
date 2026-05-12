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
  | "dispute_module_webhook.replay"
  | "payment.mark_review"
  | "payment.authorize"
  | "payment.capture"
  | "payment.cancel"
  | "payment.fail"
  | "payment.refund"
  | "payment.webhook_received"
  | "payment.webhook_rejected"
  | "payment.reconciliation_correction"
  | "payment.admin_override"
  | "shipment.prepare"
  | "shipment.label_purchase"
  | "shipment.return_label_purchase"
  | "shipment.webhook_received"
  | "shipment.webhook_rejected"
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
