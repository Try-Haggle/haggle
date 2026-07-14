import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { getShipmentApvChaosFailureAlertPreview } from
  "./shipment-apv-chaos-failure-alert-preview.service.js";

type Payload = {
  schema_version: "shipment-apv-failure-alert-payload-v1";
  event_type: "shipment_apv_failure_alert";
  action: string;
  severity: string;
  reasons: string[];
  state_fingerprint: string;
};

type OutboxRow = {
  id: unknown;
  client_outbox_id: unknown;
  delivery_grant_id: unknown;
  state_fingerprint: unknown;
  payload: unknown;
  payload_sha256: unknown;
  status: unknown;
  created_by: unknown;
  created_at: unknown;
  inserted: unknown;
};

type BindingRow = {
  grant_id: unknown;
  grant_status: unknown;
  granted_by: unknown;
  state_fingerprint: unknown;
  cooldown_expires_at: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
  outbox_id: unknown;
  client_outbox_id: unknown;
  outbox_payload: unknown;
  payload_sha256: unknown;
  outbox_status: unknown;
  created_by: unknown;
  outbox_created_at: unknown;
};

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function reasons(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function canonicalPayload(payload: Payload) {
  return JSON.stringify({
    action: payload.action,
    event_type: payload.event_type,
    reasons: payload.reasons,
    schema_version: payload.schema_version,
    severity: payload.severity,
    state_fingerprint: payload.state_fingerprint,
  });
}

function payloadHash(payload: Payload) {
  return createHash("sha256").update(canonicalPayload(payload)).digest("hex");
}

function publicOutbox(row: OutboxRow) {
  return {
    schemaVersion: "shipment-apv-failure-alert-payload-outbox-v1",
    id: String(row.id),
    clientOutboxId: String(row.client_outbox_id),
    deliveryGrantId: String(row.delivery_grant_id),
    stateFingerprint: String(row.state_fingerprint),
    payload: row.payload as Payload,
    payloadSha256: String(row.payload_sha256),
    status: "UNSIGNED_DRY_RUN" as const,
    createdAt: iso(row.created_at),
    replayed: row.inserted === false,
    signed: false,
    signature: null,
    delivery: { enabled: false, attempted: false },
  };
}

function outboxMatches(row: OutboxRow, input: {
  clientOutboxId: string;
  deliveryGrantId: string;
  createdBy: string;
}) {
  return String(row.client_outbox_id) === input.clientOutboxId
    && String(row.delivery_grant_id) === input.deliveryGrantId
    && String(row.created_by) === input.createdBy;
}

function outboxFromBinding(row: BindingRow): OutboxRow | null {
  if (!row.outbox_id) return null;
  return {
    id: row.outbox_id,
    client_outbox_id: row.client_outbox_id,
    delivery_grant_id: row.grant_id,
    state_fingerprint: row.state_fingerprint,
    payload: row.outbox_payload,
    payload_sha256: row.payload_sha256,
    status: row.outbox_status,
    created_by: row.created_by,
    created_at: row.outbox_created_at,
    inserted: false,
  };
}

export async function createShipmentApvFailureAlertPayloadOutbox(
  db: Pick<Database, "execute">,
  input: { deliveryGrantId: string; clientOutboxId: string; createdBy: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_payload_outbox
    WHERE client_outbox_id = ${input.clientOutboxId}::uuid LIMIT 1`);
  const existing = (existingRows as unknown as OutboxRow[])[0];
  if (existing) {
    if (!outboxMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_REPLAY_CONFLICT");
    }
    return publicOutbox(existing);
  }

  const bindingRows = await db.execute(sql`SELECT delivery_grant.id AS grant_id,
      delivery_grant.status AS grant_status, delivery_grant.granted_by,
      delivery_grant.state_fingerprint, delivery_grant.cooldown_expires_at,
      request.preview_action, request.preview_severity, request.preview_reasons,
      outbox.id AS outbox_id, outbox.client_outbox_id,
      outbox.payload AS outbox_payload, outbox.payload_sha256,
      outbox.status AS outbox_status, outbox.created_by,
      outbox.created_at AS outbox_created_at
    FROM shipment_apv_failure_alert_delivery_grants delivery_grant
    JOIN shipment_apv_failure_alert_approval_decisions decision
      ON decision.id = delivery_grant.approval_decision_id
    JOIN shipment_apv_failure_alert_approval_requests request
      ON request.id = decision.approval_request_id
    LEFT JOIN shipment_apv_failure_alert_payload_outbox outbox
      ON outbox.delivery_grant_id = delivery_grant.id
    WHERE delivery_grant.id = ${input.deliveryGrantId}::uuid LIMIT 1`);
  const binding = (bindingRows as unknown as BindingRow[])[0];
  if (!binding) throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_GRANT_NOT_FOUND");
  if (String(binding.grant_status) !== "GRANTED_DRY_RUN") {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_GRANT_INVALID");
  }
  if (String(binding.granted_by) !== input.createdBy) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ACTOR_MISMATCH");
  }
  const prior = outboxFromBinding(binding);
  if (prior) {
    if (outboxMatches(prior, input)) return publicOutbox(prior);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ALREADY_CREATED");
  }
  if (Date.parse(String(binding.cooldown_expires_at)) <= now.getTime()) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_EXPIRED");
  }
  const preview = await getShipmentApvChaosFailureAlertPreview(db, now);
  if (preview.action === "none" || !preview.approval.required
    || preview.stateFingerprint !== String(binding.state_fingerprint)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  }
  const payload: Payload = {
    schema_version: "shipment-apv-failure-alert-payload-v1",
    event_type: "shipment_apv_failure_alert",
    action: String(binding.preview_action),
    severity: String(binding.preview_severity),
    reasons: reasons(binding.preview_reasons),
    state_fingerprint: String(binding.state_fingerprint),
  };
  const sha256 = payloadHash(payload);
  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_failure_alert_payload_outbox
        (client_outbox_id, delivery_grant_id, state_fingerprint, payload,
          canonical_payload, payload_sha256, status, created_by, created_at)
      VALUES (${input.clientOutboxId}::uuid, ${input.deliveryGrantId}::uuid,
        ${payload.state_fingerprint}, ${JSON.stringify(payload)}::jsonb,
        ${canonicalPayload(payload)}, ${sha256}, 'UNSIGNED_DRY_RUN', ${input.createdBy}::uuid,
        ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING *, true AS inserted
    ) SELECT * FROM inserted
    UNION ALL
    SELECT existing.*, false AS inserted
    FROM shipment_apv_failure_alert_payload_outbox existing
    WHERE (existing.client_outbox_id = ${input.clientOutboxId}::uuid
      OR existing.delivery_grant_id = ${input.deliveryGrantId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1`);
  const row = (rows as unknown as OutboxRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_OUTBOX_UNAVAILABLE");
  if (!outboxMatches(row, input)) {
    if (String(row.delivery_grant_id) === input.deliveryGrantId) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_ALREADY_CREATED");
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_PAYLOAD_REPLAY_CONFLICT");
  }
  return publicOutbox(row);
}
