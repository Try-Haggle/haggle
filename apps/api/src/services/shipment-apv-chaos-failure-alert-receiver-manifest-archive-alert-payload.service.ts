import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
} from
  "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

export const SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION =
  "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1";

type Payload = {
  schema_version: typeof SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION;
  event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert";
  action: string;
  severity: string;
  reasons: string[];
  state_fingerprint: string;
};

type BindingRow = {
  outbox_id: unknown;
  client_outbox_id: unknown;
  outbox_delivery_grant_id: unknown;
  outbox_state_fingerprint: unknown;
  payload: unknown;
  canonical_payload: unknown;
  payload_sha256: unknown;
  outbox_status: unknown;
  created_by: unknown;
  outbox_created_at: unknown;
  grant_id: unknown;
  client_grant_id: unknown;
  approval_decision_id: unknown;
  grant_state_fingerprint: unknown;
  grant_status: unknown;
  granted_by: unknown;
  granted_at: unknown;
  grant_cooldown_expires_at: unknown;
  cooldown_grant_id: unknown;
  cooldown_claimed_at: unknown;
  cooldown_expires_at: unknown;
  decision: unknown;
  decision_reason: unknown;
  decided_by: unknown;
  decided_at: unknown;
  requested_by: unknown;
  request_created_at: unknown;
  request_expires_at: unknown;
  preview_schema_version: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
};

