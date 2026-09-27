import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FLASH_MODEL,
  DEFAULT_PRO_MODEL,
  getBuilderLlmModel,
  getDecideModelCatalog,
  getDefaultDeepSeekModel,
  getFlashModel,
  getProModel,
  isDecideCatalogModel,
  isFlashModelId,
  isProModelId,
  resolveDecideModel,
  resolveNewSessionAllowedModel,
  stripClientModelEntitlement,
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

  it("legacy pro credit still selects Pro from DEEPSEEK_PRO_MODEL", () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-flash");
    vi.stubEnv("DEEPSEEK_PRO_MODEL", "deepseek-v4-pro-custom");
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

  it("accepts only flash ids", () => {
    expect(isFlashModelId("deepseek-flash")).toBe(true);
    expect(isFlashModelId("  DEEPSEEK-FLASH  ")).toBe(true);
    expect(isFlashModelId("deepseek-v4-flash")).toBe(true);
    expect(isFlashModelId("deepseek-v4-flash-vision-exp")).toBe(true);
    expect(isFlashModelId("deepseek-v4-flash-custom")).toBe(true);
    expect(isFlashModelId("deepseek-flash-custom")).toBe(true);
    expect(isFlashModelId("deepseek-v4-pro")).toBe(false);
    expect(isFlashModelId("deepseek-flash-pro")).toBe(false);
    expect(isFlashModelId("deepseek-v4-flash-pro")).toBe(false);
    expect(isFlashModelId("garbage-model")).toBe(false);
    expect(isFlashModelId("")).toBe(false);
    expect(isFlashModelId("grok-4-fast")).toBe(false);
  });

  it("defaults to deepseek-flash when model env is unset, blank, pro, or unknown", () => {
    vi.stubEnv("DEEPSEEK_MODEL", "");
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "");
    expect(getFlashModel()).toBe("deepseek-flash");
    expect(getDefaultDeepSeekModel()).toBe("deepseek-flash");

    for (const value of ["", "   ", "deepseek-v4-pro", "garbage-model"]) {
      vi.stubEnv("DEEPSEEK_MODEL", value);
      vi.stubEnv("DEEPSEEK_FLASH_MODEL", value);
      expect(getDefaultDeepSeekModel()).toBe("deepseek-flash");
      expect(getFlashModel()).toBe("deepseek-flash");
    }
  });

  it("honors flash ids on DEEPSEEK_MODEL and DEEPSEEK_FLASH_MODEL", () => {
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-flash");
    expect(getDefaultDeepSeekModel()).toBe("deepseek-v4-flash");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-flash");
    expect(getDefaultDeepSeekModel()).toBe("deepseek-flash");
    vi.stubEnv("DEEPSEEK_MODEL", "");
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "deepseek-v4-flash");
    expect(getFlashModel()).toBe("deepseek-v4-flash");
    expect(getDefaultDeepSeekModel()).toBe("deepseek-v4-flash");
  });

  it("reads the explicit Pro id from DEEPSEEK_PRO_MODEL", () => {
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro-custom");
    expect(getProModel()).toBe(DEFAULT_PRO_MODEL);
    expect(isProModelId("deepseek-v4-pro")).toBe(true);
    expect(isProModelId("DEEPSEEK-V4-PRO-custom")).toBe(true);
    expect(isProModelId("deepseek-flash")).toBe(false);
    vi.stubEnv("DEEPSEEK_PRO_MODEL", "custom-pro-id");
    expect(getProModel()).toBe("custom-pro-id");
    expect(isProModelId("custom-pro-id")).toBe(true);
    expect(isProModelId("other")).toBe(false);
  });

  it("resolveNewSessionAllowedModel keeps only a catalog flash id", () => {
    expect(resolveNewSessionAllowedModel("deepseek-v4-pro")).toBe("deepseek-flash");
    expect(resolveNewSessionAllowedModel("deepseek-flash")).toBe("deepseek-flash");
    expect(resolveNewSessionAllowedModel("garbage")).toBe("deepseek-flash");
    expect(resolveNewSessionAllowedModel("")).toBe("deepseek-flash");
    expect(resolveNewSessionAllowedModel(undefined)).toBe("deepseek-flash");
    expect(resolveNewSessionAllowedModel(123)).toBe("deepseek-flash");
    expect(resolveNewSessionAllowedModel("deepseek-v4-flash")).toBe("deepseek-flash");
    vi.stubEnv("DECIDE_EXTRA_MODELS", "grok-4-fast");
    expect(isDecideCatalogModel("grok-4-fast")).toBe(true);
    expect(resolveNewSessionAllowedModel("grok-4-fast")).toBe("deepseek-flash");
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "deepseek-v4-flash");
    expect(resolveNewSessionAllowedModel("deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(resolveNewSessionAllowedModel("deepseek-v4-pro")).toBe("deepseek-v4-flash");
  });

  it("stripClientModelEntitlement removes client entitlement keys", () => {
    expect(
      stripClientModelEntitlement({
        allowed_model: "deepseek-v4-pro",
        pro_model_credit: true,
        alpha: 1,
      }),
    ).toEqual({ alpha: 1 });
  });

  it("builder model is flash unless BUILDER_LLM_MODEL is a flash id", () => {
    vi.stubEnv("BUILDER_LLM_MODEL", "");
    vi.stubEnv("DEEPSEEK_MODEL", "");
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "");
    expect(getBuilderLlmModel()).toBe("deepseek-flash");
    vi.stubEnv("BUILDER_LLM_MODEL", "deepseek-v4-pro");
    expect(getBuilderLlmModel()).toBe("deepseek-flash");
    vi.stubEnv("BUILDER_LLM_MODEL", "garbage");
    expect(getBuilderLlmModel()).toBe("deepseek-flash");
    vi.stubEnv("BUILDER_LLM_MODEL", "deepseek-v4-flash");
    expect(getBuilderLlmModel()).toBe("deepseek-v4-flash");
  });

  it("warns once per rejected env name and does not log the value", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-v4-pro");
    vi.stubEnv("DEEPSEEK_FLASH_MODEL", "garbage-model");
    try {
      const fresh = await import("../decide-model.js");
      expect(fresh.getDefaultDeepSeekModel()).toBe("deepseek-flash");
      expect(fresh.getFlashModel()).toBe("deepseek-flash");
      expect(fresh.getDefaultDeepSeekModel()).toBe("deepseek-flash");
      expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([
        "[model] DEEPSEEK_MODEL is not an allowed Flash model id; falling back to deepseek-flash",
        "[model] DEEPSEEK_FLASH_MODEL is not an allowed Flash model id; falling back to deepseek-flash",
      ]);
      for (const call of warn.mock.calls) {
        expect(String(call[0])).not.toContain("deepseek-v4-pro");
        expect(String(call[0])).not.toContain("garbage-model");
      }
    } finally {
      warn.mockRestore();
    }
  });
});
