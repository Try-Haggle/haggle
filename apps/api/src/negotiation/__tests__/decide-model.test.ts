import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FLASH_MODEL,
  DEFAULT_PRO_MODEL,
  getDecideModelCatalog,
  getFlashModel,
  getProAskThresholdMinor,
  getProModel,
  isDecideCatalogModel,
  resolveDecideModel,
} from "../decide-model.js";

describe("resolveDecideModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Pro when the published ask is at or above the threshold", () => {
    expect(resolveDecideModel({ publishedAskMinor: 10_000 }).reason).toBe(
      "ask_at_or_above_threshold",
    );
    expect(resolveDecideModel({ publishedAskMinor: 10_000 }).model).toBe(DEFAULT_PRO_MODEL);
    expect(resolveDecideModel({ publishedAskMinor: 90_000 }).model).toBe(DEFAULT_PRO_MODEL);
  });

  it("uses Flash when the published ask is below the threshold", () => {
    const route = resolveDecideModel({ publishedAskMinor: 4_500 });
    expect(route.model).toBe(DEFAULT_FLASH_MODEL);
    expect(route.reason).toBe("ask_below_threshold");
    expect(route.askMinor).toBe(4_500);
    expect(route.thresholdMinor).toBe(10_000);
  });

  it("uses a server-allowed catalog id on a cheap ask", () => {
    const route = resolveDecideModel({
      publishedAskMinor: 4_500,
      allowedModelId: DEFAULT_PRO_MODEL,
    });
    expect(route.model).toBe(DEFAULT_PRO_MODEL);
    expect(route.reason).toBe("allowed_model");
  });

  it("ignores an allowed id that is not in the catalog", () => {
    const route = resolveDecideModel({
      publishedAskMinor: 4_500,
      allowedModelId: "mystery-model",
    });
    expect(route.model).toBe(DEFAULT_FLASH_MODEL);
    expect(route.reason).toBe("ask_below_threshold");
  });

  it("lists Flash and Pro in the catalog and accepts extras from env", () => {
    expect(getDecideModelCatalog()).toEqual(
      expect.arrayContaining([DEFAULT_FLASH_MODEL, DEFAULT_PRO_MODEL]),
    );
    expect(isDecideCatalogModel(DEFAULT_FLASH_MODEL)).toBe(true);
    vi.stubEnv("DECIDE_EXTRA_MODELS", "grok-4-fast");
    expect(isDecideCatalogModel("grok-4-fast")).toBe(true);
  });

  it("uses Pro on a cheap ask when pro credit is on", () => {
    const route = resolveDecideModel({ publishedAskMinor: 4_500, proCredit: true });
    expect(route.model).toBe(DEFAULT_PRO_MODEL);
    expect(route.reason).toBe("pro_credit");
  });

  it("defaults to Pro when the ask is missing so an iPhone is not Flashed", () => {
    const route = resolveDecideModel({});
    expect(route.model).toBe(DEFAULT_PRO_MODEL);
    expect(route.reason).toBe("ask_unknown");
  });

  it("does not treat a buyer target as the ask", () => {
    const route = resolveDecideModel({
      publishedAskMinor: 90_000,
      sellerAskMinor: 7_000,
    });
    expect(route.model).toBe(DEFAULT_PRO_MODEL);
    expect(route.reason).toBe("ask_at_or_above_threshold");
    expect(route.askMinor).toBe(90_000);
  });

  it("falls back to the seller ask only when the listing ask is missing", () => {
    const route = resolveDecideModel({ sellerAskMinor: 4_500 });
    expect(route.model).toBe(DEFAULT_FLASH_MODEL);
    expect(route.reason).toBe("ask_below_threshold");
  });

  it("reads model ids and the threshold from env", () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro-custom");
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "deepseek-v4-flash-custom");
    vi.stubEnv("DEEPSEEK_PRO_ASK_THRESHOLD_USD", "40");
    expect(getProModel()).toBe("deepseek-v4-pro-custom");
    expect(getFlashModel()).toBe("deepseek-v4-flash-custom");
    expect(getProAskThresholdMinor()).toBe(4_000);
    expect(resolveDecideModel({ publishedAskMinor: 3_999 }).model).toBe("deepseek-v4-flash-custom");
    expect(resolveDecideModel({ publishedAskMinor: 4_000 }).model).toBe("deepseek-v4-pro-custom");
  });
});
