import { createHash } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION } from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-payload.service.js";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
} from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";
import {
  SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN,
  verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature,
} from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-signature.service.js";

const BLOCKING_REASONS = [
  "independent_trust_anchor_missing",
  "receiver_endpoint_missing",
  "receiver_credential_missing",
] as const;

type Payload = {
  schema_version: typeof SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION;
  event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert";
  action: string;
  severity: string;
  reasons: string[];
  state_fingerprint: string;
};

type BindingRow = {
  intent_id: unknown;
  client_delivery_intent_id: unknown;
  intent_payload_signature_id: unknown;
  intent_payload_outbox_id: unknown;
  intent_payload_sha256: unknown;
  intent_key_id: unknown;
  intent_status: unknown;
  blocking_reasons: unknown;
  http_request_created: unknown;
  delivery_attempted: unknown;
  intent_requested_by: unknown;
  intent_created_at: unknown;
  signature_id: unknown;
  signature_payload_outbox_id: unknown;
  signature_payload_sha256: unknown;
  signing_domain: unknown;
  algorithm: unknown;
  key_id: unknown;
  public_key_spki_base64: unknown;
  signature_base64: unknown;
  signature_status: unknown;
  signed_by: unknown;
  signed_at: unknown;
  registry_public_key: unknown;
  registry_event_type: unknown;
  registry_event_created_at: unknown;
  current_registry_public_key: unknown;
  current_registry_event_type: unknown;
  current_registry_event_created_at: unknown;
  outbox_id: unknown;
  outbox_delivery_grant_id: unknown;
  state_fingerprint: unknown;
  payload: unknown;
  canonical_payload: unknown;
  payload_sha256: unknown;
  outbox_status: unknown;
  created_by: unknown;
  outbox_created_at: unknown;
  grant_id: unknown;
  grant_status: unknown;
  granted_by: unknown;
  granted_at: unknown;
  cooldown_expires_at: unknown;
  current_cooldown_grant_id: unknown;
  current_cooldown_claimed_at: unknown;
  current_cooldown_expires_at: unknown;
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
  throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_INVALID");
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function stringArray(value: unknown) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    invalid();
  }
  return value as string[];
}

