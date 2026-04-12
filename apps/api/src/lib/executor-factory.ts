/**
 * executor-factory.ts
 *
 * Strategy pattern: returns rule-based, LLM (legacy), or staged pipeline executor
 * based on NEGOTIATION_ENGINE and NEGOTIATION_PIPELINE env vars.
 *
 * NEGOTIATION_ENGINE=rule → rule-based (engine-session)
 * NEGOTIATION_ENGINE=llm + NEGOTIATION_PIPELINE=legacy → legacy LLM executor (default)
 * NEGOTIATION_ENGINE=llm + NEGOTIATION_PIPELINE=staged → new 6-Stage pipeline
 */

import type { Database } from "@haggle/db";
import type { EventDispatcher } from "./event-dispatcher.js";
import type { RoundExecutionInput, RoundExecutionResult } from "./negotiation-executor.js";
import { executeNegotiationRound as executeRuleBasedRound } from "./negotiation-executor.js";
import { executeLLMNegotiationRound } from "./llm-negotiation-executor.js";
import { executeStagedNegotiationRound } from "../negotiation/pipeline/executor.js";
import { getEngineMode } from "../negotiation/config.js";

export type RoundExecutor = (
  db: Database,
  input: RoundExecutionInput,
  eventDispatcher?: EventDispatcher,
) => Promise<RoundExecutionResult>;

export type PipelineMode = 'legacy' | 'staged';

/**
 * Get NEGOTIATION_PIPELINE env (default: legacy).
 */
export function getPipelineMode(): PipelineMode {
  const mode = process.env.NEGOTIATION_PIPELINE;
  if (mode === 'staged') return 'staged';
  return 'legacy';
}

/**
 * Get the appropriate round executor based on NEGOTIATION_ENGINE + NEGOTIATION_PIPELINE env.
 */
export function getExecutor(): RoundExecutor {
  const mode = getEngineMode();
  if (mode === 'llm') {
    const pipelineMode = getPipelineMode();
    if (pipelineMode === 'staged') {
      return executeStagedNegotiationRound;
    }
    return executeLLMNegotiationRound;
  }
  return executeRuleBasedRound;
}
