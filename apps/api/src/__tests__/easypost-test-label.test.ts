import { afterEach, describe, expect, it, vi } from "vitest";
import { createEasyPostTestLabelOneStep } from "../shipping/easypost-test-label.js";
import {
  assertStagingEasyPostTestLabelKeysAllowed,
  classifyEasyPostKeyMode,
  isStagingLiveEasyPostKeysForbidden,
  resolveEasyPostTestLabelCandidateKey,
  STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN,
} from "../shipping/shipping-execution-mode.js";

describe("classifyEasyPostKeyMode", () => {
  it("detects test keys (EZTK and EZTEST)", () => {
    expect(classifyEasyPostKeyMode("EZTK_dogfood")).toBe("test");
    expect(classifyEasyPostKeyMode("EZTEST_legacy")).toBe("test");
  });

  it("detects live keys", () => {
    expect(classifyEasyPostKeyMode("EZAK_production")).toBe("live");
  });

  it("returns missing when empty", () => {
    expect(classifyEasyPostKeyMode("")).toBe("missing");
    expect(classifyEasyPostKeyMode(undefined)).toBe("missing");
  });

  it("returns unknown for other prefixes", () => {
    expect(classifyEasyPostKeyMode("not_an_easypost_key")).toBe("unknown");
  });
});

describe("resolveEasyPostTestLabelCandidateKey", () => {
  it("prefers EASYPOST_TEST_API_KEY and never reads LIVE", () => {
    expect(
      resolveEasyPostTestLabelCandidateKey({
        EASYPOST_TEST_API_KEY: "EZTK_test",
        EASYPOST_LIVE_API_KEY: "EZAK_live",
        EASYPOST_API_KEY: "EZTK_legacy",
      }),
    ).toBe("EZTK_test");

    expect(
      resolveEasyPostTestLabelCandidateKey({
        EASYPOST_LIVE_API_KEY: "EZAK_live_only",
      }),
    ).toBeNull();
  });

  it("falls back to legacy EASYPOST_API_KEY", () => {
    expect(
      resolveEasyPostTestLabelCandidateKey({
        EASYPOST_API_KEY: "EZTK_legacy_only",
      }),
    ).toBe("EZTK_legacy_only");
  });
});

describe("staging live EasyPost key hard gate", () => {
  it("forbids live keys when HAGGLE_ENV=staging", () => {
    expect(isStagingLiveEasyPostKeysForbidden({ HAGGLE_ENV: "staging" }, "live")).toBe(true);
    expect(() =>
      assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: "staging" }, "live"),
    ).toThrowError(/STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN/);
    try {
      assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: "staging" }, "live");
      expect.unreachable("expected assertStagingEasyPostTestLabelKeysAllowed to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN,
        statusCode: 503,
      });
    }
  });

  it("allows test keys on staging", () => {
    expect(isStagingLiveEasyPostKeysForbidden({ HAGGLE_ENV: "staging" }, "test")).toBe(false);
    expect(() =>
      assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: "staging" }, "test"),
    ).not.toThrow();
  });

  it("allows missing keys on staging (mock fallback)", () => {
    expect(isStagingLiveEasyPostKeysForbidden({ HAGGLE_ENV: "staging" }, "missing")).toBe(false);
    expect(() =>
      assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: "staging" }, "missing"),
    ).not.toThrow();
  });

  it("allows live keys outside staging (production gate is separate)", () => {
    expect(isStagingLiveEasyPostKeysForbidden({ HAGGLE_ENV: "production" }, "live")).toBe(false);
    expect(() =>
      assertStagingEasyPostTestLabelKeysAllowed({ HAGGLE_ENV: "production" }, "live"),
    ).not.toThrow();
  });
});

