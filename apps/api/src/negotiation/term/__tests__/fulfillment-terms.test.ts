import { describe, expect, it } from "vitest";
import { buildFulfillmentActiveTerms, summarizeFulfillmentTerms } from "../fulfillment-terms.js";

describe("buildFulfillmentActiveTerms", () => {
  it("returns no terms when fulfillment and parcel are missing", () => {
    expect(buildFulfillmentActiveTerms()).toEqual([]);
  });

  it("locks shipping cost into the all-in total and keeps several methods unresolved", () => {
    const terms = buildFulfillmentActiveTerms({
      methods: ["carrier", "local_pickup"],
      method: "carrier",
      carrier_priority: "cheapest",
      parcel: { weight_oz: 16, length_in: 10, width_in: 8, height_in: 4 },
    });

    expect(terms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          term_id: "shipping_method",
          status: "unresolved",
          value: "carrier,local_pickup",
        }),
        expect.objectContaining({
          term_id: "shipping_cost_split",
          status: "agreed",
          value: "included_in_total",
        }),
        expect.objectContaining({
          term_id: "carrier_service_priority",
          value: "cheapest",
          proposed_by: "buyer",
        }),
        expect.objectContaining({
          term_id: "parcel_weight_oz",
          value: 16,
          proposed_by: "seller",
        }),
        expect.objectContaining({
          term_id: "parcel_dims",
          value: "10x8x4in",
        }),
      ]),
    );
    expect(summarizeFulfillmentTerms(terms)).toContain("택배 우선순위=cheapest");
  });
});
