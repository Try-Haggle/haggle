/**
 * executor-factory.ts
 *
 * Real negotiation entrypoints (POST /negotiations/start,
 * POST /negotiations/sessions/:id/offers, MCP hnp_submit_offer) MUST go
 * through this factory. It always returns the staged LLM executor — rule-based
 * and legacy LLM executors are intentionally NOT reachable from real flows.
 *
 * Rule-based and legacy executors still exist for demo routes, CLI scripts,
 * and tests; those call them directly and are not part of the real protocol.
 */

import type { Database } from "@haggle/db";
import { executeStagedNegotiationRound } from "../negotiation/pipeline/executor.js";
import type { EventDispatcher } from "./event-dispatcher.js";
import type { RoundExecutionInput, RoundExecutionResult } from "./negotiation-executor.js";

export type RoundExecutor = (
  db: Database,
  input: RoundExecutionInput,
  eventDispatcher?: EventDispatcher,
) => Promise<RoundExecutionResult>;

// Type kept as a union for backwards compatibility with the
// /negotiations/stages route guard and its tests. At runtime
// getPipelineMode() only ever returns 'staged'.
export type PipelineMode = "staged" | "legacy";

/**
 * Pipeline mode is fixed at 'staged' for real negotiation flows.
 * Kept as a function for backwards compatibility with /negotiations/stages
 * route guards.
 */
export function getPipelineMode(): PipelineMode {
  return "staged";
}

/**
 * Returns the staged LLM executor. There is no rule-based fallback for real
 * negotiation — the only knob is whether the staged pipeline is healthy
 * (DEEPSEEK_API_KEY set, etc.), and failures should surface as errors rather than
 * silently downgrading.
 */
export function getExecutor(): RoundExecutor {
  return executeStagedNegotiationRound;
}
