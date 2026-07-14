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
  | "dispute.appeal_review"
  | "dispute.appeal_assign"
  | "dispute.evidence_similarity_review"
  | "dispute.evidence_legal_hold"
  | "dispute.evidence_retention_run"
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
  | "reconciliation.report"
  | "shipment.prepare"
  | "shipment.label_purchase"
  | "shipment.label_refund_request"
  | "shipment.label_refund_status"
  | "shipment.apv_adjustment"
  | "shipment.apv_revision"
  | "shipment.apv_revision_decision"
  | "shipment.apv_evidence"
  | "shipment.apv_invoice_document"
  | "shipment.apv_invoice_reconciliation_request"
  | "shipment.apv_invoice_reconciliation_decision"
  | "shipment.apv_invoice_restoration_request"
  | "shipment.apv_invoice_restoration_decision"
  | "shipment.apv_invoice_restoration_staging_preserve"
  | "shipment.apv_invoice_restoration_remediation_request"
  | "shipment.apv_invoice_restoration_remediation_decision"
  | "shipment.apv_seller_review"
  | "shipment.apv_review_decision"
  | "shipment.apv_payout_reservation_cancel"
  | "shipment.apv_payout_cancellation_request"
  | "shipment.apv_payout_cancellation_decision"
  | "shipment.apv_cancellation_audit_archive_requeue"
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
