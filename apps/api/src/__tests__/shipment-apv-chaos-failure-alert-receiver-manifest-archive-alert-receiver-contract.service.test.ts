import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { createShipmentApvFailureAlertTestSigner } from
  "../services/shipment-apv-chaos-failure-alert-signature.service.js";
import {
  verifyShipmentApvReceiverManifestArchiveAlertReceiverContract,
} from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-contract.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T18:00:00.000Z");
const intentId = "11111111-1111-4111-8111-111111111111";
const signatureId = "22222222-2222-4222-8222-222222222222";
const outboxId = "33333333-3333-4333-8333-333333333333";
const grantId = "44444444-4444-4444-8444-444444444444";
const decisionId = "55555555-5555-4555-8555-555555555555";
const requestId = "66666666-6666-4666-8666-666666666666";
const makerId = "77777777-7777-4777-8777-777777777777";
const checkerId = "88888888-8888-4888-8888-888888888888";
const signer = createShipmentApvFailureAlertTestSigner();
const signingDomain =
  "haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1";
const canonicalPayload = JSON.stringify({
  action: "review_warning",
  event_type: "shipment_apv_failure_alert_receiver_manifest_archive_alert",
  reasons: ["current_archive_intent_missing"],
  schema_version:
    "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1",
  severity: "warning",
  state_fingerprint: "f".repeat(64),
});

function signedPayload(value: string) {
  const hash = createHash("sha256").update(value).digest("hex");
  return { hash, signature: signer.signMessage(Buffer.from(
    `${signingDomain}:${hash}`, "utf8")) };
}

const validSignature = signedPayload(canonicalPayload);

function row(overrides: Record<string, unknown> = {}) {
  return {
    delivery_intent_id: intentId,
    intent_payload_signature_id: signatureId,
    intent_payload_outbox_id: outboxId,
    intent_payload_sha256: validSignature.hash,
    intent_key_id: signer.keyId,
    intent_status: "BLOCKED_CONFIGURATION_DRY_RUN",
    blocking_reasons: ["independent_trust_anchor_missing",
      "receiver_endpoint_missing", "receiver_credential_missing"],
    http_request_created: false,
    delivery_attempted: false,
    intent_requested_by: checkerId,
    intent_created_at: "2026-07-13T17:59:00.000Z",
    signature_id: signatureId,
    signature_payload_outbox_id: outboxId,
    signature_payload_sha256: validSignature.hash,
    signing_domain: signingDomain,
    algorithm: "Ed25519",
    signature_key_id: signer.keyId,
    signature_public_key: signer.publicKeySpkiBase64,
    signature_base64: validSignature.signature,
    signature_status: "SIGNED_DRY_RUN",
    signature_signed_by: checkerId,
    signed_at: "2026-07-13T17:58:00.000Z",
    outbox_id: outboxId,
    outbox_delivery_grant_id: grantId,
    outbox_state_fingerprint: "f".repeat(64),
    canonical_payload: canonicalPayload,
    outbox_payload_sha256: validSignature.hash,
    outbox_status: "UNSIGNED_DRY_RUN",
    outbox_created_by: checkerId,
    outbox_created_at: "2026-07-13T17:57:30.000Z",
    grant_id: grantId,
    grant_approval_decision_id: decisionId,
    grant_status: "GRANTED_DRY_RUN",
    granted_by: checkerId,
    granted_at: "2026-07-13T17:57:00.000Z",
    cooldown_expires_at: "2026-07-13T18:12:00.000Z",
    cooldown_grant_id: grantId,
    cooldown_claimed_at: "2026-07-13T17:57:00.000Z",
    cooldown_claim_expires_at: "2026-07-13T18:12:00.000Z",
    decision_id: decisionId,
    decision_approval_request_id: requestId,
    decision: "APPROVED",
    decision_reason: "checker_approved_snapshot",
    decided_by: checkerId,
    decided_at: "2026-07-13T17:56:00.000Z",
    request_id: requestId,
    requested_by: makerId,
    request_state_fingerprint: "f".repeat(64),
    request_created_at: "2026-07-13T17:55:00.000Z",
    request_expires_at: "2026-07-13T18:10:00.000Z",
    preview_schema_version:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
    preview_action: "review_warning",
    preview_severity: "warning",
    preview_reasons: ["current_archive_intent_missing"],
    registry_public_key: signer.publicKeySpkiBase64,
    key_event_type: "REGISTERED",
    key_event_created_at: "2026-07-13T17:54:00.000Z",
    ...overrides,
  };
}

function database(value: unknown[]) {
  const execute = vi.fn().mockResolvedValue(value);
  return { execute } as unknown as Pick<Database, "execute">;
}

