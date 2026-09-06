/**
 * A3 dogfood gap: listing CTA must not wait on delivery address.
 * Address is checkout/shipping stage — start/resume proceeds without it.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_SELLER_OFFER } from "@/lib/fulfillment-options";
import { EMPTY_SHIPPING_ADDRESS as EMPTY_ADDR } from "@/lib/shipping-address";
import {
  canStartWithFulfillment,
  emptyFulfillmentValue,
  type PreNegotiationFulfillmentValue,
} from "../pre-negotiation-fulfillment-state";

function carrierNoAddress(): PreNegotiationFulfillmentValue {
  return {
    ...emptyFulfillmentValue(DEFAULT_SELLER_OFFER, false),
    methods: ["carrier"],
    preferred: "carrier",
    address: EMPTY_ADDR,
  };
}

describe("canStartWithFulfillment (listing start, no address block)", () => {
  it("allows start when carrier is selected but address is empty", () => {
    expect(canStartWithFulfillment(carrierNoAddress())).toBe(true);
  });

  it("allows start for default empty fulfillment (carrier, blank address)", () => {
    const value = emptyFulfillmentValue(DEFAULT_SELLER_OFFER, false);
    expect(value.methods).toContain("carrier");
    expect(value.address.name).toBe("");
    expect(canStartWithFulfillment(value)).toBe(true);
  });

  it("blocks start only when no fulfillment method is selected", () => {
    const value: PreNegotiationFulfillmentValue = {
      ...carrierNoAddress(),
      methods: [],
      preferred: undefined,
    };
    expect(canStartWithFulfillment(value)).toBe(false);
  });
});
