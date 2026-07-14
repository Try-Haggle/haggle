import { sql, type Database } from "@haggle/db";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
} from
  "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

export const SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_WINDOW_MINUTES = 15;

type ApprovalRow = {
  id: unknown;
  client_request_id: unknown;
  preview_schema_version: unknown;
  state_fingerprint: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
  requested_by: unknown;
  created_at: unknown;
  expires_at: unknown;
  inserted: unknown;
};

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_INVALID");
  }
  return parsed.toISOString();
}

function reasons(value: unknown) {
  if (!Array.isArray(value) || value.some((reason) => typeof reason !== "string")) {
    throw new Error(
      "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_INVALID");
  }
  return value as string[];
}

function publicRequest(row: ApprovalRow, now: Date) {
  const requestedAt = iso(row.created_at);
  const expiresAt = iso(row.expires_at);
  return {
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-approval-request-v1",
    approvalRequestId: String(row.id),
    clientRequestId: String(row.client_request_id),
    preview: {
      schemaVersion: String(row.preview_schema_version),
      stateFingerprint: String(row.state_fingerprint),
      action: String(row.preview_action),
      severity: String(row.preview_severity),
      reasons: reasons(row.preview_reasons),
    },
    status: Date.parse(expiresAt) > now.getTime()
      ? "PENDING" as const : "EXPIRED" as const,
    requestedAt,
    expiresAt,
    replayed: row.inserted === false,
    persistent: true,
    appendOnly: true,
    containsArchiveIdentifiers: false,
    makerIdentityReturned: false,
    checkerDecisionCreated: false,
    payloadCreated: false,
    signed: false,
    delivery: { enabled: false, attempted: false },
    externalReceiptVerified: false,
    productionAccepted: false,
  };
}

function exactReplayMatches(row: ApprovalRow, input: {
  clientRequestId: string; stateFingerprint: string; requestedBy: string;
}) {
  return String(row.client_request_id) === input.clientRequestId
    && String(row.state_fingerprint) === input.stateFingerprint
    && String(row.requested_by) === input.requestedBy;
}

function fullBindingMatches(row: ApprovalRow, input: {
  clientRequestId: string; stateFingerprint: string; requestedBy: string;
  action: string; severity: string; reasons: string[];
}) {
  return exactReplayMatches(row, input)
    && String(row.preview_schema_version)
      === SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION
    && String(row.preview_action) === input.action
    && String(row.preview_severity) === input.severity
    && JSON.stringify(reasons(row.preview_reasons)) === JSON.stringify(input.reasons);
}

export async function createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
  db: Pick<Database, "transaction">,
  input: { clientRequestId: string; stateFingerprint: string;
    requestedBy: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-claim-manifest-receipt.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-approval.v1', 0))`);
    const existingRows = await transaction.execute(sql`SELECT *, false AS inserted
      FROM shipment_apv_manifest_archive_alert_approval_requests
      WHERE client_request_id = ${input.clientRequestId}::uuid LIMIT 1`);
    const existing = (existingRows as unknown as ApprovalRow[])[0];
    if (existing) {
      if (!exactReplayMatches(existing, input)) {
        throw new Error(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REPLAY_CONFLICT");
      }
      return publicRequest(existing, now);
    }

    const preview =
      await getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(transaction);
    if (preview.action === "none" || !preview.approval.required) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_NOT_ACTIONABLE");
    }
    if (preview.stateFingerprint !== input.stateFingerprint) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED");
    }

    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime()
      + SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_WINDOW_MINUTES
        * 60_000).toISOString();
    const reasonParams = sql.join(preview.reasons.map((reason) => sql`${reason}`), sql`, `);
    const rows = await transaction.execute(sql`INSERT INTO
        shipment_apv_manifest_archive_alert_approval_requests
        (client_request_id, preview_schema_version, state_fingerprint,
          preview_action, preview_severity, preview_reasons, requested_by,
          created_at, expires_at)
      VALUES (${input.clientRequestId}::uuid,
        ${SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION},
        ${input.stateFingerprint}, ${preview.action}, ${preview.severity},
        ARRAY[${reasonParams}]::text[], ${input.requestedBy}::uuid,
        ${createdAt}::timestamptz, ${expiresAt}::timestamptz)
      RETURNING *, true AS inserted`);
    const row = (rows as unknown as ApprovalRow[])[0];
    if (!row) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_UNAVAILABLE");
    }
    if (!fullBindingMatches(row, { ...input, action: preview.action,
      severity: preview.severity, reasons: preview.reasons })) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REPLAY_CONFLICT");
    }
    return publicRequest(row, now);
  });
}
