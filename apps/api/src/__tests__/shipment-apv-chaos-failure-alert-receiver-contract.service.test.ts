import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { createShipmentApvFailureAlertTestSigner } from
  "../services/shipment-apv-chaos-failure-alert-signature.service.js";
import { verifyShipmentApvFailureAlertReceiverContract } from
  "../services/shipment-apv-chaos-failure-alert-receiver-contract.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T18:00:00.000Z");
const intentId = "11111111-1111-4111-8111-111111111111";
const signatureId = "22222222-2222-4222-8222-222222222222";
const outboxId = "33333333-3333-4333-8333-333333333333";
const canonicalPayload = JSON.stringify({
  action: "review_warning",
  event_type: "shipment_apv_failure_alert",
  reasons: ["rollback_verification_warning"],
  schema_version: "shipment-apv-failure-alert-payload-v1",
  severity: "warning",
  state_fingerprint: "f".repeat(64),
});
const payloadSha256 = createHash("sha256").update(canonicalPayload).digest("hex");
const signer = createShipmentApvFailureAlertTestSigner();
const signatureBase64 = signer.signMessage(Buffer.from(
  `haggle.shipment-apv-failure-alert.payload-sha256.v1:${payloadSha256}`, "utf8"));

function row(overrides: Record<string, unknown> = {}) {
  return { delivery_intent_id: intentId, payload_signature_id: signatureId,
    payload_outbox_id: outboxId, payload_sha256: payloadSha256,
    canonical_payload: canonicalPayload,
    signing_domain: "haggle.shipment-apv-failure-alert.payload-sha256.v1",
    algorithm: "Ed25519", key_id: signer.keyId,
    signature_public_key: signer.publicKeySpkiBase64, signature_base64: signatureBase64,
    signed_at: "2026-07-13T17:58:00.000Z",
    intent_status: "BLOCKED_CONFIGURATION_DRY_RUN",
    http_request_created: false, delivery_attempted: false,
    registry_public_key: signer.publicKeySpkiBase64,
    key_event_type: "REGISTERED", ...overrides };
}

function database(value: unknown[]) {
  return { execute: vi.fn().mockResolvedValue(value) } as unknown as Pick<Database, "execute">;
}

describe("shipment APV local receiver contract", () => {
  it("verifies the local no-network receiver envelope", async () => {
    await expect(verifyShipmentApvFailureAlertReceiverContract(database([row()]),
      { deliveryIntentId: intentId, now })).resolves.toMatchObject({
      status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN", payloadContractVerified: true,
      payloadHashVerified: true,
      signatureVerified: true, keyBindingVerified: true, freshnessVerified: true,
      independentTrustAnchor: false, networkReceived: false, productionAccepted: false,
      persistent: false, replayProtection: { enabled: false, persistent: false },
      delivery: { enabled: false, attempted: false },
    });
  });

  it("rejects a canonical payload hash mismatch", async () => {
    await expect(verifyShipmentApvFailureAlertReceiverContract(database([
      row({ canonical_payload: `${canonicalPayload} ` }),
    ]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });

  it("rejects a signed hash whose payload violates the receiver schema", async () => {
    const invalidPayload = JSON.stringify({ schema_version: "unknown" });
    const invalidHash = createHash("sha256").update(invalidPayload).digest("hex");
    const invalidSignature = signer.signMessage(Buffer.from(
      `haggle.shipment-apv-failure-alert.payload-sha256.v1:${invalidHash}`, "utf8"));
    await expect(verifyShipmentApvFailureAlertReceiverContract(database([row({
      canonical_payload: invalidPayload, payload_sha256: invalidHash,
      signature_base64: invalidSignature,
    })]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });

  it("rejects an invalid Ed25519 signature", async () => {
    await expect(verifyShipmentApvFailureAlertReceiverContract(database([
      row({ signature_base64: Buffer.alloc(64).toString("base64") }),
    ]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });

  it("rejects stale and future signatures", async () => {
    for (const signedAt of ["2026-07-13T17:54:59.999Z", "2026-07-13T18:00:05.001Z"]) {
      await expect(verifyShipmentApvFailureAlertReceiverContract(database([
        row({ signed_at: signedAt }),
      ]), { deliveryIntentId: intentId, now }))
        .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects a non-current or rebound registry key", async () => {
    for (const change of [{ key_event_type: "RETIRED" },
      { registry_public_key: Buffer.alloc(44).toString("base64") }]) {
      await expect(verifyShipmentApvFailureAlertReceiverContract(database([row(change)]),
        { deliveryIntentId: intentId, now }))
        .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
    }
  });

  it("rejects a missing intent and any intent that claims an HTTP side effect", async () => {
    await expect(verifyShipmentApvFailureAlertReceiverContract(database([]),
      { deliveryIntentId: intentId, now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_NOT_FOUND");
    await expect(verifyShipmentApvFailureAlertReceiverContract(database([
      row({ http_request_created: true }),
    ]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });
});
