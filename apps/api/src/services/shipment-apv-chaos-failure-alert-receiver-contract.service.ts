import { createHash } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { verifyShipmentApvFailureAlertPayloadSignature } from "./shipment-apv-chaos-failure-alert-signature.service.js";

const FRESHNESS_WINDOW_SECONDS = 300;
const FUTURE_TOLERANCE_SECONDS = 5;

type ReceiverBindingRow = {
  delivery_intent_id: unknown;
  payload_signature_id: unknown;
  payload_outbox_id: unknown;
  payload_sha256: unknown;
  canonical_payload: unknown;
  signing_domain: unknown;
  algorithm: unknown;
  key_id: unknown;
  signature_public_key: unknown;
  signature_base64: unknown;
  signed_at: unknown;
  intent_status: unknown;
  http_request_created: unknown;
  delivery_attempted: unknown;
  registry_public_key: unknown;
  key_event_type: unknown;
};

function parsedTime(value: unknown) {
  const milliseconds = Date.parse(String(value));
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function verifyPayloadContract(canonicalPayload: string) {
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
    if (
      Object.keys(payload).join("|") !== expectedKeys.join("|") ||
      payload.schema_version !== "shipment-apv-failure-alert-payload-v1" ||
      payload.event_type !== "shipment_apv_failure_alert" ||
      !["review_warning", "escalate_critical", "review_recovery"].includes(
        String(payload.action),
      ) ||
      !["warning", "critical"].includes(String(payload.severity)) ||
      !Array.isArray(payload.reasons) ||
      payload.reasons.length < 1 ||
      payload.reasons.length > 3 ||
      !payload.reasons.every(
        (reason) => typeof reason === "string" && /^[a-z_]{3,80}$/.test(reason),
      ) ||
      typeof payload.state_fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(payload.state_fingerprint)
    )
      return false;
    const warningReasons = new Set([
      "rollback_verification_warning",
      "rollback_failure_isolation_warning",
      "fixture_execution_warning",
    ]);
    const criticalReasons = new Set([
      "rollback_verification_critical",
      "rollback_failure_isolation_critical",
      "fixture_execution_critical",
    ]);
    const semantic =
      (payload.action === "review_warning" &&
        payload.severity === "warning" &&
        payload.reasons.every((reason) => warningReasons.has(String(reason)))) ||
      (payload.action === "escalate_critical" &&
        payload.severity === "critical" &&
        payload.reasons.every((reason) => criticalReasons.has(String(reason)))) ||
      (payload.action === "review_recovery" &&
        ["warning", "critical"].includes(String(payload.severity)) &&
        payload.reasons.length === 1 &&
        payload.reasons[0] === `recovered_from_${payload.severity}`);
    return semantic && JSON.stringify(payload) === canonicalPayload;
  } catch {
    return false;
  }
}

export async function verifyShipmentApvFailureAlertReceiverContract(
  db: Pick<Database, "execute">,
  input: { deliveryIntentId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`SELECT intent.id AS delivery_intent_id,
      signature.id AS payload_signature_id, signature.payload_outbox_id,
      signature.payload_sha256, outbox.canonical_payload,
      signature.signing_domain, signature.algorithm, signature.key_id,
      signature.public_key_spki_base64 AS signature_public_key,
      signature.signature_base64, signature.signed_at,
      intent.status AS intent_status, intent.http_request_created,
      intent.delivery_attempted,
      signing_key.public_key_spki_base64 AS registry_public_key,
      key_event.event_type AS key_event_type
    FROM shipment_apv_failure_alert_delivery_intents intent
    JOIN shipment_apv_failure_alert_payload_signatures signature
      ON signature.id = intent.payload_signature_id
    JOIN shipment_apv_failure_alert_payload_outbox outbox
      ON outbox.id = signature.payload_outbox_id
    JOIN shipment_apv_failure_alert_signing_keys signing_key
      ON signing_key.key_id = signature.key_id
    JOIN LATERAL (
      SELECT event.event_type
      FROM shipment_apv_failure_alert_signing_key_events event
      WHERE event.key_id = signing_key.key_id
      ORDER BY event.created_at DESC, event.id DESC LIMIT 1
    ) key_event ON true
    WHERE intent.id = ${input.deliveryIntentId}::uuid LIMIT 1`);
  const row = (rows as unknown as ReceiverBindingRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_NOT_FOUND");

  const payloadSha256 = String(row.payload_sha256);
  const canonicalPayload = String(row.canonical_payload);
  const payloadContractVerified = verifyPayloadContract(canonicalPayload);
  const payloadHashVerified =
    createHash("sha256").update(canonicalPayload, "utf8").digest("hex") === payloadSha256;
  const keyBindingVerified =
    String(row.registry_public_key) === String(row.signature_public_key) &&
    String(row.key_event_type) === "REGISTERED";
  const signatureVerified = verifyShipmentApvFailureAlertPayloadSignature({
    payloadSha256,
    signingDomain: String(row.signing_domain),
    algorithm: String(row.algorithm),
    keyId: String(row.key_id),
    publicKeySpkiBase64: String(row.signature_public_key),
    signatureBase64: String(row.signature_base64),
  });
  const signedAt = parsedTime(row.signed_at);
  const ageMilliseconds = signedAt === null ? null : now.getTime() - signedAt;
  const freshnessVerified =
    ageMilliseconds !== null &&
    ageMilliseconds >= -FUTURE_TOLERANCE_SECONDS * 1000 &&
    ageMilliseconds <= FRESHNESS_WINDOW_SECONDS * 1000;
  const intentBlocked =
    String(row.intent_status) === "BLOCKED_CONFIGURATION_DRY_RUN" &&
    row.http_request_created === false &&
    row.delivery_attempted === false;

  if (
    !payloadContractVerified ||
    !payloadHashVerified ||
    !keyBindingVerified ||
    !signatureVerified ||
    !freshnessVerified ||
    !intentBlocked
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
  }

  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-contract-v1",
    deliveryIntentId: String(row.delivery_intent_id),
    payloadSignatureId: String(row.payload_signature_id),
    status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN" as const,
    contractVersion: "v1" as const,
    payloadContractVerified: true,
    payloadHashVerified: true,
    signatureVerified: true,
    keyBindingVerified: true,
    freshnessVerified: true,
    freshnessWindowSeconds: FRESHNESS_WINDOW_SECONDS,
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE" as const,
    independentTrustAnchor: false,
    networkReceived: false,
    productionAccepted: false,
    persistent: false,
    replayProtection: { enabled: false, persistent: false },
    delivery: { enabled: false, attempted: false },
  };
}
