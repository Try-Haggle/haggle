import { afterEach, describe, expect, it } from "vitest";
import {
  defaultShippingExecutionMode,
  easyPostApiKeyForMode,
  integrationShippingReadiness,
  metadataForShippingExecutionMode,
  physicalShippingReadiness,
  readShippingExecutionMode,
  stagingLiveLabelCostLimit,
  stagingLiveLabelMaxMinor,
} from "../shipping/shipping-execution-mode.js";

const KEYS = [
  "NODE_ENV",
  "HAGGLE_ENV",
  "HAGGLE_X402_NETWORK",
  "HAGGLE_SETTLEMENT_ASSET_PROFILE",
  "HAGGLE_ENABLE_STAGING_LIVE_SHIPPING",
  "HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR",
  "EASYPOST_API_KEY",
  "EASYPOST_TEST_API_KEY",
  "EASYPOST_LIVE_API_KEY",
  "EASYPOST_WEBHOOK_SECRET",
  "EASYPOST_LIVE_WEBHOOK_SECRET",
] as const;

const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("shipping execution modes", () => {
  it("defaults staging to integration and production to physical shipping", () => {
    process.env.HAGGLE_ENV = "staging";
    process.env.NODE_ENV = "production";
    expect(defaultShippingExecutionMode()).toBe("integration_manual");

    delete process.env.HAGGLE_ENV;
    expect(defaultShippingExecutionMode()).toBe("physical_live");
  });

  it("keeps test and live EasyPost credentials separated", () => {
    process.env.EASYPOST_TEST_API_KEY = "EZTK_test_only";
    process.env.EASYPOST_LIVE_API_KEY = "EZAK_live_only";

    expect(easyPostApiKeyForMode("integration_manual")).toBe("EZTK_test_only");
    expect(easyPostApiKeyForMode("physical_live")).toBe("EZAK_live_only");

    process.env.EASYPOST_LIVE_API_KEY = "EZTK_wrong_environment";
    expect(easyPostApiKeyForMode("physical_live")).toBeNull();

    process.env.EASYPOST_LIVE_API_KEY = "not_an_easypost_key";
    expect(easyPostApiKeyForMode("physical_live")).toBeNull();
  });

  it("requires hUSDC staging, explicit opt-in, live key, and webhook for physical shipping", () => {
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE = "base-sepolia-husdc";
    process.env.HAGGLE_ENABLE_STAGING_LIVE_SHIPPING = "true";
    process.env.EASYPOST_LIVE_API_KEY = "EZAK_live_only";
    process.env.EASYPOST_LIVE_WEBHOOK_SECRET = "whsec_live";

    expect(physicalShippingReadiness()).toMatchObject({
      ready: true,
      live_label_max_minor: 5_000,
      live_label_funding_source: "haggle_staging_fiat_subsidy",
      missing: [],
    });

    delete process.env.EASYPOST_LIVE_WEBHOOK_SECRET;
    expect(physicalShippingReadiness()).toMatchObject({
      ready: false,
      live_webhook_configured: false,
    });
  });

  it("bounds the staging live-label charge limit", () => {
    delete process.env.HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR;
    expect(stagingLiveLabelMaxMinor()).toBe(5_000);

    process.env.HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR = "1250";
    expect(stagingLiveLabelMaxMinor()).toBe(1_250);

    process.env.HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR = "999999";
    expect(stagingLiveLabelMaxMinor()).toBe(50_000);

    process.env.HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR = "not-a-number";
    expect(stagingLiveLabelMaxMinor()).toBe(5_000);
  });

  it("blocks only staging physical-label charges above the configured limit", () => {
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_STAGING_LIVE_LABEL_MAX_MINOR = "1250";

    expect(stagingLiveLabelCostLimit("physical_live", 1_250)).toBeNull();
    expect(stagingLiveLabelCostLimit("physical_live", 1_251)).toEqual({
      rateMinor: 1_251,
      maxRateMinor: 1_250,
    });
    expect(stagingLiveLabelCostLimit("integration_manual", 99_999)).toBeNull();

    process.env.HAGGLE_ENV = "production";
    expect(stagingLiveLabelCostLimit("physical_live", 99_999)).toBeNull();
  });

  it("reports the missing integration prerequisites without exposing secrets", () => {
    process.env.HAGGLE_ENV = "staging";
    process.env.HAGGLE_X402_NETWORK = "base-sepolia";
    process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE = "base-sepolia-husdc";
    delete process.env.EASYPOST_API_KEY;
    delete process.env.EASYPOST_TEST_API_KEY;

    expect(integrationShippingReadiness()).toMatchObject({
      ready: false,
      missing: ["EASYPOST_TEST_API_KEY"],
    });
  });

  it("stores the mode and provider environment in shipment metadata", () => {
    const metadata = metadataForShippingExecutionMode("physical_live", { existing: true });

    expect(metadata).toMatchObject({
      existing: true,
      shipping_execution_mode: "physical_live",
      shipping_provider_environment: "live",
    });
    expect(readShippingExecutionMode(metadata)).toBe("physical_live");
  });
});
