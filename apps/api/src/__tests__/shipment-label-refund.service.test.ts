import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import {
  claimShipmentLabelRefund,
  completeShipmentLabelRefund,
  failShipmentLabelRefund,
  normalizeProviderLabelRefundStatus,
  syncSubmittedShipmentLabelRefund,
} from "../services/shipment-record.service.js";

function fakeDb(...results: unknown[]) {
  return {
    execute: vi.fn().mockImplementation(async () => results.shift() ?? []),
  } as unknown as Database;
}

describe("shipment label refund claims", () => {
  it("normalizes only documented EasyPost refund states", () => {
    expect(normalizeProviderLabelRefundStatus("submitted")).toBe("SUBMITTED");
    expect(normalizeProviderLabelRefundStatus("refunded")).toBe("REFUNDED");
    expect(normalizeProviderLabelRefundStatus("rejected")).toBe("REJECTED");
    expect(normalizeProviderLabelRefundStatus("not_applicable")).toBe("NOT_APPLICABLE");
    expect(normalizeProviderLabelRefundStatus("unknown")).toBeNull();
  });

  it("acquires an atomic refund lease", async () => {
    await expect(
      claimShipmentLabelRefund(
        fakeDb([
          {
            claimId: "11111111-1111-4111-8111-111111111111",
            attemptCount: "2",
          },
        ]),
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toMatchObject({
      outcome: "acquired",
      attemptCount: 2,
    });
  });

  it.each([
    ["REQUESTING", "in_progress"],
    ["SUBMITTED", "already_submitted"],
    ["REFUNDED", "already_refunded"],
    ["NOT_APPLICABLE", "not_applicable"],
  ] as const)("maps existing %s state to %s", async (refundStatus, outcome) => {
    await expect(
      claimShipmentLabelRefund(
        fakeDb([], [{ status: "LABEL_CREATED", refundStatus }]),
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toMatchObject({ outcome });
  });

  it("rejects refund claims after shipment leaves LABEL_CREATED", async () => {
    await expect(
      claimShipmentLabelRefund(
        fakeDb([], [{ status: "IN_TRANSIT", refundStatus: "NONE" }]),
        "22222222-2222-4222-8222-222222222222",
      ),
    ).resolves.toMatchObject({ outcome: "invalid_status" });
  });

  it("completes only through the active claim token", async () => {
    const claim = {
      outcome: "acquired" as const,
      shipmentId: "22222222-2222-4222-8222-222222222222",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    };
    await expect(
      completeShipmentLabelRefund(
        fakeDb([{ id: claim.shipmentId }]),
        claim,
        "REFUNDED",
        "shp_test",
      ),
    ).resolves.toBe(true);
    await expect(
      completeShipmentLabelRefund(fakeDb([]), claim, "SUBMITTED", "shp_test"),
    ).resolves.toBe(false);
  });

  it("marks failed claims retryable and synchronizes submitted provider status", async () => {
    const claim = {
      outcome: "acquired" as const,
      shipmentId: "22222222-2222-4222-8222-222222222222",
      claimId: "11111111-1111-4111-8111-111111111111",
      attemptCount: 1,
    };
    const failureDb = fakeDb([]);
    await expect(failShipmentLabelRefund(failureDb, claim)).resolves.toBeUndefined();
    expect(
      (failureDb as unknown as { execute: ReturnType<typeof vi.fn> }).execute,
    ).toHaveBeenCalledOnce();
    await expect(
      syncSubmittedShipmentLabelRefund(
        fakeDb([{ id: claim.shipmentId }]),
        claim.shipmentId,
        "REFUNDED",
        "shp_test",
      ),
    ).resolves.toBe(true);
  });
});