function payloadObject(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const keys = Object.keys(value as object).sort();
  const expected = [
    "action",
    "event_type",
    "reasons",
    "schema_version",
    "severity",
    "state_fingerprint",
  ];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) invalid();
  return value as Payload;
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

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function immutableAncestryValid(row: BindingRow) {
  const payload = payloadObject(row.payload);
  const previewReasons = stringArray(row.preview_reasons);
  const expected: Payload = {
    schema_version: SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION,
    event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert",
    action: String(row.preview_action),
    severity: String(row.preview_severity),
    reasons: previewReasons,
    state_fingerprint: String(row.state_fingerprint),
  };
  const orderedReasons = [
    "archive_intent_binding_violation",
    "archive_intent_blocker_violation",
    "archive_intent_side_effect_violation",
    "archive_intent_timestamp_violation",
    "archive_source_limit_violation",
    "current_archive_intent_missing",
    "archive_intent_stale",
  ];
  const reasonIndexes = previewReasons.map((reason) => orderedReasons.indexOf(reason));
  const critical = reasonIndexes.some((index) => index >= 0 && index <= 4);
  const requestedAt = Date.parse(iso(row.request_created_at));
  const requestExpiresAt = Date.parse(iso(row.request_expires_at));
  const decidedAt = Date.parse(iso(row.decided_at));
  const grantedAt = Date.parse(iso(row.granted_at));
  const outboxCreatedAt = Date.parse(iso(row.outbox_created_at));
  const signedAt = Date.parse(iso(row.signed_at));
  const cooldownExpiresAt = Date.parse(iso(row.cooldown_expires_at));
  const signature = {
    payloadSha256: String(row.signature_payload_sha256),
    signingDomain: String(row.signing_domain),
    algorithm: String(row.algorithm),
    keyId: String(row.key_id),
    publicKeySpkiBase64: String(row.public_key_spki_base64),
    signatureBase64: String(row.signature_base64),
  };
  return (
    String(row.signature_id) !== "" &&
    String(row.signature_payload_outbox_id) === String(row.outbox_id) &&
    signature.payloadSha256 === String(row.payload_sha256) &&
    signature.signingDomain === SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN &&
    String(row.signature_status) === "SIGNED_DRY_RUN" &&
    String(row.outbox_delivery_grant_id) === String(row.grant_id) &&
    String(row.outbox_status) === "UNSIGNED_DRY_RUN" &&
    String(row.grant_status) === "GRANTED_DRY_RUN" &&
    String(row.created_by) === String(row.signed_by) &&
    String(row.created_by) === String(row.granted_by) &&
    String(row.decision) === "APPROVED" &&
    String(row.decision_reason) === "checker_approved_snapshot" &&
    String(row.decided_by) === String(row.granted_by) &&
    String(row.requested_by) !== String(row.granted_by) &&
    String(row.preview_schema_version) ===
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION &&
    /^[0-9a-f]{64}$/.test(String(row.state_fingerprint)) &&
    previewReasons.length >= 1 &&
    previewReasons.length <= 7 &&
    reasonIndexes.every((index) => index >= 0) &&
    reasonIndexes.every(
      (index, position) => position === 0 || index > reasonIndexes[position - 1]!,
    ) &&
    (expected.action === "review_warning"
      ? expected.severity === "warning" && !critical
      : expected.action === "escalate_critical" && expected.severity === "critical" && critical) &&
    requestExpiresAt > requestedAt &&
    requestExpiresAt <= requestedAt + 15 * 60_000 &&
    decidedAt >= requestedAt &&
    decidedAt < requestExpiresAt &&
    grantedAt >= decidedAt &&
    grantedAt < requestExpiresAt &&
    cooldownExpiresAt === grantedAt + 15 * 60_000 &&
    outboxCreatedAt >= grantedAt &&
    outboxCreatedAt < cooldownExpiresAt &&
    signedAt >= outboxCreatedAt &&
    signedAt < cooldownExpiresAt &&
    canonicalPayload(payload) === canonicalPayload(expected) &&
    String(row.canonical_payload) === canonicalPayload(expected) &&
    String(row.payload_sha256) === sha256(canonicalPayload(expected)) &&
    String(row.registry_event_type) === "REGISTERED" &&
    String(row.registry_public_key) === signature.publicKeySpkiBase64 &&
    Date.parse(iso(row.registry_event_created_at)) <= signedAt &&
    verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature(signature)
  );
}

function safelyValidAncestry(row: BindingRow) {
  try {
    return immutableAncestryValid(row);
  } catch {
    return false;
  }
}

function intentValid(row: BindingRow) {
  if (!row.intent_id || !immutableAncestryValid(row)) return false;
  const createdAt = Date.parse(iso(row.intent_created_at));
  const signedAt = Date.parse(iso(row.signed_at));
  const expiresAt = Date.parse(iso(row.cooldown_expires_at));
  return (
    String(row.intent_payload_signature_id) === String(row.signature_id) &&
    String(row.intent_payload_outbox_id) === String(row.outbox_id) &&
    String(row.intent_payload_sha256) === String(row.payload_sha256) &&
    String(row.intent_key_id) === String(row.key_id) &&
    String(row.intent_status) === "BLOCKED_CONFIGURATION_DRY_RUN" &&
    JSON.stringify(stringArray(row.blocking_reasons)) === JSON.stringify(BLOCKING_REASONS) &&
    row.http_request_created === false &&
    row.delivery_attempted === false &&
    String(row.intent_requested_by) === String(row.signed_by) &&
    createdAt >= signedAt &&
    createdAt < expiresAt
  );
}

function safelyValidIntent(row: BindingRow) {
  try {
    return intentValid(row);
  } catch {
    return false;
  }
}

