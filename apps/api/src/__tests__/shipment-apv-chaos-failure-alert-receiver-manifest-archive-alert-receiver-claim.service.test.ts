import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { verifyShipmentApvReceiverManifestArchiveAlertReceiverContract } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-contract.service.js";
import { createShipmentApvReceiverManifestArchiveAlertReceiverClaim } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-claim.service.js";

vi.unmock("@haggle/db");
vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-contract.service.js", () => ({
  verifyShipmentApvReceiverManifestArchiveAlertReceiverContract:
    vi.fn().mockResolvedValue({ status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN" }),
}));

const intentId = "11111111-1111-4111-8111-111111111111";
const signatureId = "22222222-2222-4222-8222-222222222222";
const outboxId = "33333333-3333-4333-8333-333333333333";
const payloadSha256 = "c".repeat(64);
const keyId = "a".repeat(24);
const now = new Date("2026-07-14T04:30:00.000Z");
const deliveryDomain =
  "haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.receiver-delivery.v1";
const expectedDeliveryId = createHash("sha256")
  .update(`${deliveryDomain}:${intentId}:${payloadSha256}`, "utf8").digest("hex");

const binding = { delivery_intent_id: intentId,
  payload_signature_id: signatureId, payload_outbox_id: outboxId,
  payload_sha256: payloadSha256, key_id: keyId };

function claim(overrides: Record<string, unknown> = {}) {
  return { id: "44444444-4444-4444-8444-444444444444",
    delivery_id: expectedDeliveryId, delivery_intent_id: intentId,
    payload_signature_id: signatureId, payload_outbox_id: outboxId,
    payload_sha256: payloadSha256, key_id: keyId,
    status: "VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN",
    network_received: false, external_receipt_verified: false,
    production_accepted: false, delivery_attempted: false,
    received_at: now.toISOString(), inserted: true,
    expected_payload_signature_id: signatureId,
    expected_payload_outbox_id: outboxId,
    expected_payload_sha256: payloadSha256, expected_key_id: keyId,
    ...overrides };
}

function database(...results: unknown[][]) {
  const execute = vi.fn().mockImplementation(() =>
    Promise.resolve(results.shift() ?? []));
  return { execute } as unknown as Pick<Database, "execute">;
}

describe("shipment APV archive alert local receiver claims", () => {
  it("stores one persistent replay-protected no-network claim", async () => {
    const db = database([], [binding], [claim()]);
    const result =
      await createShipmentApvReceiverManifestArchiveAlertReceiverClaim(db,
        { deliveryIntentId: intentId, now });
    expect(result).toMatchObject({
      status: "VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN",
      replayed: false, persistent: true, appendOnly: true,
      receiverContractVerified: true,
      replayProtection: { enabled: true, persistent: true },
      independentTrustAnchor: false, actorIdentityReturned: false,
      signatureValueReturned: false, publicKeyReturned: false,
      networkReceived: false, externalReceiptVerified: false,
      productionAccepted: false, delivery: { enabled: false, attempted: false },
    });
    expect(result.deliveryId).toBe(expectedDeliveryId);
    expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract)
      .toHaveBeenCalledWith(db, { deliveryIntentId: intentId, now });
    expect(JSON.stringify(result)).not.toMatch(
      /credential|authorization|signatureBase64|publicKeySpkiBase64|actorEmail/);
  });

  it("returns an exact historical claim before live key verification", async () => {
    vi.mocked(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract)
      .mockClear();
    const result =
      await createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
        database([claim({ inserted: false })]),
        { deliveryIntentId: intentId, now });
    expect(result.replayed).toBe(true);
    expect(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract)
      .not.toHaveBeenCalled();
  });

  it("rejects a malformed historical claim instead of replaying it", async () => {
    await expect(
      createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
        database([claim({ expected_payload_sha256: "d".repeat(64),
          inserted: false })]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_CONFLICT");
  });

  it("fails closed when receiver contract verification fails", async () => {
    vi.mocked(verifyShipmentApvReceiverManifestArchiveAlertReceiverContract)
      .mockRejectedValueOnce(new Error(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED"));
    await expect(
      createShipmentApvReceiverManifestArchiveAlertReceiverClaim(database([]),
        { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });

  it("rejects a missing intent binding after verification", async () => {
    await expect(
      createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
        database([], []), { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_NOT_FOUND");
  });

  it("rejects a concurrent claim collision", async () => {
    await expect(
      createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
        database([], [binding], [claim({ payload_sha256: "d".repeat(64),
          inserted: false })]), { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_CONFLICT");
  });

  it("reloads an exact concurrent winner outside the insert snapshot", async () => {
    await expect(
      createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
        database([], [binding], [], [claim({ inserted: false })]),
        { deliveryIntentId: intentId, now }))
      .resolves.toMatchObject({ replayed: true,
        deliveryId: expectedDeliveryId });
  });

  it("fails closed when a concurrent winner cannot be reloaded", async () => {
    await expect(
      createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
        database([], [binding], [], []),
        { deliveryIntentId: intentId, now }))
      .rejects.toThrow(
        "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_UNAVAILABLE");
  });
});
