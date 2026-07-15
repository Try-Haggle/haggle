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
}

const DEFAULT_MODEL_PRICING: Record<string, LlmModelPricing> = {
  "grok-4.3": { inputUsdPer1MTokens: 1.25, outputUsdPer1MTokens: 2.5 },
  "grok-4-fast": { inputUsdPer1MTokens: 0.2, outputUsdPer1MTokens: 0.5 },
  "grok-4.1-fast": { inputUsdPer1MTokens: 0.2, outputUsdPer1MTokens: 0.5 },
};

function parseNonNegativeNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function modelEnvKey(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
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

export function estimateLlmCostUsd(
  model: string | undefined,
  usage: LLMTelemetryUsage | undefined,
): LlmCostEstimate | null {
  if (!model || !usage) return null;
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