function exactReplayMatches(
  row: BindingRow,
  input: {
    payloadSignatureId: string;
    clientDeliveryIntentId: string;
    requestedBy: string;
  },
) {
  return (
    String(row.client_delivery_intent_id) === input.clientDeliveryIntentId &&
    String(row.intent_payload_signature_id) === input.payloadSignatureId &&
    String(row.intent_requested_by) === input.requestedBy
  );
}

function publicIntent(row: BindingRow, replayed: boolean) {
  if (!intentValid(row)) invalid();
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-intent-v1",
    deliveryIntentId: String(row.intent_id),
    clientDeliveryIntentId: String(row.client_delivery_intent_id),
    payloadSignatureId: String(row.intent_payload_signature_id),
    payloadOutboxId: String(row.intent_payload_outbox_id),
    payloadSha256: String(row.intent_payload_sha256),
    keyId: String(row.intent_key_id),
    status: "BLOCKED_CONFIGURATION_DRY_RUN" as const,
    blockingReasons: [...BLOCKING_REASONS],
    createdAt: iso(row.intent_created_at),
    replayed,
    persistent: true,
    appendOnly: true,
    executable: false,
    requestedByIdentityReturned: false,
    signatureValueReturned: false,
    publicKeyReturned: false,
    independentTrustAnchor: false,
    endpointConfigured: false,
    credentialConfigured: false,
    http: { requestCreated: false },
    delivery: { enabled: false, attempted: false },
    networkRequestSent: false,
    externalReceiptVerified: false,
    productionAccepted: false,
  };
}

function previewMatches(
  row: BindingRow,
  preview: Awaited<
    ReturnType<typeof getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview>
  >,
) {
  return (
    String(row.state_fingerprint) === preview.stateFingerprint &&
    String(row.preview_action) === preview.action &&
    String(row.preview_severity) === preview.severity &&
    JSON.stringify(stringArray(row.preview_reasons)) === JSON.stringify(preview.reasons)
  );
}

const historicalBindingSql = sql`SELECT
    intent.id AS intent_id, intent.client_delivery_intent_id,
    intent.payload_signature_id AS intent_payload_signature_id,
    intent.payload_outbox_id AS intent_payload_outbox_id,
    intent.payload_sha256 AS intent_payload_sha256,
    intent.key_id AS intent_key_id, intent.status AS intent_status,
    intent.blocking_reasons, intent.http_request_created,
    intent.delivery_attempted, intent.requested_by AS intent_requested_by,
    intent.created_at AS intent_created_at,
    signature.id AS signature_id,
    signature.payload_outbox_id AS signature_payload_outbox_id,
    signature.payload_sha256 AS signature_payload_sha256,
    signature.signing_domain, signature.algorithm, signature.key_id,
    signature.public_key_spki_base64, signature.signature_base64,
    signature.status AS signature_status, signature.signed_by,
    signature.signed_at, registry.public_key_spki_base64 AS registry_public_key,
    registry_event.event_type AS registry_event_type,
    registry_event.created_at AS registry_event_created_at,
    NULL::text AS current_registry_public_key,
    NULL::text AS current_registry_event_type,
    NULL::timestamptz AS current_registry_event_created_at,
    outbox.id AS outbox_id, outbox.delivery_grant_id AS outbox_delivery_grant_id,
    outbox.state_fingerprint, outbox.payload, outbox.canonical_payload,
    outbox.payload_sha256, outbox.status AS outbox_status,
    outbox.created_by, outbox.created_at AS outbox_created_at,
    delivery_grant.id AS grant_id, delivery_grant.status AS grant_status,
    delivery_grant.granted_by, delivery_grant.granted_at,
    delivery_grant.cooldown_expires_at,
    NULL::uuid AS current_cooldown_grant_id,
    NULL::timestamptz AS current_cooldown_claimed_at,
    NULL::timestamptz AS current_cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    decision.created_at AS decided_at,
    request.requested_by, request.created_at AS request_created_at,
    request.expires_at AS request_expires_at, request.preview_schema_version,
    request.preview_action, request.preview_severity, request.preview_reasons
  FROM shipment_apv_manifest_archive_alert_delivery_intents intent
  JOIN shipment_apv_manifest_archive_alert_payload_signatures signature
    ON signature.id = intent.payload_signature_id
  JOIN shipment_apv_manifest_archive_alert_payload_outbox outbox
    ON outbox.id = signature.payload_outbox_id
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  JOIN shipment_apv_failure_alert_signing_keys registry
    ON registry.key_id = signature.key_id
  JOIN LATERAL (
    SELECT event.event_type, event.created_at, event.id
    FROM shipment_apv_failure_alert_signing_key_events event
    WHERE event.key_id = signature.key_id
      AND event.created_at <= signature.signed_at
    ORDER BY event.created_at DESC, event.id DESC LIMIT 1
  ) registry_event ON true`;

