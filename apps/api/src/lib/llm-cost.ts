import type { LLMTelemetryUsage } from "./llm-telemetry.js";

export interface LlmModelPricing {
  inputUsdPer1MTokens: number;
  outputUsdPer1MTokens: number;
}

export interface LlmCostEstimate {
  model: string;
  pricing: LlmModelPricing;
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
  costMinorUsd: number;
  peak?: boolean;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

/** Process-local spend for one lab case or job. Always recorded from callLLM. */
export interface LlmSpendSnapshot {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  usd: number;
  peakCalls: number;
  model: string;
}

const DEFAULT_MODEL_PRICING: Record<string, LlmModelPricing> = {
  "grok-4.3": { inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 2.5 },
  "grok-4-fast": { inputUsdPer1MTokens: 0.2, outputUsdPer1MTokens: 0.5 },
  "grok-4.1-fast": { inputUsdPer1MTokens: 0.2, outputUsdPer1MTokens: 0.5 },
  "deepseek-v4-pro": { inputUsdPer1MTokens: 0.66, outputUsdPer1MTokens: 1.98 },
  "deepseek-v4-flash": { inputUsdPer1MTokens: 0.22, outputUsdPer1MTokens: 0.66 },
};

/** DeepSeek V4 Pro published rates (2026-08-16). Peak = 01:00–04:00 and 06:00–10:00 UTC. */
const DEEPSEEK_V4_PRO_RATES = {
  offPeak: { miss: 0.66, hit: 0.022, output: 1.98 },
  peak: { miss: 1.32, hit: 0.044, output: 3.96 },
} as const;

/** Flash is 1/3 of Pro, same cache/peak shape, until a published table lands. */
const DEEPSEEK_V4_FLASH_RATES = {
  offPeak: { miss: 0.22, hit: 0.007333, output: 0.66 },
  peak: { miss: 0.44, hit: 0.014667, output: 1.32 },
} as const;

function parseNonNegativeNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function modelEnvKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export function isDeepSeekV4Pro(model: string): boolean {
  return model.toLowerCase().includes("deepseek-v4-pro");
}

export function isDeepSeekV4Flash(model: string): boolean {
  return model.toLowerCase().includes("deepseek-v4-flash");
}

export function isDeepSeekPeakUtc(at: Date = new Date()): boolean {
  const hour = at.getUTCHours();
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
}

export function resolveLlmModelPricing(model: string): LlmModelPricing | null {
  const key = modelEnvKey(model);
  const modelInput = parseNonNegativeNumber(process.env[`LLM_PRICE_${key}_INPUT_PER_1M_USD`]);
  const modelOutput = parseNonNegativeNumber(process.env[`LLM_PRICE_${key}_OUTPUT_PER_1M_USD`]);
  if (modelInput !== null && modelOutput !== null) {
    return { inputUsdPer1MTokens: modelInput, outputUsdPer1MTokens: modelOutput };
  }

  const globalInput = parseNonNegativeNumber(process.env.LLM_PRICE_INPUT_PER_1M_USD);
  const globalOutput = parseNonNegativeNumber(process.env.LLM_PRICE_OUTPUT_PER_1M_USD);
  if (globalInput !== null && globalOutput !== null) {
    return { inputUsdPer1MTokens: globalInput, outputUsdPer1MTokens: globalOutput };
  }

  return DEFAULT_MODEL_PRICING[model] ?? null;
}

function cacheSplit(usage: LLMTelemetryUsage): { hit: number; miss: number } {
  const hit = Math.max(0, usage.cacheHitTokens ?? 0);
  const miss =
    usage.cacheMissTokens != null
      ? Math.max(0, usage.cacheMissTokens)
      : Math.max(0, usage.promptTokens - hit);
  return { hit, miss };
}

export function estimateLlmCostUsd(
  model: string | undefined,
  usage: LLMTelemetryUsage | undefined,
  at: Date = new Date(),
): LlmCostEstimate | null {
  if (!model || !usage) return null;

  const deepSeekRates = isDeepSeekV4Pro(model)
    ? DEEPSEEK_V4_PRO_RATES
    : isDeepSeekV4Flash(model)
      ? DEEPSEEK_V4_FLASH_RATES
      : null;
  if (deepSeekRates) {
    const peak = isDeepSeekPeakUtc(at);
    const rates = peak ? deepSeekRates.peak : deepSeekRates.offPeak;
    const { hit, miss } = cacheSplit(usage);
    const inputUsd = (hit / 1_000_000) * rates.hit + (miss / 1_000_000) * rates.miss;
    const outputUsd = (usage.completionTokens / 1_000_000) * rates.output;
    const totalUsd = inputUsd + outputUsd;
    return {
      model,
      pricing: {
        inputUsdPer1MTokens: rates.miss,
        outputUsdPer1MTokens: rates.output,
      },
      inputUsd,
      outputUsd,
      totalUsd,
      costMinorUsd: Math.round(totalUsd * 100),
      peak,
      cacheHitTokens: hit,
      cacheMissTokens: miss,
    };
  }

  const pricing = resolveLlmModelPricing(model);
  if (!pricing) return null;
  const inputUsd = (usage.promptTokens / 1_000_000) * pricing.inputUsdPer1MTokens;
  const outputUsd = (usage.completionTokens / 1_000_000) * pricing.outputUsdPer1MTokens;
  const totalUsd = inputUsd + outputUsd;
  return {
    model,
    pricing,
    inputUsd,
    outputUsd,
    totalUsd,
    costMinorUsd: Math.round(totalUsd * 100),
  };
}

function emptySpend(model = ""): LlmSpendSnapshot {
  return {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    usd: 0,
    peakCalls: 0,
    model,
  };
}

let spendMeter = emptySpend();

export function resetLlmSpendMeter(): void {
  spendMeter = emptySpend();
}

export function snapshotLlmSpendMeter(): LlmSpendSnapshot {
  return { ...spendMeter };
}

export function recordLlmSpend(
  model: string,
  usage: LLMTelemetryUsage,
  at: Date = new Date(),
): void {
  const cost = estimateLlmCostUsd(model, usage, at);
  const { hit, miss } = cacheSplit(usage);
  spendMeter = {
    calls: spendMeter.calls + 1,
    promptTokens: spendMeter.promptTokens + usage.promptTokens,
    completionTokens: spendMeter.completionTokens + usage.completionTokens,
    cacheHitTokens: spendMeter.cacheHitTokens + hit,
    cacheMissTokens: spendMeter.cacheMissTokens + miss,
    usd: spendMeter.usd + (cost?.totalUsd ?? 0),
    peakCalls: spendMeter.peakCalls + (cost?.peak ? 1 : 0),
    model: model || spendMeter.model,
  };
}

export function formatLlmSpend(spend: LlmSpendSnapshot): string {
  const tokens = spend.promptTokens + spend.completionTokens;
  const hitPct =
    spend.promptTokens > 0 ? Math.round((spend.cacheHitTokens / spend.promptTokens) * 100) : 0;
  const usd = spend.usd < 0.01 && spend.usd > 0 ? spend.usd.toFixed(4) : spend.usd.toFixed(3);
  const peak = spend.peakCalls > 0 ? " peak" : "";
  return `tokens=${tokens} $${usd} cache ${hitPct}%${peak}`;
}
