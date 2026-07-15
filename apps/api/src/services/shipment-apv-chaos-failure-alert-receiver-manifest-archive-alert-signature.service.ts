import { createHash, createPublicKey, verify } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION } from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-payload.service.js";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
} from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";
import type { ShipmentApvFailureAlertPayloadSigner } from "./shipment-apv-chaos-failure-alert-signature.service.js";

export const SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN =
  "haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1";

type Payload = {
  schema_version: typeof SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION;
  event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert";
  action: string;
  severity: string;
  reasons: string[];
  state_fingerprint: string;
};

type BindingRow = {
  signature_id: unknown;
  client_signature_id: unknown;
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

type RegistryRow = {
  key_id: unknown;
  public_key_spki_base64: unknown;
  registered_at: unknown;
  event_type: unknown;
  event_created_at: unknown;
};

function invalid() {
  throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_INVALID");
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function reasons(value: unknown) {
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

function signingMessage(payloadSha256: string) {
  return Buffer.from(
    `${SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN}:${payloadSha256}`,
    "utf8",
  );
}

function publicKeyId(publicKeyDer: Buffer) {
  return createHash("sha256").update(publicKeyDer).digest("hex").slice(0, 24);
}

export function verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature(value: {
  payloadSha256: string;
  signingDomain: string;
  algorithm: string;
  keyId: string;
  publicKeySpkiBase64: string;
  signatureBase64: string;
}) {
  try {
    if (
      value.signingDomain !== SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN ||
      value.algorithm !== "Ed25519" ||
      !/^[0-9a-f]{64}$/.test(value.payloadSha256) ||
      !/^[0-9a-f]{24}$/.test(value.keyId) ||
      !/^[A-Za-z0-9+/]{59}=$/.test(value.publicKeySpkiBase64) ||
      !/^[A-Za-z0-9+/]{86}==$/.test(value.signatureBase64)
    )
      return false;
    const publicKeyDer = Buffer.from(value.publicKeySpkiBase64, "base64");
    const publicKey = createPublicKey({
      key: publicKeyDer,
      format: "der",
      type: "spki",
    });
    return (
      publicKey.asymmetricKeyType === "ed25519" &&
      publicKeyId(publicKeyDer) === value.keyId &&
      verify(
        null,
        signingMessage(value.payloadSha256),
        publicKey,
        Buffer.from(value.signatureBase64, "base64"),
      )
    );
  } catch {
    return false;
  }
}

function payloadBindingValid(row: BindingRow) {
  const payload = payloadObject(row.payload);
  const expected: Payload = {
    schema_version: SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_VERSION,
    event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert",
    action: String(row.preview_action),
    severity: String(row.preview_severity),
    reasons: reasons(row.preview_reasons),
    state_fingerprint: String(row.state_fingerprint),
  };
  const createdAt = Date.parse(iso(row.outbox_created_at));
  const requestedAt = Date.parse(iso(row.request_created_at));
  const requestExpiresAt = Date.parse(iso(row.request_expires_at));
  const decidedAt = Date.parse(iso(row.decided_at));
  const grantedAt = Date.parse(iso(row.granted_at));
  const expiresAt = Date.parse(iso(row.cooldown_expires_at));
  const orderedReasons = [
    "archive_intent_binding_violation",
    "archive_intent_blocker_violation",
    "archive_intent_side_effect_violation",
    "archive_intent_timestamp_violation",
    "archive_source_limit_violation",
    "current_archive_intent_missing",
    "archive_intent_stale",
  ];
  const reasonIndexes = expected.reasons.map((reason) => orderedReasons.indexOf(reason));
  const critical = reasonIndexes.some((index) => index >= 0 && index <= 4);
  return (
    String(row.outbox_id) !== "" &&
    String(row.outbox_delivery_grant_id) === String(row.grant_id) &&
    String(row.outbox_status) === "UNSIGNED_DRY_RUN" &&
    String(row.grant_status) === "GRANTED_DRY_RUN" &&
    String(row.created_by) === String(row.granted_by) &&
    String(row.decision) === "APPROVED" &&
    String(row.decision_reason) === "checker_approved_snapshot" &&
    String(row.decided_by) === String(row.granted_by) &&
    String(row.requested_by) !== String(row.granted_by) &&
    String(row.preview_schema_version) ===
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION &&
    /^[0-9a-f]{64}$/.test(String(row.state_fingerprint)) &&
    expected.reasons.length >= 1 &&
    expected.reasons.length <= 7 &&
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
    expiresAt === grantedAt + 15 * 60_000 &&
    createdAt >= grantedAt &&
    createdAt < expiresAt &&
    canonicalPayload(payload) === canonicalPayload(expected) &&
    String(row.canonical_payload) === canonicalPayload(expected) &&
    String(row.payload_sha256) === sha256(canonicalPayload(expected))
  );
}

function safelyValidPayloadBinding(row: BindingRow) {
  try {
    return payloadBindingValid(row);
  } catch {
    return false;
  }
}

function signatureBindingValid(row: BindingRow) {
  if (!row.signature_id || !payloadBindingValid(row)) return false;
  const signedAt = Date.parse(iso(row.signed_at));
  const createdAt = Date.parse(iso(row.outbox_created_at));
  const grantedAt = Date.parse(iso(row.granted_at));
  const expiresAt = Date.parse(iso(row.cooldown_expires_at));
  const candidate = {
    payloadSha256: String(row.signature_payload_sha256),
    signingDomain: String(row.signing_domain),
    algorithm: String(row.algorithm),
    keyId: String(row.key_id),
    publicKeySpkiBase64: String(row.public_key_spki_base64),
    signatureBase64: String(row.signature_base64),
  };
  return (
    String(row.signature_payload_outbox_id) === String(row.outbox_id) &&
    candidate.payloadSha256 === String(row.payload_sha256) &&
    String(row.signature_status) === "SIGNED_DRY_RUN" &&
    String(row.signed_by) === String(row.created_by) &&
    signedAt >= createdAt &&
    signedAt >= grantedAt &&
    signedAt < expiresAt &&
    String(row.registry_event_type) === "REGISTERED" &&
    String(row.registry_public_key) === candidate.publicKeySpkiBase64 &&
    Date.parse(iso(row.registry_event_created_at)) <= signedAt &&
    verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature(candidate)
  );
}

function safelyValidSignature(row: BindingRow) {
  try {
    return signatureBindingValid(row);
  } catch {
    return false;
  }
}

function exactReplayMatches(
  row: BindingRow,
  input: {
    payloadOutboxId: string;
    clientSignatureId: string;
    signedBy: string;
  },
) {
  return (
    String(row.client_signature_id) === input.clientSignatureId &&
    String(row.signature_payload_outbox_id) === input.payloadOutboxId &&
    String(row.signed_by) === input.signedBy
  );
}

function publicSignature(row: BindingRow, replayed: boolean) {
  if (!signatureBindingValid(row)) invalid();
  return {
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-signature-v1",
    signatureId: String(row.signature_id),
    clientSignatureId: String(row.client_signature_id),
    payloadOutboxId: String(row.signature_payload_outbox_id),
    payloadSha256: String(row.signature_payload_sha256),
    signingDomain: String(row.signing_domain),
    algorithm: "Ed25519" as const,
    keyId: String(row.key_id),
    publicKeySpkiBase64: String(row.public_key_spki_base64),
    signatureBase64: String(row.signature_base64),
    status: "SIGNED_DRY_RUN" as const,
    signedAt: iso(row.signed_at),
    replayed,
    persistent: true,
    appendOnly: true,
    keyManagement: "EPHEMERAL_PROCESS_TEST_KEY" as const,
    registry: "DATABASE_TEST_REGISTRY" as const,
    registryBound: true,
    registryStatusAtSigning: "ACTIVE" as const,
    independentTrustAnchor: false,
    trustAnchored: false,
    signedByIdentityReturned: false,
    signedMessageContainsArchiveIdentifiers: false,
    signatureVerified: true,
    privateKeyExposed: false,
    delivery: { enabled: false, attempted: false },
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
    JSON.stringify(reasons(row.preview_reasons)) === JSON.stringify(preview.reasons)
  );
}

const signatureBindingSql = sql`SELECT
    signature.id AS signature_id, signature.client_signature_id,
    signature.payload_outbox_id AS signature_payload_outbox_id,
    signature.payload_sha256 AS signature_payload_sha256,
    signature.signing_domain, signature.algorithm, signature.key_id,
    signature.public_key_spki_base64, signature.signature_base64,
    signature.status AS signature_status, signature.signed_by,
    signature.signed_at, registry.public_key_spki_base64 AS registry_public_key,
    registry_event.event_type AS registry_event_type,
    registry_event.created_at AS registry_event_created_at,
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
  FROM shipment_apv_manifest_archive_alert_payload_signatures signature
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

const outboxBindingSql = sql`SELECT
    signature.id AS signature_id, signature.client_signature_id,
    signature.payload_outbox_id AS signature_payload_outbox_id,
    signature.payload_sha256 AS signature_payload_sha256,
    signature.signing_domain, signature.algorithm, signature.key_id,
    signature.public_key_spki_base64, signature.signature_base64,
    signature.status AS signature_status, signature.signed_by,
    signature.signed_at, NULL::text AS registry_public_key,
    NULL::text AS registry_event_type,
    NULL::timestamptz AS registry_event_created_at,
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
  FROM shipment_apv_manifest_archive_alert_payload_outbox outbox
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_cooldown_claims cooldown
    ON cooldown.state_fingerprint = delivery_grant.state_fingerprint
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  LEFT JOIN shipment_apv_manifest_archive_alert_payload_signatures signature
    ON signature.payload_outbox_id = outbox.id`;

export async function createShipmentApvReceiverManifestArchiveAlertPayloadSignature(
  db: Pick<Database, "transaction">,
  input: {
    payloadOutboxId: string;
    clientSignatureId: string;
    signedBy: string;
    signer: ShipmentApvFailureAlertPayloadSigner;
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
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-signature.v1', 0))`);

    const existingRows = await transaction.execute(sql`${signatureBindingSql}
      WHERE signature.client_signature_id = ${input.clientSignatureId}::uuid
      LIMIT 1`);
    const existing = (existingRows as unknown as BindingRow[])[0];
    if (existing) {
      if (!exactReplayMatches(existing, input) || !safelyValidSignature(existing)) {
        throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_REPLAY_CONFLICT");
      }
      return publicSignature(existing, true);
    }

    const bindingRows = await transaction.execute(sql`${outboxBindingSql}
      WHERE outbox.id = ${input.payloadOutboxId}::uuid LIMIT 1`);
    const binding = (bindingRows as unknown as BindingRow[])[0];
    if (!binding) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_OUTBOX_NOT_FOUND");
    }
    if (!safelyValidPayloadBinding(binding)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_INVALID");
    }
    if (String(binding.created_by) !== input.signedBy) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_ACTOR_MISMATCH");
    }
    if (binding.signature_id) {
      if (
        String(binding.client_signature_id) === input.clientSignatureId &&
        String(binding.signed_by) === input.signedBy
      ) {
        throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_INVALID");
      }
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ALREADY_SIGNED");
    }
    const expiresAt = Date.parse(iso(binding.cooldown_expires_at));
    if (
      Date.parse(iso(binding.current_cooldown_expires_at)) !== expiresAt ||
      String(binding.current_cooldown_grant_id) !== String(binding.grant_id) ||
      Date.parse(iso(binding.current_cooldown_claimed_at)) !==
        Date.parse(iso(binding.granted_at)) ||
      now.getTime() >= expiresAt
    ) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_EXPIRED");
    }

    const registryRows = await transaction.execute(sql`SELECT key.key_id,
        key.public_key_spki_base64, key.registered_at,
        event.event_type, event.created_at AS event_created_at
      FROM shipment_apv_failure_alert_signing_keys key
      JOIN LATERAL (
        SELECT key_event.event_type, key_event.created_at, key_event.id
        FROM shipment_apv_failure_alert_signing_key_events key_event
        WHERE key_event.key_id = key.key_id
        ORDER BY key_event.created_at DESC, key_event.id DESC LIMIT 1
      ) event ON true WHERE key.key_id = ${input.signer.keyId} LIMIT 1`);
    const registry = (registryRows as unknown as RegistryRow[])[0];
    if (
      !registry ||
      String(registry.event_type) !== "REGISTERED" ||
      String(registry.public_key_spki_base64) !== input.signer.publicKeySpkiBase64 ||
      Date.parse(iso(registry.registered_at)) > now.getTime() ||
      Date.parse(iso(registry.event_created_at)) > now.getTime()
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

    const payloadSha256 = String(binding.payload_sha256);
    const signatureBase64 = input.signer.signMessage(signingMessage(payloadSha256));
    const candidate = {
      payloadSha256,
      signingDomain: SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN,
      algorithm: "Ed25519",
      keyId: input.signer.keyId,
      publicKeySpkiBase64: input.signer.publicKeySpkiBase64,
      signatureBase64,
    };
    if (!verifyShipmentApvReceiverManifestArchiveAlertPayloadSignature(candidate)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNER_VERIFICATION_FAILED");
    }

    const insertedRows = await transaction.execute(sql`INSERT INTO
        shipment_apv_manifest_archive_alert_payload_signatures
        (client_signature_id, payload_outbox_id, payload_sha256, signing_domain,
          algorithm, key_id, public_key_spki_base64, signature_base64,
          status, signed_by, signed_at)
      VALUES (${input.clientSignatureId}::uuid, ${input.payloadOutboxId}::uuid,
        ${payloadSha256},
        ${SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNING_DOMAIN},
        'Ed25519', ${input.signer.keyId}, ${input.signer.publicKeySpkiBase64},
        ${signatureBase64}, 'SIGNED_DRY_RUN', ${input.signedBy}::uuid,
        ${now.toISOString()}::timestamptz)
      ON CONFLICT DO NOTHING RETURNING id`);
    const inserted = (insertedRows as unknown as unknown[]).length === 1;
    const winnerRows = await transaction.execute(sql`${signatureBindingSql}
      WHERE signature.client_signature_id = ${input.clientSignatureId}::uuid
        OR signature.payload_outbox_id = ${input.payloadOutboxId}::uuid
      LIMIT 1`);
    const winner = (winnerRows as unknown as BindingRow[])[0];
    if (!winner) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_UNAVAILABLE");
    }
    if (!exactReplayMatches(winner, input) || !safelyValidSignature(winner)) {
      if (String(winner.signature_payload_outbox_id) === input.payloadOutboxId) {
        throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_PAYLOAD_ALREADY_SIGNED");
      }
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_SIGNATURE_REPLAY_CONFLICT");
    }
    return publicSignature(winner, !inserted);
  });
}
