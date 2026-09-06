import { describe, expect, it } from "vitest";
import {
  extractFulfillmentContext,
  fulfillmentPreferenceSchema,
  fulfillmentTypeForMethod,
  parseSellerFulfillmentOffer,
  readFulfillmentFromSnapshot,
  toFulfillmentContext,
} from "../lib/negotiation-fulfillment.js";

const denver = {
  name: "Alex Buyer",
  street1: "1600 Blake St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
};

describe("fulfillmentPreferenceSchema", () => {
  it("schema allows carrier without address (D1 enforces 409 in start service)", () => {
    const parsed = fulfillmentPreferenceSchema.safeParse({ method: "carrier" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.methods).toEqual(["carrier"]);
      expect(parsed.data.buyer_address).toBeUndefined();
    }
  });

  it("rejects pickup until in-person methods reconnect", () => {
    const parsed = fulfillmentPreferenceSchema.safeParse({ method: "local_pickup" });
    expect(parsed.success).toBe(false);
  });

  it("accepts carrier shipping with a complete address", () => {
    const parsed = fulfillmentPreferenceSchema.safeParse({
      method: "carrier",
      buyer_address: denver,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects in-person methods even when they are the only options", () => {
    const parsed = fulfillmentPreferenceSchema.safeParse({
      methods: ["local_pickup", "porch_drop", "meetup"],
      preferred: "meetup",
      constraints: { travel_radius_miles: 8, max_pickup_weight_lb: 15 },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("parseSellerFulfillmentOffer", () => {
  it("keeps carrier and drops in-person methods from older listings", () => {
    expect(
      parseSellerFulfillmentOffer({
        options: [{ method: "carrier" }, { method: "local_pickup" }],
        preferred: "local_pickup",
      }),
    ).toEqual({
      options: [{ method: "carrier" }],
      preferred: "carrier",
    });
  });
});

describe("toFulfillmentContext", () => {
  it("builds prompt-safe context without destination when address omitted on preference", () => {
    const preference = fulfillmentPreferenceSchema.parse({ method: "carrier" });
    const context = toFulfillmentContext(preference);
    expect(context.fulfillment_type).toBe("physical_shipping");
    expect(context.methods).toEqual(["carrier"]);
    expect(context.destination).toBeUndefined();
  });

  it("keeps street address off the prompt-safe context", () => {
    const preference = fulfillmentPreferenceSchema.parse({
      method: "carrier",
      buyer_address: denver,
    });
    const context = toFulfillmentContext(preference);
    expect(context.fulfillment_type).toBe("physical_shipping");
    expect(context.methods).toEqual(["carrier"]);
    expect(context.destination).toEqual({
      city: "Denver",
      state: "CO",
      zip: "80202",
      country: "US",
    });
    expect(JSON.stringify(context)).not.toContain("Blake");
    expect(context.shipping_cost_known).toBe(false);
  });

  it("records buyer carrier priority and seller parcel on the prompt-safe context", () => {
    const preference = fulfillmentPreferenceSchema.parse({
      methods: ["carrier"],
      preferred: "carrier",
      buyer_address: denver,
      carrier_priority: "fastest",
      parcel: { weight_oz: 20, length_in: 12, width_in: 9, height_in: 6 },
    });
    const context = toFulfillmentContext(preference);
    expect(context.carrier_priority).toBe("fastest");
    expect(context.parcel).toEqual({
      weight_oz: 20,
      length_in: 12,
      width_in: 9,
      height_in: 6,
    });
    expect(context.rate_note).toContain("fastest");
  });

  it("rejects the legacy buyer_arranged alias while pickup is off", () => {
    expect(fulfillmentPreferenceSchema.safeParse({ method: "buyer_arranged" }).success).toBe(false);
  });
});

describe("readFulfillmentFromSnapshot", () => {
  it("defaults to physical shipping when the session has no preference", () => {
    expect(readFulfillmentFromSnapshot({}).fulfillment_type).toBe("physical_shipping");
    expect(fulfillmentTypeForMethod("local_pickup")).toBe("local_pickup");
  });

  it("reads the stored method and full address from a snapshot", () => {
    const preference = fulfillmentPreferenceSchema.parse({
      method: "carrier",
      buyer_address: denver,
    });
    const context = toFulfillmentContext(preference);
    const read = readFulfillmentFromSnapshot({
      fulfillment_context: context,
      buyer_shipping_address: denver,
    });
    expect(read.fulfillment_type).toBe("physical_shipping");
    expect(read.buyer_shipping_address?.street1).toBe("1600 Blake St");
    expect(extractFulfillmentContext({ fulfillment_context: context })?.method).toBe("carrier");
  });
});
