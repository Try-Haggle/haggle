/**
 * negotiation/config.ts
 *
 * Feature flags, LLM routing config, and default settings
 * for the LLM negotiation engine integration.
 */

import type { BuddyDNA, HumanInterventionMode, OpponentPatternType } from './types.js';

// ---------------------------------------------------------------------------
// Feature Flag
// ---------------------------------------------------------------------------

export type NegotiationEngineMode = 'llm' | 'rule';

export function getEngineMode(): NegotiationEngineMode {
  const mode = process.env.NEGOTIATION_ENGINE;
  if (mode === 'llm') return 'llm';
  return 'rule'; // default: rule-based
}

// ---------------------------------------------------------------------------
// Validation Mode (Step 67-A)
// ---------------------------------------------------------------------------

export type ValidationMode = 'full' | 'lite';

export function getValidationMode(): ValidationMode {
  return (process.env.VALIDATION_MODE as ValidationMode) ?? 'full';
}

// ---------------------------------------------------------------------------
// Memo Encoding (Step 67-B)
// ---------------------------------------------------------------------------

export type MemoEncodingConfig = 'auto' | 'codec' | 'raw';

export function getMemoEncoding(): MemoEncodingConfig {
  return (process.env.MEMO_ENCODING as MemoEncodingConfig) ?? 'auto';
}

/**
 * Resolve 'auto' encoding based on model context window and token cost.
 * auto: context 500K+ AND token cost < $0.05/M → raw, else codec.
 */
export function resolveMemoEncoding(config: {
  modelContextWindow?: number;
  tokenCostPerM?: number;
  encoding: MemoEncodingConfig;
}): 'codec' | 'raw' {
  if (config.encoding !== 'auto') return config.encoding;

  // Context 500K+ AND token $0.05/M 이하 → raw
  if ((config.modelContextWindow ?? 0) > 500_000 && (config.tokenCostPerM ?? 999) < 0.05) {
    return 'raw';
  }
  return 'codec';
}

// ---------------------------------------------------------------------------
// Reasoning Mode Trigger
// ---------------------------------------------------------------------------

export interface ReasoningTriggerInput {
  gap: number;
  /** Ratio: gap / price range (0-1) */
  gapRatio: number;
  coachWarnings: string[];
  opponentPattern: OpponentPatternType;
  softViolationCount: number;
}

/**
 * Determine if the LLM should use reasoning mode for this round.
 * Reasoning is more expensive but better for complex judgment calls.
 */
export function shouldUseReasoning(input: ReasoningTriggerInput): boolean {
  // Gap < 10% of range — close to deal, judgment matters
  if (input.gapRatio < 0.10 && input.gapRatio > 0) return true;

  // 2+ coach warnings (stagnation + time pressure, etc.)
  if (input.coachWarnings.length >= 2) return true;

  // Opponent is firm — strategic judgment needed
  if (input.opponentPattern === 'BOULWARE') return true;

  // 2+ soft violations — need to rethink approach
  if (input.softViolationCount >= 2) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Default BuddyDNA
// ---------------------------------------------------------------------------

export const DEFAULT_BUDDY_DNA: BuddyDNA = {
  style: 'balanced',
  preferred_tactic: 'reciprocal_concession',
  category_experience: 'electronics',
  condition_trade_success_rate: 0.5,
  best_timing: 'mid-session',
  tone: {
    style: 'professional',
    formality: 'neutral',
    emoji_use: false,
  },
};

// ---------------------------------------------------------------------------
// Default Settings
// ---------------------------------------------------------------------------

export const DEFAULT_INTERVENTION_MODE: HumanInterventionMode = 'FULL_AUTO';
export const DEFAULT_MAX_ROUNDS = 15;

// ---------------------------------------------------------------------------
// Token Budgets (per phase) — mirrors PHASE_TOKEN_BUDGET in types.ts
// Already defined in types.ts, re-exported for convenience
// ---------------------------------------------------------------------------

export { PHASE_TOKEN_BUDGET } from './types.js';