const currentBindingSql = sql`SELECT
    intent.id AS intent_id, intent.client_delivery_intent_id,
    intent.payload_signature_id AS intent_payload_signature_id,
    intent.payload_outbox_id AS intent_payload_outbox_id,
    intent.payload_sha256 AS intent_payload_sha256,
    intent.key_id AS intent_key_id, intent.status AS intent_status,
    intent.blocking_reasons, intent.http_request_created,
    intent.delivery_attempted, intent.requested_by AS intent_requested_by,
    intent.created_at AS intent_created_at,
    signature.id AS signature_id,
    signature.payload_outbox_id AS signature_payload_outbox_id,
    signature.payload_sha256 AS signature_payload_sha256,
    signature.signing_domain, signature.algorithm, signature.key_id,
    signature.public_key_spki_base64, signature.signature_base64,
    signature.status AS signature_status, signature.signed_by,
    signature.signed_at, registry.public_key_spki_base64 AS registry_public_key,
    signed_event.event_type AS registry_event_type,
    signed_event.created_at AS registry_event_created_at,
    registry.public_key_spki_base64 AS current_registry_public_key,
    current_event.event_type AS current_registry_event_type,
    current_event.created_at AS current_registry_event_created_at,
    outbox.id AS outbox_id, outbox.delivery_grant_id AS outbox_delivery_grant_id,
    outbox.state_fingerprint, outbox.payload, outbox.canonical_payload,
    outbox.payload_sha256, outbox.status AS outbox_status,
    outbox.created_by, outbox.created_at AS outbox_created_at,
    delivery_grant.id AS grant_id, delivery_grant.status AS grant_status,
    delivery_grant.granted_by, delivery_grant.granted_at,
    delivery_grant.cooldown_expires_at,
    cooldown.grant_id AS current_cooldown_grant_id,
    cooldown.claimed_at AS current_cooldown_claimed_at,
    cooldown.expires_at AS current_cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    decision.created_at AS decided_at,
    request.requested_by, request.created_at AS request_created_at,
    request.expires_at AS request_expires_at, request.preview_schema_version,
    request.preview_action, request.preview_severity, request.preview_reasons
  FROM shipment_apv_manifest_archive_alert_payload_signatures signature
  JOIN shipment_apv_manifest_archive_alert_payload_outbox outbox
    ON outbox.id = signature.payload_outbox_id
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_cooldown_claims cooldown
    ON cooldown.state_fingerprint = delivery_grant.state_fingerprint
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  JOIN shipment_apv_failure_alert_signing_keys registry
    ON registry.key_id = signature.key_id
  JOIN LATERAL (
    SELECT event.event_type, event.created_at, event.id
    FROM shipment_apv_failure_alert_signing_key_events event
    WHERE event.key_id = signature.key_id
      AND event.created_at <= signature.signed_at
    ORDER BY event.created_at DESC, event.id DESC LIMIT 1
  ) signed_event ON true
  JOIN LATERAL (
    SELECT event.event_type, event.created_at, event.id
    FROM shipment_apv_failure_alert_signing_key_events event
    WHERE event.key_id = signature.key_id
    ORDER BY event.created_at DESC, event.id DESC LIMIT 1
  ) current_event ON true
  LEFT JOIN shipment_apv_manifest_archive_alert_delivery_intents intent
    ON intent.payload_signature_id = signature.id`;

