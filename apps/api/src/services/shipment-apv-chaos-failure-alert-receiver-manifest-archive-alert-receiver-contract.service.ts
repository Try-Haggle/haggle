import { createHash } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION } from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-payload.service.js";
import { SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION } from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";
import { verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature } from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-signature.service.js";

const FRESHNESS_WINDOW_SECONDS = 300;
const FUTURE_TOLERANCE_SECONDS = 5;
const BLOCKING_REASONS = [
  "independent_trust_anchor_missing",
  "receiver_endpoint_missing",
  "receiver_credential_missing",
] as const;
const ORDERED_REASONS = [
  "archive_intent_binding_violation",
  "archive_intent_blocker_violation",
  "archive_intent_side_effect_violation",
  "archive_intent_timestamp_violation",
  "archive_source_limit_violation",
  "current_archive_intent_missing",
  "archive_intent_stale",
] as const;

type ReceiverBindingRow = {
  delivery_intent_id: unknown;
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
  signature_key_id: unknown;
  signature_public_key: unknown;
  signature_base64: unknown;
  signature_status: unknown;
  signature_signed_by: unknown;
  signed_at: unknown;
  outbox_id: unknown;
  outbox_delivery_grant_id: unknown;
  outbox_state_fingerprint: unknown;
  canonical_payload: unknown;
  outbox_payload_sha256: unknown;
  outbox_status: unknown;
  outbox_created_by: unknown;
  outbox_created_at: unknown;
  grant_id: unknown;
  grant_approval_decision_id: unknown;
  grant_status: unknown;
  granted_by: unknown;
  granted_at: unknown;
  cooldown_expires_at: unknown;
  cooldown_grant_id: unknown;
  cooldown_claimed_at: unknown;
  cooldown_claim_expires_at: unknown;
  decision_id: unknown;
  decision_approval_request_id: unknown;
  decision: unknown;
  decision_reason: unknown;
  decided_by: unknown;
  decided_at: unknown;
  request_id: unknown;
  requested_by: unknown;
  request_state_fingerprint: unknown;
  request_created_at: unknown;
  request_expires_at: unknown;
  preview_schema_version: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
  registry_public_key: unknown;
  key_event_type: unknown;
  key_event_created_at: unknown;
};

function parsedTime(value: unknown) {
  const milliseconds = Date.parse(String(value));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : null;
}

function parsePayloadContract(canonicalPayload: string) {
  try {
    const payload = JSON.parse(canonicalPayload) as Record<string, unknown>;
    const expectedKeys = [
      "action",
      "event_type",
      "reasons",
      "schema_version",
      "severity",
      "state_fingerprint",
    ];
    const reasons = stringArray(payload.reasons);
    if (
      Object.keys(payload).join("|") !== expectedKeys.join("|") ||
      payload.schema_version !== SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION ||
      payload.event_type !== "shipment_apv_failure_alert_receiver_manifest_archive_alert" ||
      !reasons ||
      reasons.length < 1 ||
      reasons.length > ORDERED_REASONS.length ||
      typeof payload.state_fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(payload.state_fingerprint) ||
      JSON.stringify(payload) !== canonicalPayload
    )
      return null;
    const reasonIndexes = reasons.map((reason) =>
      ORDERED_REASONS.indexOf(reason as (typeof ORDERED_REASONS)[number]),
    );
    if (
      reasonIndexes.some((index) => index < 0) ||
      reasonIndexes.some((index, position) => position > 0 && index <= reasonIndexes[position - 1]!)
    )
      return null;
    const critical = reasonIndexes.some((index) => index <= 4);
    const semanticsValid =
      payload.action === "review_warning"
        ? payload.severity === "warning" && !critical
        : payload.action === "escalate_critical" && payload.severity === "critical" && critical;
    return semanticsValid
      ? {
          action: String(payload.action),
          severity: String(payload.severity),
          reasons,
          stateFingerprint: String(payload.state_fingerprint),
        }
      : null;
  } catch {
    return null;
  }
}

