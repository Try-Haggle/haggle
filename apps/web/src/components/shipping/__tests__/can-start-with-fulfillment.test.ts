/**
 * D1: physical (carrier) listing CTA requires delivery address.
 * Digital / non-carrier paths stay exempt (A4 no-shipment).
 * Eng2: saved address defaults to in-use; legacy pending still blocks start.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SELLER_OFFER } from "@/lib/fulfillment-options";
import { EMPTY_SHIPPING_ADDRESS as EMPTY_ADDR } from "@/lib/shipping-address";
import {
  canStartWithFulfillment,
  emptyFulfillmentValue,
  type PreNegotiationFulfillmentValue,
} from "../pre-negotiation-fulfillment-state";

const COMPLETE_ADDR = {
  name: "Alex Buyer",
  street1: "1600 Blake St",
  street2: "",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
  phone: "",
};

function carrierNoAddress(): PreNegotiationFulfillmentValue {
  return {
    ...emptyFulfillmentValue(DEFAULT_SELLER_OFFER, false),
    methods: ["carrier"],
    preferred: "carrier",
    address: EMPTY_ADDR,
  };
}

function carrierWithAddress(): PreNegotiationFulfillmentValue {
  return {
    ...carrierNoAddress(),
    addressSource: "new",
    address: COMPLETE_ADDR,
  };
}

describe("canStartWithFulfillment (D1 physical address gate)", () => {
  it("blocks start when carrier is selected but address is empty", () => {
    expect(canStartWithFulfillment(carrierNoAddress())).toBe(false);
  });

  it("allows start when carrier is selected with a complete address", () => {
    expect(canStartWithFulfillment(carrierWithAddress())).toBe(true);
  });

  it("allows start for default empty fulfillment only after address is filled", () => {
    const value = emptyFulfillmentValue(DEFAULT_SELLER_OFFER, false);
    expect(value.methods).toContain("carrier");
    expect(value.address.name).toBe("");
    expect(canStartWithFulfillment(value)).toBe(false);
  });

  it("blocks start when no fulfillment method is selected", () => {
    const value: PreNegotiationFulfillmentValue = {
      ...carrierNoAddress(),
      methods: [],
      preferred: undefined,
    };
    expect(canStartWithFulfillment(value)).toBe(false);
  });

  it("allows start without address when carrier is not selected (digital/local exempt)", () => {
    const value: PreNegotiationFulfillmentValue = {
      ...carrierNoAddress(),
      methods: ["local_pickup"],
      preferred: "local_pickup",
      address: EMPTY_ADDR,
    };
    expect(canStartWithFulfillment(value)).toBe(true);
  });

  it("blocks start while legacy pending gate is set (even if address filled)", () => {
    const value: PreNegotiationFulfillmentValue = {
      ...carrierWithAddress(),
      addressSource: "pending",
      address: COMPLETE_ADDR,
    };
    expect(canStartWithFulfillment(value)).toBe(false);
  });

  it("allows start when saved address is used by default", () => {
    const value: PreNegotiationFulfillmentValue = {
      ...carrierWithAddress(),
      addressSource: "default",
      address: COMPLETE_ADDR,
    };
    expect(canStartWithFulfillment(value)).toBe(true);
  });

  it("blocks start when default source has empty address", () => {
    const value: PreNegotiationFulfillmentValue = {
      ...carrierNoAddress(),
      addressSource: "default",
      address: EMPTY_ADDR,
    };
    expect(canStartWithFulfillment(value)).toBe(false);
  });
});
