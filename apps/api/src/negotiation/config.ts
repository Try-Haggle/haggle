/**
 * negotiation/config.ts
 *
 * Feature flags, LLM routing config, and default settings
 * for the LLM negotiation engine integration.
 */

import type { BuddyDNA, HumanInterventionMode } from "./types.js";

// ---------------------------------------------------------------------------
// Feature Flag
// ---------------------------------------------------------------------------

export type NegotiationEngineMode = "llm" | "rule";

export function getEngineMode(): NegotiationEngineMode {
  const mode = process.env.NEGOTIATION_ENGINE;
  if (mode === "llm") return "llm";
  return "rule"; // default: rule-based
}

// ---------------------------------------------------------------------------
// Validation Mode (Step 67-A)
// ---------------------------------------------------------------------------

export type ValidationMode = "full" | "lite";

export function getValidationMode(): ValidationMode {
  return (process.env.VALIDATION_MODE as ValidationMode) ?? "full";
}

// ---------------------------------------------------------------------------
// Memo Encoding (Step 67-B)
// ---------------------------------------------------------------------------

export type MemoEncodingConfig = "auto" | "codec" | "raw";

export function getMemoEncoding(): MemoEncodingConfig {
  return (process.env.MEMO_ENCODING as MemoEncodingConfig) ?? "auto";
}

/**
 * Resolve 'auto' encoding based on model context window and token cost.
 * auto: context 500K+ AND token cost < $0.05/M → raw, else codec.
 */
export function resolveMemoEncoding(config: {
  modelContextWindow?: number;
  tokenCostPerM?: number;
  encoding: MemoEncodingConfig;
}): "codec" | "raw" {
  if (config.encoding !== "auto") return config.encoding;

  // Context 500K+ AND token $0.05/M 이하 → raw
  if ((config.modelContextWindow ?? 0) > 500_000 && (config.tokenCostPerM ?? 999) < 0.05) {
    return "raw";
  }
  return "codec";
}

// ---------------------------------------------------------------------------
// Decide sampler
// ---------------------------------------------------------------------------

/** Default DeepSeek temperature. Not reasoning. Override with DEEPSEEK_TEMPERATURE or StageConfig.temperature. */
export const DEFAULT_DECIDE_TEMPERATURE = 0.5;

function clampTemperature(value: number): number {
  return Math.min(2, Math.max(0, value));
}

/** Resolve the Decide LLM temperature. Stage config wins, then env, then 0.5. */
export function getDecideTemperature(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return clampTemperature(override);
  }
  const raw = process.env.DEEPSEEK_TEMPERATURE;
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return clampTemperature(parsed);
  }
  return DEFAULT_DECIDE_TEMPERATURE;
}

/** Default DeepSeek deadline for one Decide call, including retries. */
export const DEFAULT_DECIDE_TIMEOUT_MS = 120_000;

function clampTimeoutMs(value: number): number {
  return Math.min(180_000, Math.max(10_000, Math.round(value)));
}

/** Resolve the Decide LLM timeout. Explicit override is used as-is. Else env, then 120s. */
export function getDecideTimeoutMs(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return Math.round(override);
  }
  const raw = process.env.DEEPSEEK_TIMEOUT_MS;
  if (raw !== undefined && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return clampTimeoutMs(parsed);
  }
  return DEFAULT_DECIDE_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// Default BuddyDNA
// ---------------------------------------------------------------------------

export const DEFAULT_BUDDY_DNA: BuddyDNA = {
  style: "balanced",
  preferred_tactic: "reciprocal_concession",
  category_experience: "electronics",
  condition_trade_success_rate: 0.5,
  best_timing: "mid-session",
  tone: {
    style: "professional",
    formality: "neutral",
    emoji_use: false,
  },
};

// ---------------------------------------------------------------------------
// Default Settings
// ---------------------------------------------------------------------------

export const DEFAULT_INTERVENTION_MODE: HumanInterventionMode = "FULL_AUTO";
export const DEFAULT_MAX_ROUNDS = 15;

// ---------------------------------------------------------------------------
// Token Budgets (per phase) — mirrors PHASE_TOKEN_BUDGET in types.ts
// Already defined in types.ts, re-exported for convenience
// ---------------------------------------------------------------------------

export { PHASE_TOKEN_BUDGET } from "./types.js";