export async function verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
  db: Pick<Database, "execute">,
  input: { deliveryIntentId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`SELECT
      intent.id AS delivery_intent_id,
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
      signature.signing_domain, signature.algorithm,
      signature.key_id AS signature_key_id,
      signature.public_key_spki_base64 AS signature_public_key,
      signature.signature_base64, signature.status AS signature_status,
      signature.signed_by AS signature_signed_by, signature.signed_at,
      outbox.id AS outbox_id,
      outbox.delivery_grant_id AS outbox_delivery_grant_id,
      outbox.state_fingerprint AS outbox_state_fingerprint,
      outbox.canonical_payload,
      outbox.payload_sha256 AS outbox_payload_sha256,
      outbox.status AS outbox_status, outbox.created_by AS outbox_created_by,
      outbox.created_at AS outbox_created_at,
      delivery_grant.id AS grant_id,
      delivery_grant.approval_decision_id AS grant_approval_decision_id,
      delivery_grant.status AS grant_status, delivery_grant.granted_by,
      delivery_grant.granted_at,
      delivery_grant.cooldown_expires_at,
      cooldown.grant_id AS cooldown_grant_id,
      cooldown.claimed_at AS cooldown_claimed_at,
      cooldown.expires_at AS cooldown_claim_expires_at,
      decision.id AS decision_id,
      decision.approval_request_id AS decision_approval_request_id,
      decision.decision, decision.decision_reason, decision.decided_by,
      decision.created_at AS decided_at,
      request.id AS request_id, request.requested_by,
      request.state_fingerprint AS request_state_fingerprint,
      request.created_at AS request_created_at,
      request.expires_at AS request_expires_at,
      request.preview_schema_version, request.preview_action,
      request.preview_severity, request.preview_reasons,
      signing_key.public_key_spki_base64 AS registry_public_key,
      key_event.event_type AS key_event_type,
      key_event.created_at AS key_event_created_at
    FROM shipment_apv_manifest_archive_alert_delivery_intents intent
    JOIN shipment_apv_manifest_archive_alert_payload_signatures signature
      ON signature.id = intent.payload_signature_id
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
    JOIN shipment_apv_failure_alert_signing_keys signing_key
      ON signing_key.key_id = signature.key_id
    JOIN LATERAL (
      SELECT event.event_type, event.created_at
      FROM shipment_apv_failure_alert_signing_key_events event
      WHERE event.key_id = signing_key.key_id
      ORDER BY event.created_at DESC, event.id DESC LIMIT 1
    ) key_event ON true
    WHERE intent.id = ${input.deliveryIntentId}::uuid LIMIT 1`);
  const row = (rows as unknown as ReceiverBindingRow[])[0];
  if (!row) {
    throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_NOT_FOUND");
  }

  const canonicalPayload = String(row.canonical_payload);
  const payloadSha256 = String(row.intent_payload_sha256);
  const payloadContract = parsePayloadContract(canonicalPayload);
  const payloadContractVerified = payloadContract !== null;
  const payloadHashVerified =
    createHash("sha256").update(canonicalPayload, "utf8").digest("hex") === payloadSha256 &&
    String(row.signature_payload_sha256) === payloadSha256 &&
    String(row.outbox_payload_sha256) === payloadSha256;
  const signatureVerified = verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature({
    payloadSha256,
    signingDomain: String(row.signing_domain),
    algorithm: String(row.algorithm),
    keyId: String(row.signature_key_id),
    publicKeySpkiBase64: String(row.signature_public_key),
    signatureBase64: String(row.signature_base64),
  });
  const keyBindingVerified =
    String(row.intent_key_id) === String(row.signature_key_id) &&
    String(row.registry_public_key) === String(row.signature_public_key) &&
    String(row.key_event_type) === "REGISTERED";
  const signedAt = parsedTime(row.signed_at);
  const intentCreatedAt = parsedTime(row.intent_created_at);
  const outboxCreatedAt = parsedTime(row.outbox_created_at);
  const grantedAt = parsedTime(row.granted_at);
  const cooldownExpiresAt = parsedTime(row.cooldown_expires_at);
  const cooldownClaimedAt = parsedTime(row.cooldown_claimed_at);
  const cooldownClaimExpiresAt = parsedTime(row.cooldown_claim_expires_at);
  const decidedAt = parsedTime(row.decided_at);
  const requestCreatedAt = parsedTime(row.request_created_at);
  const requestExpiresAt = parsedTime(row.request_expires_at);
  const keyEventCreatedAt = parsedTime(row.key_event_created_at);
  const signatureAge = signedAt === null ? null : now.getTime() - signedAt;
  const intentAge = intentCreatedAt === null ? null : now.getTime() - intentCreatedAt;
  const freshnessVerified =
    signatureAge !== null &&
    intentAge !== null &&
    signatureAge >= -FUTURE_TOLERANCE_SECONDS * 1000 &&
    signatureAge <= FRESHNESS_WINDOW_SECONDS * 1000 &&
    intentAge >= -FUTURE_TOLERANCE_SECONDS * 1000 &&
    intentAge <= FRESHNESS_WINDOW_SECONDS * 1000;
  const blockingReasons = stringArray(row.blocking_reasons);
  const previewReasons = stringArray(row.preview_reasons);
  const intentBindingVerified =
    String(row.intent_payload_signature_id) === String(row.signature_id) &&
    String(row.intent_payload_outbox_id) === String(row.outbox_id) &&
    String(row.signature_payload_outbox_id) === String(row.outbox_id) &&
    String(row.intent_status) === "BLOCKED_CONFIGURATION_DRY_RUN" &&
    JSON.stringify(blockingReasons) === JSON.stringify(BLOCKING_REASONS) &&
    row.http_request_created === false &&
    row.delivery_attempted === false &&
    String(row.signature_status) === "SIGNED_DRY_RUN" &&
    String(row.outbox_status) === "UNSIGNED_DRY_RUN" &&
    String(row.grant_status) === "GRANTED_DRY_RUN" &&
    String(row.outbox_delivery_grant_id) === String(row.grant_id) &&
    String(row.grant_approval_decision_id) === String(row.decision_id) &&
    String(row.decision_approval_request_id) === String(row.request_id) &&
    String(row.cooldown_grant_id) === String(row.grant_id) &&
    String(row.decision) === "APPROVED" &&
    String(row.decision_reason) === "checker_approved_snapshot" &&
    String(row.requested_by) !== String(row.decided_by) &&
    String(row.decided_by) === String(row.granted_by) &&
    String(row.granted_by) === String(row.outbox_created_by) &&
    String(row.outbox_created_by) === String(row.signature_signed_by) &&
    String(row.signature_signed_by) === String(row.intent_requested_by) &&
    payloadContract !== null &&
    String(row.preview_schema_version) ===
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION &&
    String(row.request_state_fingerprint) === payloadContract.stateFingerprint &&
    String(row.outbox_state_fingerprint) === payloadContract.stateFingerprint &&
    String(row.preview_action) === payloadContract.action &&
    String(row.preview_severity) === payloadContract.severity &&
    JSON.stringify(previewReasons) === JSON.stringify(payloadContract.reasons) &&
    signedAt !== null &&
    intentCreatedAt !== null &&
    outboxCreatedAt !== null &&
    grantedAt !== null &&
    cooldownExpiresAt !== null &&
    cooldownClaimedAt !== null &&
    cooldownClaimExpiresAt !== null &&
    decidedAt !== null &&
    requestCreatedAt !== null &&
    requestExpiresAt !== null &&
    keyEventCreatedAt !== null &&
    requestExpiresAt > requestCreatedAt &&
    requestExpiresAt <= requestCreatedAt + 15 * 60_000 &&
    decidedAt >= requestCreatedAt &&
    decidedAt < requestExpiresAt &&
    grantedAt >= decidedAt &&
    grantedAt < requestExpiresAt &&
    cooldownClaimedAt === grantedAt &&
    cooldownClaimExpiresAt === cooldownExpiresAt &&
    cooldownExpiresAt === grantedAt + 15 * 60_000 &&
    outboxCreatedAt >= grantedAt &&
    outboxCreatedAt < cooldownExpiresAt &&
    signedAt >= outboxCreatedAt &&
    signedAt < cooldownExpiresAt &&
    keyEventCreatedAt <= signedAt &&
    intentCreatedAt >= signedAt &&
    intentCreatedAt < cooldownExpiresAt &&
    now.getTime() < cooldownExpiresAt;

  if (
    !payloadContractVerified ||
    !payloadHashVerified ||
    !signatureVerified ||
    !keyBindingVerified ||
    !freshnessVerified ||
    !intentBindingVerified
  ) {
    throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
  }

  return {
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-contract-v1",
    deliveryIntentId: String(row.delivery_intent_id),
    payloadSignatureId: String(row.signature_id),
    payloadOutboxId: String(row.outbox_id),
    status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN" as const,
    contractVersion: "v1" as const,
    payloadContractVerified: true,
    payloadHashVerified: true,
    signatureVerified: true,
    keyBindingVerified: true,
    freshnessVerified: true,
    intentBindingVerified: true,
    freshnessWindowSeconds: FRESHNESS_WINDOW_SECONDS,
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE" as const,
    independentTrustAnchor: false,
    actorIdentityReturned: false,
    signatureValueReturned: false,
    publicKeyReturned: false,
    networkReceived: false,
    externalReceiptVerified: false,
    productionAccepted: false,
    persistent: false,
    replayProtection: { enabled: false, persistent: false },
    delivery: { enabled: false, attempted: false },
  };
}