describe("shipment APV archive alert local receiver contract", () => {
  it("verifies the archive-specific local no-network receiver envelope", async () => {
    const result = await verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
      database([row()]), { deliveryIntentId: intentId, now });
    expect(result).toMatchObject({
      status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN",
      payloadContractVerified: true, payloadHashVerified: true,
      signatureVerified: true, keyBindingVerified: true,
      freshnessVerified: true, intentBindingVerified: true,
      independentTrustAnchor: false, actorIdentityReturned: false,
      signatureValueReturned: false, publicKeyReturned: false,
      networkReceived: false, externalReceiptVerified: false,
      productionAccepted: false, persistent: false,
      replayProtection: { enabled: false, persistent: false },
      delivery: { enabled: false, attempted: false },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /signatureBase64|publicKeySpkiBase64|actorEmail|actor@/);
  });

  it("rejects a canonical payload hash mismatch", async () => {
    await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
      database([row({ canonical_payload: `${canonicalPayload} ` })]),
      { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });

  it("rejects correctly signed payloads with invalid archive semantics or order", async () => {
    const invalidPayloads = [
      JSON.stringify({ schema_version: "unknown" }),
      JSON.stringify({
        action: "review_warning",
        event_type:
          "shipment_apv_failure_alert_receiver_manifest_archive_alert",
        reasons: ["archive_intent_binding_violation"],
        schema_version:
          "shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1",
        severity: "warning", state_fingerprint: "f".repeat(64),
      }),
      `{"event_type":"shipment_apv_failure_alert_receiver_manifest_archive_alert","action":"review_warning","reasons":["current_archive_intent_missing"],"schema_version":"shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1","severity":"warning","state_fingerprint":"${"f".repeat(64)}"}`,
    ];
    for (const invalidPayload of invalidPayloads) {
      const signed = signedPayload(invalidPayload);
      await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
        database([row({ canonical_payload: invalidPayload,
          intent_payload_sha256: signed.hash,
          signature_payload_sha256: signed.hash,
          outbox_payload_sha256: signed.hash,
          signature_base64: signed.signature })]),
        { deliveryIntentId: intentId, now }))
        .rejects.toThrow(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects an invalid signature, signing domain, or algorithm", async () => {
    for (const change of [
      { signature_base64: Buffer.alloc(64).toString("base64") },
      { signing_domain: "haggle.shipment-apv-failure-alert.payload-sha256.v1" },
      { algorithm: "RSA" },
    ]) {
      await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
        database([row(change)]), { deliveryIntentId: intentId, now }))
        .rejects.toThrow(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects stale and future signatures or delivery intents", async () => {
    for (const change of [
      { signed_at: "2026-07-13T17:54:59.999Z" },
      { signed_at: "2026-07-13T18:00:05.001Z" },
      { intent_created_at: "2026-07-13T17:54:59.999Z" },
      { intent_created_at: "2026-07-13T18:00:05.001Z" },
    ]) {
      await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
        database([row(change)]), { deliveryIntentId: intentId, now }))
        .rejects.toThrow(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects a non-current or rebound registry key", async () => {
    for (const change of [{ key_event_type: "RETIRED" },
      { registry_public_key: Buffer.alloc(44).toString("base64") },
      { intent_key_id: "a".repeat(24) }]) {
      await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
        database([row(change)]), { deliveryIntentId: intentId, now }))
        .rejects.toThrow(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects malformed intent, signature, outbox, and grant bindings", async () => {
    for (const change of [
      { intent_status: "DELIVERED" },
      { blocking_reasons: ["receiver_endpoint_missing"] },
      { http_request_created: true },
      { delivery_attempted: true },
      { signature_status: "UNSIGNED_DRY_RUN" },
      { outbox_status: "SIGNED" },
      { grant_status: "REVOKED" },
      { decision: "REJECTED" },
      { decision_reason: "checker_rejected_snapshot" },
      { requested_by: checkerId },
      { outbox_created_by: makerId },
      { request_state_fingerprint: "e".repeat(64) },
      { preview_reasons: ["archive_intent_stale"] },
      { cooldown_grant_id: "99999999-9999-4999-8999-999999999999" },
      { key_event_created_at: "2026-07-13T17:58:00.001Z" },
      { intent_payload_signature_id: "44444444-4444-4444-8444-444444444444" },
      { cooldown_expires_at: "2026-07-13T17:59:30.000Z" },
    ]) {
      await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
        database([row(change)]), { deliveryIntentId: intentId, now }))
        .rejects.toThrow(
          "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects a missing delivery intent", async () => {
    await expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(
      database([]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_NOT_FOUND");
  });
});