export async function createShipmentApvReceiverManifestArchiveAlertDeliveryIntent(
  db: Pick<Database, "transaction">,
  input: {
    payloadSignatureId: string;
    clientDeliveryIntentId: string;
    requestedBy: string;
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
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-payload.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-signature.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-delivery-intent.v1', 0))`);

    const existingRows = await transaction.execute(sql`${historicalBindingSql}
      WHERE intent.client_delivery_intent_id =
        ${input.clientDeliveryIntentId}::uuid LIMIT 1`);
    const existing = (existingRows as unknown as BindingRow[])[0];
    if (existing) {
      if (!exactReplayMatches(existing, input) || !safelyValidIntent(existing)) {
        throw new Error(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_REPLAY_CONFLICT",
        );
      }
      return publicIntent(existing, true);
    }

    const bindingRows = await transaction.execute(sql`${currentBindingSql}
      WHERE signature.id = ${input.payloadSignatureId}::uuid LIMIT 1`);
    const binding = (bindingRows as unknown as BindingRow[])[0];
    if (!binding) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_NOT_FOUND");
    }
    if (!safelyValidAncestry(binding)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_INVALID");
    }
    if (String(binding.signed_by) !== input.requestedBy) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_ACTOR_MISMATCH",
      );
    }
    if (binding.intent_id) {
      if (exactReplayMatches(binding, input) && safelyValidIntent(binding)) {
        return publicIntent(binding, true);
      }
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_ALREADY_CREATED",
      );
    }
    const grantedAt = Date.parse(iso(binding.granted_at));
    const expiresAt = Date.parse(iso(binding.cooldown_expires_at));
    if (
      String(binding.current_cooldown_grant_id) !== String(binding.grant_id) ||
      Date.parse(iso(binding.current_cooldown_claimed_at)) !== grantedAt ||
      Date.parse(iso(binding.current_cooldown_expires_at)) !== expiresAt ||
      now.getTime() < grantedAt ||
      now.getTime() >= expiresAt
    ) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_EXPIRED");
    }
    if (
      String(binding.current_registry_event_type) !== "REGISTERED" ||
      String(binding.current_registry_public_key) !== String(binding.public_key_spki_base64) ||
      Date.parse(iso(binding.current_registry_event_created_at)) > now.getTime()
    ) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_KEY_NOT_ACTIVE");
    }
    const preview =
      await getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(transaction);
    if (
      preview.action === "none" ||
      !preview.approval.required ||
      !previewMatches(binding, preview)
    ) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED");
    }

    await transaction.execute(sql`INSERT INTO
      shipment_apv_manifest_archive_alert_delivery_intents
        (client_delivery_intent_id, payload_signature_id, payload_outbox_id,
          payload_sha256, key_id, status, blocking_reasons,
          http_request_created, delivery_attempted, requested_by, created_at)
      VALUES (${input.clientDeliveryIntentId}::uuid,
        ${input.payloadSignatureId}::uuid, ${String(binding.outbox_id)}::uuid,
        ${String(binding.payload_sha256)}, ${String(binding.key_id)},
        'BLOCKED_CONFIGURATION_DRY_RUN',
        ARRAY[${BLOCKING_REASONS[0]}, ${BLOCKING_REASONS[1]},
          ${BLOCKING_REASONS[2]}]::text[], false, false,
        ${input.requestedBy}::uuid, ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING`);

    const winnerRows = await transaction.execute(sql`${historicalBindingSql}
      WHERE intent.payload_signature_id = ${input.payloadSignatureId}::uuid
      LIMIT 1`);
    const winner = (winnerRows as unknown as BindingRow[])[0];
    if (!winner) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_UNAVAILABLE");
    }
    if (!exactReplayMatches(winner, input)) {
      throw new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_ALREADY_CREATED",
      );
    }
    if (!safelyValidIntent(winner)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_INVALID");
    }
    return publicIntent(winner, false);
  });
}
