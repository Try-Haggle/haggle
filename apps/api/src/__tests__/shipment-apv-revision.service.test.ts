import { describe, expect, it } from "vitest";
import { isValidShipmentApvRevisionAmount } from "../services/shipment-apv-revision.service.js";

describe("shipment APV invoice revision amount invariant", () => {
  it("accepts a provider amount whose adjustment equals adjusted minus original", () => {
    expect(
      isValidShipmentApvRevisionAmount({
        originalRateMinor: 625,
        adjustedRateMinor: 1125,
        adjustmentMinor: 500,
      }),
    ).toBe(true);
  });

  it("rejects inconsistent, negative, fractional, and unsafe provider amounts", () => {
    expect(
      isValidShipmentApvRevisionAmount({
        originalRateMinor: 625,
        adjustedRateMinor: 1125,
        adjustmentMinor: 499,
      }),
    ).toBe(false);
    expect(
      isValidShipmentApvRevisionAmount({
        originalRateMinor: -1,
        adjustedRateMinor: 1125,
        adjustmentMinor: 1126,
      }),
    ).toBe(false);
    expect(
      isValidShipmentApvRevisionAmount({
        originalRateMinor: 625,
        adjustedRateMinor: 1125.5,
        adjustmentMinor: 500.5,
      }),
    ).toBe(false);
    expect(
      isValidShipmentApvRevisionAmount({
        originalRateMinor: 625,
        adjustedRateMinor: Number.MAX_SAFE_INTEGER,
        adjustmentMinor: Number.MAX_SAFE_INTEGER - 625,
      }),
    ).toBe(false);
  });
});
