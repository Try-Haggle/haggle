import { describe, expect, it } from "vitest";
import {
  DELIVERY_ADDRESS_REQUIRED,
  deliveryAddressRequiredReject,
  isDigitalNoShipmentListing,
  isPhysicalDeliveryAddressRequired,
} from "../lib/delivery-address-start-gate.js";
import { fulfillmentPreferenceSchema } from "../lib/negotiation-fulfillment.js";

const denver = {
  name: "Alex Buyer",
  street1: "1600 Blake St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
};

describe("delivery-address-start-gate (D1)", () => {
  it("detects digital via listing fulfillment_type (A4 no-shipment)", () => {
    expect(isDigitalNoShipmentListing({ fulfillment_type: "digital_delivery" })).toBe(true);
    expect(isDigitalNoShipmentListing({ fulfillment_type: "local_pickup" })).toBe(true);
    expect(isDigitalNoShipmentListing({ fulfillment_type: "physical_shipping" })).toBe(false);
    expect(isDigitalNoShipmentListing({})).toBe(false);
    expect(isDigitalNoShipmentListing(null)).toBe(false);
  });

  it("requires address only for carrier / physical starts", () => {
    const carrier = fulfillmentPreferenceSchema.parse({ method: "carrier" });
    expect(isPhysicalDeliveryAddressRequired(carrier)).toBe(true);
    expect(isPhysicalDeliveryAddressRequired(undefined)).toBe(false);
    expect(
      isPhysicalDeliveryAddressRequired(carrier, { fulfillment_type: "digital_delivery" }),
    ).toBe(false);
  });

  it("rejects missing address on physical with DELIVERY_ADDRESS_REQUIRED", () => {
    const carrier = fulfillmentPreferenceSchema.parse({ method: "carrier" });
    const reject = deliveryAddressRequiredReject({ fulfillment: carrier });
    expect(reject?.error).toBe(DELIVERY_ADDRESS_REQUIRED);
    expect(reject?.message).toContain("delivery address");
    const withAddr = fulfillmentPreferenceSchema.parse({
      method: "carrier",
      buyer_address: denver,
    });
    expect(deliveryAddressRequiredReject({ fulfillment: withAddr })).toBeNull();
  });
});
