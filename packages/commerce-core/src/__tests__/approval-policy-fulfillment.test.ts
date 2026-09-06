import { describe, expect, it } from "vitest";
import {
  isNoShippingFulfillment,
  normalizeFulfillmentType,
  requiresShipmentForFulfillment,
} from "../approval-policy.js";

describe("fulfillment type helpers (A4 Phase1)", () => {
  it("normalizes missing and legacy shipped to physical_shipping", () => {
    expect(normalizeFulfillmentType(undefined)).toBe("physical_shipping");
    expect(normalizeFulfillmentType(null)).toBe("physical_shipping");
    expect(normalizeFulfillmentType("shipped")).toBe("physical_shipping");
    expect(normalizeFulfillmentType("physical_shipping")).toBe("physical_shipping");
  });

  it("preserves no-shipping fulfillment types", () => {
    expect(normalizeFulfillmentType("digital_delivery")).toBe("digital_delivery");
    expect(normalizeFulfillmentType("local_pickup")).toBe("local_pickup");
    expect(normalizeFulfillmentType("onchain_transfer")).toBe("onchain_transfer");
    expect(normalizeFulfillmentType("external_platform_transfer")).toBe(
      "external_platform_transfer",
    );
  });

  it("requires shipment only for physical_shipping (including legacy shipped)", () => {
    expect(requiresShipmentForFulfillment("physical_shipping")).toBe(true);
    expect(requiresShipmentForFulfillment("shipped")).toBe(true);
    expect(requiresShipmentForFulfillment("digital_delivery")).toBe(false);
    expect(requiresShipmentForFulfillment("local_pickup")).toBe(false);
    expect(isNoShippingFulfillment("digital_delivery")).toBe(true);
    expect(isNoShippingFulfillment("physical_shipping")).toBe(false);
  });
});