function invalid() {
  throw new Error(
    "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_INVALID");
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function reasons(value: unknown) {
  if (!Array.isArray(value) || value.some((reason) => typeof reason !== "string")) {
    invalid();
  }
  return value as string[];
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

function expectedPayload(row: BindingRow): Payload {
  return {
    schema_version:
      SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION,
    event_type:
      "shipment_apv_failure_alert_receiver_manifest_archive_alert",
    action: String(row.preview_action),
    severity: String(row.preview_severity),
    reasons: reasons(row.preview_reasons),
    state_fingerprint: String(row.grant_state_fingerprint),
  };
}

function fullGrantBindingValid(row: BindingRow) {
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
  const requestedAt = Date.parse(iso(row.request_created_at));
  const requestExpiresAt = Date.parse(iso(row.request_expires_at));
  const decidedAt = Date.parse(iso(row.decided_at));
  const grantedAt = Date.parse(iso(row.granted_at));
  const grantExpiresAt = Date.parse(iso(row.grant_cooldown_expires_at));
  const cooldownClaimedAt = Date.parse(iso(row.cooldown_claimed_at));
  const cooldownExpiresAt = Date.parse(iso(row.cooldown_expires_at));
  return String(row.preview_schema_version)
      === SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION
    && /^[0-9a-f]{64}$/.test(String(row.grant_state_fingerprint))
    && String(row.grant_status) === "GRANTED_DRY_RUN"
    && String(row.decision) === "APPROVED"
    && String(row.decision_reason) === "checker_approved_snapshot"
    && String(row.decided_by) === String(row.granted_by)
    && String(row.requested_by) !== String(row.granted_by)
    && String(row.cooldown_grant_id) === String(row.grant_id)
    && values.length >= 1 && values.length <= 7
    && indexes.every((index) => index >= 0)
    && indexes.every((index, position) => position === 0
      || index > indexes[position - 1]!)
    && (action === "review_warning"
      ? severity === "warning" && !critical
      : action === "escalate_critical" && severity === "critical" && critical)
    && decidedAt >= requestedAt && decidedAt < requestExpiresAt
    && grantedAt >= decidedAt && grantedAt < requestExpiresAt
    && cooldownClaimedAt === grantedAt
    && cooldownExpiresAt === grantExpiresAt
    && grantExpiresAt === grantedAt + 15 * 60_000;
}

function payloadObject(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = Object.keys(value as object).sort();
  const expectedKeys = ["action", "event_type", "reasons", "schema_version",
    "severity", "state_fingerprint"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) invalid();
  return value as Payload;
}

function outboxBindingValid(row: BindingRow) {
  if (!row.outbox_id || !fullGrantBindingValid(row)) return false;
  const payload = payloadObject(row.payload);
  const expected = expectedPayload(row);
  const createdAt = Date.parse(iso(row.outbox_created_at));
  const grantedAt = Date.parse(iso(row.granted_at));
  const expiresAt = Date.parse(iso(row.grant_cooldown_expires_at));
  return String(row.outbox_delivery_grant_id) === String(row.grant_id)
    && String(row.outbox_state_fingerprint)
      === String(row.grant_state_fingerprint)
    && String(row.outbox_status) === "UNSIGNED_DRY_RUN"
    && String(row.created_by) === String(row.granted_by)
    && createdAt >= grantedAt && createdAt < expiresAt
    && canonicalPayload(payload) === canonicalPayload(expected)
    && String(row.canonical_payload) === canonicalPayload(expected)
    && String(row.payload_sha256) === payloadHash(expected);
}

function safelyValidGrantBinding(row: BindingRow) {
  try {
    return fullGrantBindingValid(row);
  } catch {
    return false;
  }
}

function safelyValidOutboxBinding(row: BindingRow) {
  try {
    return outboxBindingValid(row);
  } catch {
    return false;
  }
}

function exactReplayMatches(row: BindingRow, input: {
  deliveryGrantId: string; clientOutboxId: string; createdBy: string;
}) {
  return String(row.client_outbox_id) === input.clientOutboxId
    && String(row.outbox_delivery_grant_id) === input.deliveryGrantId
    && String(row.created_by) === input.createdBy;
}

function publicOutbox(row: BindingRow, replayed: boolean) {
  if (!outboxBindingValid(row)) invalid();
  return {
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-outbox-v1",
    payloadOutboxId: String(row.outbox_id),
    clientOutboxId: String(row.client_outbox_id),
    deliveryGrantId: String(row.outbox_delivery_grant_id),
    stateFingerprint: String(row.outbox_state_fingerprint),
    payload: payloadObject(row.payload),
    payloadSha256: String(row.payload_sha256),
    status: "UNSIGNED_DRY_RUN" as const,
    createdAt: iso(row.outbox_created_at),
    replayed,
    persistent: true,
    appendOnly: true,
    containsArchiveIdentifiers: false,
    createdByIdentityReturned: false,
    signed: false,
    signature: null,
    delivery: { enabled: false, attempted: false },
    externalReceiptVerified: false,
    productionAccepted: false,
  };
}

function previewMatches(row: BindingRow, preview: Awaited<ReturnType<
  typeof getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview>>) {
  return String(row.preview_schema_version)
      === SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION
    && String(row.grant_state_fingerprint) === preview.stateFingerprint
    && String(row.preview_action) === preview.action
    && String(row.preview_severity) === preview.severity
    && JSON.stringify(reasons(row.preview_reasons))
      === JSON.stringify(preview.reasons);
}

const outboxBindingSql = sql`SELECT outbox.id AS outbox_id,
    outbox.client_outbox_id,
    outbox.delivery_grant_id AS outbox_delivery_grant_id,
    outbox.state_fingerprint AS outbox_state_fingerprint,
    outbox.payload, outbox.canonical_payload, outbox.payload_sha256,
    outbox.status AS outbox_status, outbox.created_by,
    outbox.created_at AS outbox_created_at,
    delivery_grant.id AS grant_id, delivery_grant.client_grant_id,
    delivery_grant.approval_decision_id,
    delivery_grant.state_fingerprint AS grant_state_fingerprint,
    delivery_grant.status AS grant_status, delivery_grant.granted_by,
    delivery_grant.granted_at,
    delivery_grant.cooldown_expires_at AS grant_cooldown_expires_at,
    delivery_grant.id AS cooldown_grant_id,
    delivery_grant.granted_at AS cooldown_claimed_at,
    delivery_grant.cooldown_expires_at AS cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    decision.created_at AS decided_at,
    request.requested_by, request.created_at AS request_created_at,
    request.expires_at AS request_expires_at, request.preview_schema_version,
    request.preview_action, request.preview_severity, request.preview_reasons
  FROM shipment_apv_manifest_archive_alert_payload_outbox outbox
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id`;

const grantBindingSql = sql`SELECT NULL::uuid AS outbox_id,
    NULL::uuid AS client_outbox_id,
    NULL::uuid AS outbox_delivery_grant_id,
    NULL::text AS outbox_state_fingerprint,
    NULL::jsonb AS payload, NULL::text AS canonical_payload,
    NULL::text AS payload_sha256, NULL::text AS outbox_status,
    NULL::uuid AS created_by, NULL::timestamptz AS outbox_created_at,
    delivery_grant.id AS grant_id, delivery_grant.client_grant_id,
    delivery_grant.approval_decision_id,
    delivery_grant.state_fingerprint AS grant_state_fingerprint,
    delivery_grant.status AS grant_status, delivery_grant.granted_by,
    delivery_grant.granted_at,
    delivery_grant.cooldown_expires_at AS grant_cooldown_expires_at,
    cooldown.grant_id AS cooldown_grant_id,
    cooldown.claimed_at AS cooldown_claimed_at,
    cooldown.expires_at AS cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    decision.created_at AS decided_at,
    request.requested_by, request.created_at AS request_created_at,
    request.expires_at AS request_expires_at, request.preview_schema_version,
    request.preview_action, request.preview_severity, request.preview_reasons,
    outbox.id AS prior_outbox_id,
    outbox.client_outbox_id AS prior_client_outbox_id,
    outbox.created_by AS prior_created_by
  FROM shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
  JOIN shipment_apv_manifest_archive_alert_cooldown_claims cooldown
    ON cooldown.state_fingerprint = delivery_grant.state_fingerprint
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  LEFT JOIN shipment_apv_manifest_archive_alert_payload_outbox outbox
    ON outbox.delivery_grant_id = delivery_grant.id`;

export async function createShipmentApvReceiverManifestArchiveAlertPayloadOutbox(
  db: Pick<Database, "transaction">,
  input: {
    deliveryGrantId: string;
    clientOutboxId: string;
    createdBy: string;
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
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-decision.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-grant.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-payload.v1', 0))`);

    const existingRows = await transaction.execute(sql`${outboxBindingSql}
      WHERE outbox.client_outbox_id = ${input.clientOutboxId}::uuid
      LIMIT 1`);
    const existing = (existingRows as unknown as BindingRow[])[0];
    if (existing) {
      if (!exactReplayMatches(existing, input)
        || !safelyValidOutboxBinding(existing)) {
        throw new Error(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_REPLAY_CONFLICT");
      }
      return publicOutbox(existing, true);
    }

    const bindingRows = await transaction.execute(sql`${grantBindingSql}
      WHERE delivery_grant.id = ${input.deliveryGrantId}::uuid
      LIMIT 1`);
    const binding = (bindingRows as unknown as Array<BindingRow & {
      prior_outbox_id: unknown; prior_client_outbox_id: unknown;
      prior_created_by: unknown;
    }>)[0];
    if (!binding) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_GRANT_NOT_FOUND");
    }
    if (!safelyValidGrantBinding(binding)) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_GRANT_INVALID");
    }
    if (String(binding.granted_by) !== input.createdBy) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ACTOR_MISMATCH");
    }
    if (binding.prior_outbox_id) {
      if (String(binding.prior_client_outbox_id) === input.clientOutboxId
        && String(binding.prior_created_by) === input.createdBy) {
        const replayRows = await transaction.execute(sql`${outboxBindingSql}
          WHERE outbox.id = ${String(binding.prior_outbox_id)}::uuid LIMIT 1`);
        const replay = (replayRows as unknown as BindingRow[])[0];
        if (replay && exactReplayMatches(replay, input)
          && safelyValidOutboxBinding(replay)) return publicOutbox(replay, true);
      }
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ALREADY_CREATED");
    }
    if (Date.parse(String(binding.grant_cooldown_expires_at)) <= now.getTime()) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_EXPIRED");
    }

    const preview =
      await getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(
        transaction);
    if (preview.action === "none" || !preview.approval.required
      || !previewMatches(binding, preview)) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED");
    }

    const payload = expectedPayload(binding);
    const canonical = canonicalPayload(payload);
    const sha256 = payloadHash(payload);
    const createdAt = now.toISOString();
    const insertedRows = await transaction.execute(sql`INSERT INTO
        shipment_apv_manifest_archive_alert_payload_outbox
        (client_outbox_id, delivery_grant_id, state_fingerprint, payload,
          canonical_payload, payload_sha256, status, created_by, created_at)
      VALUES (${input.clientOutboxId}::uuid, ${input.deliveryGrantId}::uuid,
        ${payload.state_fingerprint}, ${JSON.stringify(payload)}::jsonb,
        ${canonical}, ${sha256}, 'UNSIGNED_DRY_RUN', ${input.createdBy}::uuid,
        ${createdAt}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING id`);
    const inserted = (insertedRows as unknown as unknown[]).length === 1;
    const winnerRows = await transaction.execute(sql`${outboxBindingSql}
      WHERE outbox.client_outbox_id = ${input.clientOutboxId}::uuid
        OR outbox.delivery_grant_id = ${input.deliveryGrantId}::uuid
      LIMIT 1`);
    const winner = (winnerRows as unknown as BindingRow[])[0];
    if (!winner) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_UNAVAILABLE");
    }
    if (!exactReplayMatches(winner, input)
      || !safelyValidOutboxBinding(winner)) {
      if (String(winner.outbox_delivery_grant_id) === input.deliveryGrantId) {
        throw new Error(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ALREADY_CREATED");
      }
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_REPLAY_CONFLICT");
    }
    return publicOutbox(winner, !inserted);
  });
}
