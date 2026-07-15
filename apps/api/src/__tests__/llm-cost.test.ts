import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateLlmCostUsd, resolveLlmModelPricing } from "../lib/llm-cost.js";

describe("llm-cost", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("estimates Grok 4.3 cost from token usage", () => {
    expect(
      estimateLlmCostUsd("grok-4.3", {
        promptTokens: 1_000_000,
        completionTokens: 1_000_000,
        totalTokens: 2_000_000,
      }),
    ).toMatchObject({
      model: "grok-4.3",
      pricing: {
        inputUsdPer1MTokens: 1.25,
        outputUsdPer1MTokens: 2.5,
      },
      inputUsd: 1.25,
      outputUsd: 2.5,
      totalUsd: 3.75,
      costMinorUsd: 375,
    });
  });

  it("supports per-model pricing overrides from env", () => {
    vi.stubEnv("LLM_PRICE_GROK_4_3_INPUT_PER_1M_USD", "9");
    vi.stubEnv("LLM_PRICE_GROK_4_3_OUTPUT_PER_1M_USD", "12");

    expect(resolveLlmModelPricing("grok-4.3")).toEqual({
      inputUsdPer1MTokens: 9,
      outputUsdPer1MTokens: 12,
    });
  });

  it("falls back to global pricing overrides for unknown models", () => {
    vi.stubEnv("LLM_PRICE_INPUT_PER_1M_USD", "1");
    vi.stubEnv("LLM_PRICE_OUTPUT_PER_1M_USD", "2");

    expect(
      estimateLlmCostUsd("custom-model", {
        promptTokens: 500_000,
        completionTokens: 250_000,
        totalTokens: 750_000,
      }),
    ).toMatchObject({
      inputUsd: 0.5,
      outputUsd: 0.5,
      totalUsd: 1,
      costMinorUsd: 100,
    });
  });

  it("returns null when pricing or usage is unavailable", () => {
    expect(
      estimateLlmCostUsd("unknown-model", {
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
      }),
    ).toBeNull();
    expect(estimateLlmCostUsd("grok-4.3", undefined)).toBeNull();
  });
});