describe("createEasyPostTestLabelOneStep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a clear mock label artifact when no EasyPost test key is configured", async () => {
    const result = await createEasyPostTestLabelOneStep({
      env: { HAGGLE_ENV: "staging" },
      shipment_id: "shp_mock_one_step",
    });

    expect(result).toMatchObject({
      source: "mock",
      label_environment: "mock",
      money_charged: false,
      one_step: true,
      key_mode: "missing",
    });
    expect(result.tracking_number.length).toBeGreaterThan(0);
    expect(result.label_url).toMatch(/^https?:\/\//);
    expect(result.metadata.easypost_test_label_one_step).toBe(true);
    expect(result.metadata.money_charged).toBe(false);
  });

  it("uses the test-key path and never charges money", async () => {
    const purchaseLabel = vi.fn().mockResolvedValue({
      tracking_number: "EZ1000000001",
      tracking_url: "https://easypost.test/track/EZ1000000001",
      label_url: "https://easypost.test/labels/test.pdf",
      label_qr_code_url: "https://easypost.test/labels/test-qr.png",
      carrier_raw_status: "pre_transit",
      rate_minor: 550,
      service: "GroundAdvantage",
      metadata: { easypost_carrier: "USPS", easypost_shipment_id: "shp_test_1" },
    });

    const result = await createEasyPostTestLabelOneStep({
      env: {
        HAGGLE_ENV: "staging",
        EASYPOST_TEST_API_KEY: "EZTK_test_only",
        EASYPOST_LIVE_API_KEY: "EZAK_must_not_be_used",
      },
      shipment_id: "shp_test_one_step",
      purchaseLabel,
    });

    expect(purchaseLabel).toHaveBeenCalledTimes(1);
    expect(purchaseLabel.mock.calls[0]?.[0]).toMatchObject({
      apiKey: "EZTK_test_only",
      keyMode: "test",
    });
    expect(result).toMatchObject({
      source: "easypost_test",
      label_environment: "test",
      money_charged: false,
      one_step: true,
      key_mode: "test",
      tracking_number: "EZ1000000001",
      label_url: "https://easypost.test/labels/test.pdf",
      carrier: "USPS",
      service: "GroundAdvantage",
      rate_minor: 550,
    });
  });

  it("fail-closes on staging before purchasing when the candidate key is live", async () => {
    const purchaseLabel = vi.fn();

    await expect(
      createEasyPostTestLabelOneStep({
        env: {
          HAGGLE_ENV: "staging",
          EASYPOST_TEST_API_KEY: "EZAK_live_misconfigured",
        },
        purchaseLabel,
      }),
    ).rejects.toMatchObject({ code: STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN });

    expect(purchaseLabel).not.toHaveBeenCalled();
  });

  it("fail-closes when a live key would be used even if HAGGLE_ENV is not staging", async () => {
    const purchaseLabel = vi.fn();

    await expect(
      createEasyPostTestLabelOneStep({
        env: {
          HAGGLE_ENV: "production",
          EASYPOST_API_KEY: "EZAK_live_only",
        },
        purchaseLabel,
      }),
    ).rejects.toMatchObject({ code: STAGING_LIVE_EASYPOST_KEYS_FORBIDDEN });

    expect(purchaseLabel).not.toHaveBeenCalled();
  });

  it("falls back to mock for unknown key prefixes without calling EasyPost", async () => {
    const purchaseLabel = vi.fn().mockResolvedValue({
      tracking_number: "MOCK-UNKNOWN",
      label_url: "https://mock-labels.haggle.test/MOCK-UNKNOWN.pdf",
      carrier_raw_status: "label_created",
      rate_minor: 550,
      service: "GroundAdvantage",
    });

    const result = await createEasyPostTestLabelOneStep({
      env: {
        HAGGLE_ENV: "staging",
        EASYPOST_TEST_API_KEY: "weird_prefix_key",
      },
      purchaseLabel,
    });

    expect(purchaseLabel).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: null, keyMode: "unknown" }),
    );
    expect(result.source).toBe("mock");
    expect(result.money_charged).toBe(false);
  });
});
