import { describe, expect, it, vi } from "vitest";
import { fulfillmentPreferenceSchema } from "../lib/negotiation-fulfillment.js";
import { STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN } from "../shipping/shipping-execution-mode.js";
import {
  quoteShippingBeforeStart,
  SHIPPING_QUOTE_ADDRESS_REQUIRED,
  SHIPPING_QUOTE_INCOMPLETE,
  ShippingQuoteBeforeStartError,
  selectRateByCarrierPriority,
  startRequiresShippingQuote,
} from "../shipping/shipping-quote-before-start.js";

const denver = {
  name: "Alex Buyer",
  street1: "1600 Blake St",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
};

describe("startRequiresShippingQuote", () => {
  it("requires quote for physical carrier fulfillment", () => {
    const fulfillment = fulfillmentPreferenceSchema.parse({
      methods: ["carrier"],
      preferred: "carrier",
      buyer_address: denver,
    });
    expect(
      startRequiresShippingQuote({
        listingSnapshot: { fulfillment_type: "physical_shipping" },
        fulfillment,
      }),
    ).toBe(true);
  });

  it("skips quote for digital / A4 no-shipment listings", () => {
    const fulfillment = fulfillmentPreferenceSchema.parse({
      methods: ["carrier"],
      preferred: "carrier",
      buyer_address: denver,
    });
    expect(
      startRequiresShippingQuote({
        listingSnapshot: { fulfillment_type: "digital_delivery" },
        fulfillment,
      }),
    ).toBe(false);
  });

  it("skips when fulfillment is omitted (D1 owns bare address requirement)", () => {
    expect(
      startRequiresShippingQuote({
        listingSnapshot: { fulfillment_type: "physical_shipping" },
      }),
    ).toBe(false);
  });
});

describe("selectRateByCarrierPriority", () => {
  const rates = [
    {
      carrier: "USPS",
      service: "GroundAdvantage",
      rate: "5.50",
      rate_minor: 550,
      est_delivery_days: 5,
    },
    {
      carrier: "USPS",
      service: "Priority",
      rate: "8.25",
      rate_minor: 825,
      est_delivery_days: 3,
    },
    {
      carrier: "USPS",
      service: "Express",
      rate: "26.35",
      rate_minor: 2635,
      est_delivery_days: 1,
    },
  ];

  it("picks cheapest / fastest / balanced Priority", () => {
    expect(selectRateByCarrierPriority(rates, "cheapest")?.rate_minor).toBe(550);
    expect(selectRateByCarrierPriority(rates, "fastest")?.rate_minor).toBe(2635);
    expect(selectRateByCarrierPriority(rates, "balanced")?.service).toBe("Priority");
  });
});

describe("quoteShippingBeforeStart", () => {
  it("returns mock quote without purchasing a label when no EasyPost test key", async () => {
    const result = await quoteShippingBeforeStart({
      to_address: denver,
      carrier_priority: "balanced",
      env: { HAGGLE_ENV: "staging" },
    });

    expect(result).toMatchObject({
      source: "mock",
      money_charged: false,
      label_purchased: false,
      carrier_priority: "balanced",
      service: "Priority",
      rate_minor: 825,
    });
    expect(result.rates.length).toBeGreaterThan(0);
  });

  it("uses injectable test-key rates without buying a label", async () => {
    const fetchRates = vi.fn().mockResolvedValue([
      {
        carrier: "USPS",
        service: "GroundAdvantage",
        rate: "5.50",
        rate_minor: 550,
        est_delivery_days: 5,
      },
      {
        carrier: "USPS",
        service: "Priority",
        rate: "8.25",
        rate_minor: 825,
        est_delivery_days: 3,
      },
    ]);

    const result = await quoteShippingBeforeStart({
      to_address: denver,
      carrier_priority: "cheapest",
      env: {
        HAGGLE_ENV: "staging",
        EASYPOST_TEST_API_KEY: "EZTK_test_only",
        EASYPOST_LIVE_API_KEY: "EZAK_must_not_be_used",
      },
      fetchRates,
    });

    expect(fetchRates).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: "easypost_test",
      key_mode: "test",
      money_charged: false,
      label_purchased: false,
      rate_minor: 550,
    });
  });

  it("fail-closes on live EZAK keys without quoting", async () => {
    const fetchRates = vi.fn();
    await expect(
      quoteShippingBeforeStart({
        to_address: denver,
        env: {
          HAGGLE_ENV: "staging",
          EASYPOST_TEST_API_KEY: "EZAK_live_misconfigured",
        },
        fetchRates,
      }),
    ).rejects.toMatchObject({ code: STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN });
    expect(fetchRates).not.toHaveBeenCalled();
  });

  it("rejects incomplete empty rate lists", async () => {
    await expect(
      quoteShippingBeforeStart({
        to_address: denver,
        env: { HAGGLE_ENV: "staging", EASYPOST_TEST_API_KEY: "EZTK_test" },
        fetchRates: async () => [],
      }),
    ).rejects.toMatchObject({ code: SHIPPING_QUOTE_INCOMPLETE });
  });
});

describe("ShippingQuoteBeforeStartError codes", () => {
  it("exposes address-required distinct from D1 DELIVERY_ADDRESS_REQUIRED", () => {
    const error = new ShippingQuoteBeforeStartError(
      SHIPPING_QUOTE_ADDRESS_REQUIRED,
      "need address for quote",
    );
    expect(error.code).toBe("SHIPPING_QUOTE_ADDRESS_REQUIRED");
    expect(error.code).not.toBe("DELIVERY_ADDRESS_REQUIRED");
  });
});
