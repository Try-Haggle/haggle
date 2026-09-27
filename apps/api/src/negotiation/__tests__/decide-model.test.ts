import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FLASH_MODEL,
  DEFAULT_PRO_MODEL,
  getDecideModelCatalog,
  getFlashModel,
  getProModel,
  isDecideCatalogModel,
  resolveDecideModel,
} from "../decide-model.js";

describe("resolveDecideModel", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("routes $50 and $300 asks to Flash", () => {
    expect(DEFAULT_FLASH_MODEL).toBe("deepseek-flash");
    for (const publishedAskMinor of [5_000, 30_000]) {
      const route = resolveDecideModel({ publishedAskMinor });
      expect(route.model).toBe("deepseek-flash");
      expect(route.reason).toBe("flash_default");
      expect(route.askMinor).toBe(publishedAskMinor);
    }
  });

  it("routes an unknown ask to Flash", () => {
    const route = resolveDecideModel({});
    expect(route.model).toBe("deepseek-flash");
    expect(route.reason).toBe("flash_default");
    expect(route.askMinor).toBeUndefined();
  });

  it("ignores DEEPSEEK_PRO_ASK_THRESHOLD_USD", () => {
    vi.stubEnv("DEEPSEEK_PRO_ASK_THRESHOLD_USD", "40");
    expect(resolveDecideModel({ publishedAskMinor: 3_999 }).model).toBe("deepseek-flash");
    expect(resolveDecideModel({ publishedAskMinor: 4_000 }).model).toBe("deepseek-flash");
    expect(resolveDecideModel({ publishedAskMinor: 30_000 }).reason).toBe("flash_default");
  });

  it("honors DEEPSEEK_FLASH_MODEL", () => {
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "deepseek-v4-flash-custom");
    vi.stubEnv("DEEPSEEK_PRO_ASK_THRESHOLD_USD", "40");
    expect(getFlashModel()).toBe("deepseek-v4-flash-custom");
    expect(resolveDecideModel({ publishedAskMinor: 5_000 }).model).toBe("deepseek-v4-flash-custom");
    expect(resolveDecideModel({ publishedAskMinor: 30_000 }).model).toBe(
      "deepseek-v4-flash-custom",
    );
    expect(resolveDecideModel({}).reason).toBe("flash_default");
  });

  it("honors a server-allowed Pro catalog id", () => {
    const route = resolveDecideModel({
      publishedAskMinor: 5_000,
      allowedModelId: DEFAULT_PRO_MODEL,
    });
    expect(route.model).toBe("deepseek-v4-pro");
    expect(route.reason).toBe("allowed_model");
    expect(route.askMinor).toBe(5_000);
  });

  it("ignores an allowed id that is not in the catalog", () => {
    const route = resolveDecideModel({
      publishedAskMinor: 30_000,
      allowedModelId: "mystery-model",
    });
    expect(route.model).toBe(DEFAULT_FLASH_MODEL);
    expect(route.reason).toBe("flash_default");
  });

  it("lists Flash and Pro in the catalog and accepts extras from env", () => {
    expect(getDecideModelCatalog()).toEqual(
      expect.arrayContaining([DEFAULT_FLASH_MODEL, DEFAULT_PRO_MODEL]),
    );
    expect(isDecideCatalogModel(DEFAULT_FLASH_MODEL)).toBe(true);
    expect(isDecideCatalogModel(DEFAULT_PRO_MODEL)).toBe(true);
    vi.stubEnv("DECIDE_EXTRA_MODELS", "grok-4-fast");
    expect(isDecideCatalogModel("grok-4-fast")).toBe(true);
  });

  it("legacy pro credit still selects Pro", () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro-custom");
    const route = resolveDecideModel({ publishedAskMinor: 5_000, proCredit: true });
    expect(getProModel()).toBe("deepseek-v4-pro-custom");
    expect(route.model).toBe("deepseek-v4-pro-custom");
    expect(route.reason).toBe("pro_credit");
  });

  it("does not treat a buyer target as the ask", () => {
    const route = resolveDecideModel({
      publishedAskMinor: 90_000,
      sellerAskMinor: 7_000,
    });
    expect(route.model).toBe("deepseek-flash");
    expect(route.reason).toBe("flash_default");
    expect(route.askMinor).toBe(90_000);
  });

  it("records the seller ask only when the listing ask is missing", () => {
    const route = resolveDecideModel({ sellerAskMinor: 4_500 });
    expect(route.model).toBe("deepseek-flash");
    expect(route.reason).toBe("flash_default");
    expect(route.askMinor).toBe(4_500);
  });
});
