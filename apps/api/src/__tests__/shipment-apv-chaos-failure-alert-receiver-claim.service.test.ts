import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { verifyShipmentApvFailureAlertReceiverContract } from
  "../services/shipment-apv-chaos-failure-alert-receiver-contract.service.js";
import { createShipmentApvFailureAlertReceiverClaim } from
  "../services/shipment-apv-chaos-failure-alert-receiver-claim.service.js";

vi.unmock("@haggle/db");
vi.mock("../services/shipment-apv-chaos-failure-alert-receiver-contract.service.js", () => ({
  verifyShipmentApvFailureAlertReceiverContract: vi.fn().mockResolvedValue({
    status: "VERIFIED_LOCAL_FIXTURE_DRY_RUN",
  }),
}));

const intentId = "11111111-1111-4111-8111-111111111111";
const signatureId = "22222222-2222-4222-8222-222222222222";
const payloadSha256 = "c".repeat(64);
const keyId = "a".repeat(24);
const expectedDeliveryId = "a6a5b02388adfcf631b8ae4e8e0332b6d22ac66084bc778db344c078208f23ac";

const binding = { delivery_intent_id: intentId, payload_signature_id: signatureId,
  payload_sha256: payloadSha256, key_id: keyId };
function claim(overrides: Record<string, unknown> = {}) {
  return { id: "33333333-3333-4333-8333-333333333333",
    delivery_id: expectedDeliveryId, delivery_intent_id: intentId,
    payload_signature_id: signatureId, payload_sha256: payloadSha256, key_id: keyId,
    status: "VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN", network_received: false,
    production_accepted: false, received_at: "2026-07-13T18:00:00.000Z",
    inserted: true, ...overrides };
}
function database(...results: unknown[][]) {
  const execute = vi.fn().mockImplementation(() => Promise.resolve(results.shift() ?? []));
  return { execute } as unknown as Pick<Database, "execute">;
}

describe("shipment APV local receiver claims", () => {
  it("stores one persistent replay-protected dry-run claim", async () => {
    const db = database([], [binding], [claim()]);
    await expect(createShipmentApvFailureAlertReceiverClaim(db,
      { deliveryIntentId: intentId })).resolves.toMatchObject({
      status: "VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN", replayed: false,
      persistent: true, receiverContractVerified: true,
      replayProtection: { enabled: true, persistent: true },
      independentTrustAnchor: false, networkReceived: false,
      productionAccepted: false, delivery: { enabled: false, attempted: false },
    });
    expect(verifyShipmentApvFailureAlertReceiverContract).toHaveBeenCalledWith(db,
      { deliveryIntentId: intentId });
  });

  it("returns an exact existing claim before live verification", async () => {
    vi.mocked(verifyShipmentApvFailureAlertReceiverContract).mockClear();
    const result = await createShipmentApvFailureAlertReceiverClaim(
      database([claim({ inserted: false })]), { deliveryIntentId: intentId });
    expect(result.replayed).toBe(true);
    expect(verifyShipmentApvFailureAlertReceiverContract).not.toHaveBeenCalled();
  });

  it("fails closed when receiver contract verification fails", async () => {
    vi.mocked(verifyShipmentApvFailureAlertReceiverContract).mockRejectedValueOnce(
      new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED"));
    await expect(createShipmentApvFailureAlertReceiverClaim(database([]),
      { deliveryIntentId: intentId })).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CONTRACT_REJECTED");
  });

  it("rejects an unavailable binding after verification", async () => {
    await expect(createShipmentApvFailureAlertReceiverClaim(database([], []),
      { deliveryIntentId: intentId })).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_NOT_FOUND");
  });

  it("rejects a delivery id or payload collision returned by a concurrent insert", async () => {
    await expect(createShipmentApvFailureAlertReceiverClaim(database([], [binding], [
      claim({ payload_sha256: "d".repeat(64), inserted: false }),
    ]), { deliveryIntentId: intentId })).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_CONFLICT");
  });

  it("reloads an exact concurrent winner outside the insert statement snapshot", async () => {
    await expect(createShipmentApvFailureAlertReceiverClaim(database([], [binding], [], [
      claim({ inserted: false }),
    ]), { deliveryIntentId: intentId })).resolves.toMatchObject({
      replayed: true, deliveryId: expectedDeliveryId,
    });
  });

  it("fails closed when a concurrent winner cannot be reloaded", async () => {
    await expect(createShipmentApvFailureAlertReceiverClaim(database([], [binding], [], []),
      { deliveryIntentId: intentId })).rejects.toThrow(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_UNAVAILABLE");
  });
});
