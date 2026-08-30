import { afterEach, describe, expect, it, vi } from "vitest";
import {
  estimateLlmCostUsd,
  formatLlmSpend,
  isDeepSeekPeakUtc,
  recordLlmSpend,
  resetLlmSpendMeter,
  resolveLlmModelPricing,
  snapshotLlmSpendMeter,
} from "../lib/llm-cost.js";

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

  it("prices DeepSeek V4 Pro with cache hits cheaper than misses", () => {
    const offPeak = new Date("2026-08-26T20:00:00.000Z");
    const miss = estimateLlmCostUsd(
      "deepseek-v4-pro",
      { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
      offPeak,
    );
    const hit = estimateLlmCostUsd(
      "deepseek-v4-pro",
      {
        promptTokens: 1_000_000,
        completionTokens: 0,
        totalTokens: 1_000_000,
        cacheHitTokens: 1_000_000,
        cacheMissTokens: 0,
      },
      offPeak,
    );
    expect(miss?.totalUsd).toBeCloseTo(0.66);
    expect(hit?.totalUsd).toBeCloseTo(0.022);
    expect(isDeepSeekPeakUtc(new Date("2026-08-27T03:00:00.000Z"))).toBe(true);
    expect(isDeepSeekPeakUtc(offPeak)).toBe(false);
  });

  it("prices DeepSeek V4 Flash at one third of Pro", () => {
    const offPeak = new Date("2026-08-26T20:00:00.000Z");
    const flash = estimateLlmCostUsd(
      "deepseek-v4-flash",
      { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
      offPeak,
    );
    const pro = estimateLlmCostUsd(
      "deepseek-v4-pro",
      { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 },
      offPeak,
    );
    expect(flash?.totalUsd).toBeCloseTo(0.22);
    expect(pro?.totalUsd).toBeCloseTo(0.66);
    expect(flash?.totalUsd).toBeCloseTo((pro?.totalUsd ?? 0) / 3);
  });

  it("accumulates a process-local spend meter", () => {
    resetLlmSpendMeter();
    recordLlmSpend(
      "deepseek-v4-pro",
      {
        promptTokens: 4000,
        completionTokens: 1000,
        totalTokens: 5000,
        cacheHitTokens: 3000,
        cacheMissTokens: 1000,
      },
      new Date("2026-08-26T20:00:00.000Z"),
    );
    const snap = snapshotLlmSpendMeter();
    expect(snap.calls).toBe(1);
    expect(snap.promptTokens).toBe(4000);
    expect(snap.usd).toBeGreaterThan(0);
    expect(formatLlmSpend(snap)).toContain("tokens=5000");
    expect(formatLlmSpend(snap)).toContain("cache 75%");
    resetLlmSpendMeter();
    expect(snapshotLlmSpendMeter().calls).toBe(0);
  });
});
