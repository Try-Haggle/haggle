import { type Database, sql } from "@haggle/db";
import { getShipmentApvChaosFailureAlertPreview } from "./shipment-apv-chaos-failure-alert-preview.service.js";

export const SHIPMENT_APV_FAILURE_ALERT_APPROVAL_WINDOW_MINUTES = 15;

type ApprovalRequestRow = {
  id: unknown;
  client_request_id: unknown;
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
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function asReasons(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function publicRequest(row: ApprovalRequestRow, now: Date) {
  const expiresAt = iso(row.expires_at);
  return {
    id: String(row.id),
    clientRequestId: String(row.client_request_id),
    stateFingerprint: String(row.state_fingerprint),
    action: String(row.preview_action),
    severity: String(row.preview_severity),
    reasons: asReasons(row.preview_reasons),
    status:
      expiresAt && Date.parse(expiresAt) > now.getTime()
        ? ("PENDING" as const)
        : ("EXPIRED" as const),
    requestedAt: iso(row.created_at),
    expiresAt,
    replayed: row.inserted === false,
    delivery: { enabled: false, attempted: false },
  };
}

function requestMatches(
  row: ApprovalRequestRow,
  input: {
    clientRequestId: string;
    stateFingerprint: string;
    requestedBy: string;
    action: string;
    severity: string;
    reasons: string[];
  },
) {
  return (
    String(row.client_request_id) === input.clientRequestId &&
    String(row.state_fingerprint) === input.stateFingerprint &&
    String(row.requested_by) === input.requestedBy &&
    String(row.preview_action) === input.action &&
    String(row.preview_severity) === input.severity &&
    JSON.stringify(asReasons(row.preview_reasons)) === JSON.stringify(input.reasons)
  );
}

function existingBindingMatches(
  row: ApprovalRequestRow,
  input: {
    clientRequestId: string;
    stateFingerprint: string;
    requestedBy: string;
  },
) {
  return (
    String(row.client_request_id) === input.clientRequestId &&
    String(row.state_fingerprint) === input.stateFingerprint &&
    String(row.requested_by) === input.requestedBy
  );
}

export async function createShipmentApvFailureAlertApprovalRequest(
  db: Pick<Database, "execute">,
  input: { clientRequestId: string; stateFingerprint: string; requestedBy: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_approval_requests
    WHERE client_request_id = ${input.clientRequestId}::uuid
    LIMIT 1`);
  const existing = (existingRows as unknown as ApprovalRequestRow[])[0];
  if (existing) {
    if (!existingBindingMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REPLAY_CONFLICT");
    }
    return publicRequest(existing, now);
  }
  const preview = await getShipmentApvChaosFailureAlertPreview(db, now);
  if (preview.action === "none" || !preview.approval.required) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_NOT_ACTIONABLE");
  }
  if (preview.stateFingerprint !== input.stateFingerprint) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  }
  const createdAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + SHIPMENT_APV_FAILURE_ALERT_APPROVAL_WINDOW_MINUTES * 60_000,
  ).toISOString();
  const reasonParams = sql.join(
    preview.reasons.map((reason) => sql`${reason}`),
    sql`, `,
  );
  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_failure_alert_approval_requests
        (client_request_id, state_fingerprint, preview_action, preview_severity,
          preview_reasons, requested_by, created_at, expires_at)
      VALUES (${input.clientRequestId}::uuid, ${input.stateFingerprint}, ${preview.action},
        ${preview.severity}, ARRAY[${reasonParams}]::text[], ${input.requestedBy}::uuid,
        ${createdAt}::timestamptz, ${expiresAt}::timestamptz)
      ON CONFLICT (client_request_id) DO NOTHING
      RETURNING *, true AS inserted
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT existing.*, false AS inserted
    FROM shipment_apv_failure_alert_approval_requests existing
    WHERE existing.client_request_id = ${input.clientRequestId}::uuid
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1`);
  const row = (rows as unknown as ApprovalRequestRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_UNAVAILABLE");
  if (
    !requestMatches(row, {
      ...input,
      action: preview.action,
      severity: preview.severity,
      reasons: preview.reasons,
    })
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REPLAY_CONFLICT");
  }
  return publicRequest(row, now);
}
