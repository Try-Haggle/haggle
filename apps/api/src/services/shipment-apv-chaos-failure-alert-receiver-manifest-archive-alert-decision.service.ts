import { sql, type Database } from "@haggle/db";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
} from
  "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

export type ShipmentApvReceiverManifestArchiveAlertDecision =
  "APPROVED" | "REJECTED";

type DecisionRow = {
  id: unknown;
  client_decision_id: unknown;
  approval_request_id: unknown;
  request_state_fingerprint: unknown;
  decision: unknown;
  decision_reason: unknown;
  decided_by: unknown;
  created_at: unknown;
  inserted: unknown;
  preview_schema_version: unknown;
  approval_state_fingerprint: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
};

type RequestRow = {
  id: unknown;
  preview_schema_version: unknown;
  state_fingerprint: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
  requested_by: unknown;
  expires_at: unknown;
  decision_id: unknown;
  client_decision_id: unknown;
  decision: unknown;
  decision_reason: unknown;
  decided_by: unknown;
  decision_created_at: unknown;
};

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_INVALID");
  }
  return parsed.toISOString();
}

function reasons(value: unknown) {
  if (!Array.isArray(value) || value.some((reason) => typeof reason !== "string")) {
    throw new Error(
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_INVALID");
  }
  return value as string[];
}

function publicDecision(row: DecisionRow) {
  return {
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-approval-decision-v1",
    decisionId: String(row.id),
    clientDecisionId: String(row.client_decision_id),
    approvalRequestId: String(row.approval_request_id),
    request: {
      schemaVersion: String(row.preview_schema_version),
      stateFingerprint: String(row.request_state_fingerprint),
      action: String(row.preview_action),
      severity: String(row.preview_severity),
      reasons: reasons(row.preview_reasons),
    },
    decision: String(row.decision) as
      ShipmentApvReceiverManifestArchiveAlertDecision,
    reason: String(row.decision_reason),
    decidedAt: iso(row.created_at),
    replayed: row.inserted === false,
    persistent: true,
    appendOnly: true,
    makerCheckerSeparated: true,
    makerIdentityReturned: false,
    checkerIdentityReturned: false,
    containsArchiveIdentifiers: false,
    payloadCreated: false,
    signed: false,
    delivery: { enabled: false, attempted: false },
    externalReceiptVerified: false,
    productionAccepted: false,
  };
}

function decisionMatches(row: DecisionRow, input: {
  approvalRequestId: string;
  clientDecisionId: string;
  decidedBy: string;
  decision: ShipmentApvReceiverManifestArchiveAlertDecision;
}) {
  return String(row.client_decision_id) === input.clientDecisionId
    && String(row.approval_request_id) === input.approvalRequestId
    && String(row.decided_by) === input.decidedBy
    && String(row.decision) === input.decision;
}

function decisionBindingValid(row: DecisionRow) {
  const orderedReasons = [
    "archive_intent_binding_violation",
    "archive_intent_blocker_violation",
    "archive_intent_side_effect_violation",
    "archive_intent_timestamp_violation",
    "archive_source_limit_violation",
    "current_archive_intent_missing",
    "archive_intent_stale",
  ];
  const values = reasons(row.preview_reasons);
  const indexes = values.map((reason) => orderedReasons.indexOf(reason));
  const critical = indexes.some((index) => index >= 0 && index <= 4);
  const action = String(row.preview_action);
  const severity = String(row.preview_severity);
  const decision = String(row.decision);
  const expectedReason = decision === "APPROVED"
    ? "checker_approved_snapshot" : decision === "REJECTED"
      ? "checker_rejected_snapshot" : "";
  return String(row.preview_schema_version)
      === SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION
    && /^[0-9a-f]{64}$/.test(String(row.request_state_fingerprint))
    && String(row.request_state_fingerprint)
      === String(row.approval_state_fingerprint)
    && values.length >= 1 && values.length <= 7
    && indexes.every((index) => index >= 0)
    && indexes.every((index, position) => position === 0
      || index > indexes[position - 1]!)
    && (action === "review_warning"
      ? severity === "warning" && !critical
      : action === "escalate_critical" && severity === "critical" && critical)
    && expectedReason !== "" && String(row.decision_reason) === expectedReason;
}

function decisionFromRequest(row: RequestRow): DecisionRow | null {
  if (!row.decision_id) return null;
  return {
    id: row.decision_id,
    client_decision_id: row.client_decision_id,
    approval_request_id: row.id,
    request_state_fingerprint: row.state_fingerprint,
    decision: row.decision,
    decision_reason: row.decision_reason,
    decided_by: row.decided_by,
    created_at: row.decision_created_at,
    inserted: false,
    preview_schema_version: row.preview_schema_version,
    approval_state_fingerprint: row.state_fingerprint,
    preview_action: row.preview_action,
    preview_severity: row.preview_severity,
    preview_reasons: row.preview_reasons,
  };
}

function previewMatchesRequest(row: RequestRow, preview: Awaited<ReturnType<
  typeof getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview>>) {
  return String(row.preview_schema_version)
      === SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION
    && String(row.state_fingerprint) === preview.stateFingerprint
    && String(row.preview_action) === preview.action
    && String(row.preview_severity) === preview.severity
    && JSON.stringify(reasons(row.preview_reasons))
      === JSON.stringify(preview.reasons);
}

export async function decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(
  db: Pick<Database, "transaction">,
  input: {
    approvalRequestId: string;
    clientDecisionId: string;
    decidedBy: string;
    decision: ShipmentApvReceiverManifestArchiveAlertDecision;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-claim-manifest-receipt.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-approval.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-decision.v1', 0))`);

    const existingRows = await transaction.execute(sql`SELECT decision.*,
        request.preview_schema_version,
        request.state_fingerprint AS approval_state_fingerprint,
        request.preview_action,
        request.preview_severity, request.preview_reasons, false AS inserted
      FROM shipment_apv_manifest_archive_alert_approval_decisions decision
      JOIN shipment_apv_manifest_archive_alert_approval_requests request
        ON request.id = decision.approval_request_id
      WHERE decision.client_decision_id = ${input.clientDecisionId}::uuid
      LIMIT 1`);
    const existing = (existingRows as unknown as DecisionRow[])[0];
    if (existing) {
      if (!decisionMatches(existing, input) || !decisionBindingValid(existing)) {
        throw new Error(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_REPLAY_CONFLICT");
      }
      return publicDecision(existing);
    }

    const requestRows = await transaction.execute(sql`SELECT request.*,
        decision.id AS decision_id, decision.client_decision_id,
        decision.decision, decision.decision_reason, decision.decided_by,
        decision.created_at AS decision_created_at
      FROM shipment_apv_manifest_archive_alert_approval_requests request
      LEFT JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
        ON decision.approval_request_id = request.id
      WHERE request.id = ${input.approvalRequestId}::uuid
      LIMIT 1`);
    const request = (requestRows as unknown as RequestRow[])[0];
    if (!request) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REQUEST_NOT_FOUND");
    }
    if (String(request.requested_by) === input.decidedBy) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_MAKER_CHECKER_REQUIRED");
    }
    const prior = decisionFromRequest(request);
    if (prior) {
      if (decisionMatches(prior, input) && decisionBindingValid(prior)) {
        return publicDecision(prior);
      }
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_ALREADY_DECIDED");
    }
    const expiresAt = Date.parse(String(request.expires_at));
    if (!Number.isFinite(expiresAt)) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_INVALID");
    }
    if (expiresAt <= now.getTime()) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REQUEST_EXPIRED");
    }

    const preview =
      await getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(transaction);
    if (preview.action === "none" || !preview.approval.required
      || !previewMatchesRequest(request, preview)) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED");
    }

    const reason = input.decision === "APPROVED"
      ? "checker_approved_snapshot" : "checker_rejected_snapshot";
    const rows = await transaction.execute(sql`WITH inserted AS (
        INSERT INTO shipment_apv_manifest_archive_alert_approval_decisions
          (client_decision_id, approval_request_id, request_state_fingerprint,
            decision, decision_reason, decided_by, created_at)
        VALUES (${input.clientDecisionId}::uuid, ${input.approvalRequestId}::uuid,
          ${String(request.state_fingerprint)}, ${input.decision}, ${reason},
          ${input.decidedBy}::uuid, ${now.toISOString()}::timestamptz)
        ON CONFLICT DO NOTHING
        RETURNING *, true AS inserted
      )
      SELECT inserted.*, request.preview_schema_version,
        request.state_fingerprint AS approval_state_fingerprint,
        request.preview_action, request.preview_severity, request.preview_reasons
      FROM inserted
      JOIN shipment_apv_manifest_archive_alert_approval_requests request
        ON request.id = inserted.approval_request_id
      UNION ALL
      SELECT existing.*, false AS inserted, request.preview_schema_version,
        request.state_fingerprint AS approval_state_fingerprint,
        request.preview_action, request.preview_severity, request.preview_reasons
      FROM shipment_apv_manifest_archive_alert_approval_decisions existing
      JOIN shipment_apv_manifest_archive_alert_approval_requests request
        ON request.id = existing.approval_request_id
      WHERE (existing.client_decision_id = ${input.clientDecisionId}::uuid
        OR existing.approval_request_id = ${input.approvalRequestId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1`);
    const row = (rows as unknown as DecisionRow[])[0];
    if (!row) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_UNAVAILABLE");
    }
    if (!decisionMatches(row, input) || !decisionBindingValid(row)) {
      if (String(row.approval_request_id) === input.approvalRequestId) {
        throw new Error(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_ALREADY_DECIDED");
      }
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_REPLAY_CONFLICT");
    }
    return publicDecision(row);
  });
}
