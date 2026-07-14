import { describe, expect, it } from "vitest";
import {
  allocatePositiveShipmentApvRevision,
  allocateShipmentApvCarrierCredit,
  isValidShipmentApvRevisionDecision,
} from "../services/shipment-apv-revision-application.service.js";

describe("shipment APV revision application policy", () => {
  it("uses remaining seller buffer before recording seller liability", () => {
    expect(allocatePositiveShipmentApvRevision(250, "UPHELD", 100)).toEqual({
      bufferAppliedMinor: 100,
      sellerLiabilityMinor: 150,
      platformLiabilityMinor: 0,
    });
  });

  it("moves a waived positive delta entirely to platform liability", () => {
    expect(allocatePositiveShipmentApvRevision(100, "WAIVED", 500)).toEqual({
      bufferAppliedMinor: 0,
      sellerLiabilityMinor: 0,
      platformLiabilityMinor: 100,
    });
  });

  it("returns carrier credit to platform, seller liability, then buffer", () => {
    expect(
      allocateShipmentApvCarrierCredit(175, {
        platformLiabilityMinor: 100,
        sellerLiabilityMinor: 50,
        bufferAppliedMinor: 100,
      }),
    ).toEqual({
      platformCreditMinor: 100,
      sellerCreditMinor: 50,
      bufferCreditMinor: 25,
      unallocatedCreditMinor: 0,
    });
  });

  it("requires the decision type that matches the delta direction", () => {
    expect(isValidShipmentApvRevisionDecision(100, "UPHELD")).toBe(true);
    expect(isValidShipmentApvRevisionDecision(100, "APPLY_CREDIT")).toBe(false);
    expect(isValidShipmentApvRevisionDecision(-50, "APPLY_CREDIT")).toBe(true);
    expect(isValidShipmentApvRevisionDecision(0, "ACKNOWLEDGE")).toBe(true);
  });
});
