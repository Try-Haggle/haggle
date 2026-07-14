import { describe, expect, it } from "vitest";
import {
  classifyShipmentApvAllocation,
  shipmentApvPayloadSha256,
} from "../services/shipment-apv-adjustment.service.js";

const INPUT = {
  provider: "easypost",
  providerInvoiceId: "shinv_001",
  shipmentId: "11111111-1111-4111-8111-111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  settlementReleaseId: "33333333-3333-4333-8333-333333333333",
  originalRateMinor: 625,
  adjustedRateMinor: 800,
  adjustmentMinor: 175,
};

describe("shipment APV allocation", () => {
  it("uses the held seller buffer without changing buyer money", () => {
    expect(classifyShipmentApvAllocation(175, 175)).toEqual({
      status: "APPLIED",
      bufferAppliedMinor: 175,
      sellerLiabilityMinor: 0,
      carrierCreditMinor: 0,
      buyerEffectMinor: 0,
    });
  });

  it("records adjustment beyond the remaining buffer as seller liability", () => {
    expect(classifyShipmentApvAllocation(400, 150)).toEqual({
      status: "REVIEW_REQUIRED",
      bufferAppliedMinor: 150,
      sellerLiabilityMinor: 250,
      carrierCreditMinor: 0,
      buyerEffectMinor: 0,
    });
  });

  it("records a carrier credit without increasing buyer charges", () => {
    expect(classifyShipmentApvAllocation(-100, 0)).toEqual({
      status: "CREDIT_RECORDED",
      bufferAppliedMinor: 0,
      sellerLiabilityMinor: 0,
      carrierCreditMinor: 100,
      buyerEffectMinor: 0,
    });
  });

  it("caps an invalid applied amount at the positive adjustment", () => {
    expect(classifyShipmentApvAllocation(100, 999).bufferAppliedMinor).toBe(100);
  });

  it("hashes every money and ownership field for payload conflict detection", () => {
    const baseline = shipmentApvPayloadSha256(INPUT);
    expect(baseline).toHaveLength(64);
    expect(shipmentApvPayloadSha256({ ...INPUT, adjustedRateMinor: 801 })).not.toBe(baseline);
    expect(
      shipmentApvPayloadSha256({ ...INPUT, shipmentId: "44444444-4444-4444-8444-444444444444" }),
    ).not.toBe(baseline);
  });
});
