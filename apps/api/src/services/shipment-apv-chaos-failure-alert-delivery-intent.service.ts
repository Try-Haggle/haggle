import { sql, type Database } from "@haggle/db";
import { getShipmentApvChaosFailureAlertPreview } from
  "./shipment-apv-chaos-failure-alert-preview.service.js";

const BLOCKING_REASONS = [
  "independent_trust_anchor_missing",
  "receiver_endpoint_missing",
  "receiver_credential_missing",
] as const;

type IntentRow = {
  id: unknown;
  client_delivery_intent_id: unknown;
  payload_signature_id: unknown;
  payload_outbox_id: unknown;
  payload_sha256: unknown;
  key_id: unknown;
  status: unknown;
  blocking_reasons: unknown;
  http_request_created: unknown;
  delivery_attempted: unknown;
  requested_by: unknown;
  created_at: unknown;
  inserted: unknown;
};

type BindingRow = {
  signature_id: unknown;
  payload_outbox_id: unknown;
  payload_sha256: unknown;
  key_id: unknown;
  signed_by: unknown;
  state_fingerprint: unknown;
  cooldown_expires_at: unknown;
  key_event_type: unknown;
  intent_id: unknown;
  client_delivery_intent_id: unknown;
  intent_status: unknown;
  blocking_reasons: unknown;
  http_request_created: unknown;
  delivery_attempted: unknown;
  requested_by: unknown;
  intent_created_at: unknown;
};

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicIntent(row: IntentRow) {
  return {
    schemaVersion: "shipment-apv-failure-alert-delivery-intent-v1",
    id: String(row.id),
    clientDeliveryIntentId: String(row.client_delivery_intent_id),
    payloadSignatureId: String(row.payload_signature_id),
    payloadOutboxId: String(row.payload_outbox_id),
    payloadSha256: String(row.payload_sha256),
    keyId: String(row.key_id),
    status: "BLOCKED_CONFIGURATION_DRY_RUN" as const,
    blockingReasons: Array.isArray(row.blocking_reasons)
      ? row.blocking_reasons.map(String) : [],
    createdAt: iso(row.created_at),
    replayed: row.inserted === false,
    persistent: true,
    executable: false,
    http: { requestCreated: false },
    delivery: { enabled: false, attempted: false },
  };
}

function intentMatches(row: IntentRow, input: {
  payloadSignatureId: string; clientDeliveryIntentId: string; requestedBy: string;
}) {
  return String(row.payload_signature_id) === input.payloadSignatureId
    && String(row.client_delivery_intent_id) === input.clientDeliveryIntentId
    && String(row.requested_by) === input.requestedBy;
}

function intentFromBinding(row: BindingRow): IntentRow | null {
  if (!row.intent_id) return null;
  return {
    id: row.intent_id,
    client_delivery_intent_id: row.client_delivery_intent_id,
    payload_signature_id: row.signature_id,
    payload_outbox_id: row.payload_outbox_id,
    payload_sha256: row.payload_sha256,
    key_id: row.key_id,
    status: row.intent_status,
    blocking_reasons: row.blocking_reasons,
    http_request_created: row.http_request_created,
    delivery_attempted: row.delivery_attempted,
    requested_by: row.requested_by,
    created_at: row.intent_created_at,
    inserted: false,
  };
}

export async function createShipmentApvFailureAlertDeliveryIntent(
  db: Pick<Database, "execute">,
  input: { payloadSignatureId: string; clientDeliveryIntentId: string;
    requestedBy: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_delivery_intents
    WHERE client_delivery_intent_id = ${input.clientDeliveryIntentId}::uuid LIMIT 1`);
  const existing = (existingRows as unknown as IntentRow[])[0];
  if (existing) {
    if (!intentMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_REPLAY_CONFLICT");
    }
    return publicIntent(existing);
  }

  const bindingRows = await db.execute(sql`SELECT signature.id AS signature_id,
      signature.payload_outbox_id, signature.payload_sha256, signature.key_id,
      signature.signed_by, outbox.state_fingerprint,
      delivery_grant.cooldown_expires_at, key_event.event_type AS key_event_type,
      intent.id AS intent_id, intent.client_delivery_intent_id,
      intent.status AS intent_status, intent.blocking_reasons,
      intent.http_request_created, intent.delivery_attempted, intent.requested_by,
      intent.created_at AS intent_created_at
    FROM shipment_apv_failure_alert_payload_signatures signature
    JOIN shipment_apv_failure_alert_payload_outbox outbox
      ON outbox.id = signature.payload_outbox_id
    JOIN shipment_apv_failure_alert_delivery_grants delivery_grant
      ON delivery_grant.id = outbox.delivery_grant_id
    JOIN LATERAL (
      SELECT event.event_type
      FROM shipment_apv_failure_alert_signing_key_events event
      WHERE event.key_id = signature.key_id
      ORDER BY event.created_at DESC, event.id DESC LIMIT 1
    ) key_event ON true
    LEFT JOIN shipment_apv_failure_alert_delivery_intents intent
      ON intent.payload_signature_id = signature.id
    WHERE signature.id = ${input.payloadSignatureId}::uuid LIMIT 1`);
  const binding = (bindingRows as unknown as BindingRow[])[0];
  if (!binding) throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNATURE_NOT_FOUND");
  if (String(binding.signed_by) !== input.requestedBy) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_ACTOR_MISMATCH");
  }
  const prior = intentFromBinding(binding);
  if (prior) {
    if (intentMatches(prior, input)) return publicIntent(prior);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_ALREADY_CREATED");
  }
  if (Date.parse(String(binding.cooldown_expires_at)) <= now.getTime()) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_EXPIRED");
  }
  if (String(binding.key_event_type) !== "REGISTERED") {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_SIGNING_KEY_NOT_ACTIVE");
  }
  const preview = await getShipmentApvChaosFailureAlertPreview(db, now);
  if (preview.action === "none" || !preview.approval.required
    || preview.stateFingerprint !== String(binding.state_fingerprint)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  }

  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_failure_alert_delivery_intents
        (client_delivery_intent_id, payload_signature_id, payload_outbox_id,
          payload_sha256, key_id, status, blocking_reasons,
          http_request_created, delivery_attempted, requested_by, created_at)
      VALUES (${input.clientDeliveryIntentId}::uuid, ${input.payloadSignatureId}::uuid,
        ${String(binding.payload_outbox_id)}::uuid, ${String(binding.payload_sha256)},
        ${String(binding.key_id)}, 'BLOCKED_CONFIGURATION_DRY_RUN',
        ARRAY[${BLOCKING_REASONS[0]}, ${BLOCKING_REASONS[1]},
          ${BLOCKING_REASONS[2]}]::text[], false, false,
        ${input.requestedBy}::uuid, ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING *, true AS inserted
    ) SELECT * FROM inserted
    UNION ALL SELECT existing.*, false AS inserted
    FROM shipment_apv_failure_alert_delivery_intents existing
    WHERE (existing.client_delivery_intent_id = ${input.clientDeliveryIntentId}::uuid
      OR existing.payload_signature_id = ${input.payloadSignatureId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM inserted) LIMIT 1`);
  const row = (rows as unknown as IntentRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_UNAVAILABLE");
  if (!intentMatches(row, input)) {
    if (String(row.payload_signature_id) === input.payloadSignatureId) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_ALREADY_CREATED");
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_REPLAY_CONFLICT");
  }
  return publicIntent(row);
}
