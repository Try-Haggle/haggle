/**
 * pipeline/pipeline.ts
 *
 * 6-Stage pipeline orchestrator.
 * Calls stages sequentially, accumulating results into PipelineResult.
 */

import type {
  PipelineResult,
  PipelineDeps,
  UnderstandOutput,
  PersistInput,
} from './types.js';
import { understand, understandFromStructured } from '../stages/understand.js';
import { assembleStageContext } from '../stages/context.js';
import { decide } from '../stages/decide.js';
import { validateStage } from '../stages/validate.js';
import { respond } from '../stages/respond.js';
import { persist } from '../stages/persist.js';
import { createSnapshot } from '../memo/memo-manager.js';

// Token cost estimate: $0.0015 per 1K tokens (grok-fast tier)
const USD_PER_1K_TOKENS = 0.0015;

/**
 * Execute the full 6-stage negotiation pipeline.
 *
 * @param message - Raw text message or already-parsed UnderstandOutput
 * @param offerPrice - Structured price (from API's offerPriceMinor)
 * @param deps - Injected dependencies (skill, config, memory, etc.)
 */
export async function executePipeline(
  message: string | UnderstandOutput,
  offerPrice: number | undefined,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const startMs = Date.now();

  // ─── Stage 1: Understand ───
  let understandOutput: UnderstandOutput;
  if (typeof message === 'string') {
    if (offerPrice !== undefined) {
      // Structured input bypass
      understandOutput = understandFromStructured(offerPrice, deps.memory.session.role === 'buyer' ? 'seller' : 'buyer');
    } else {
      understandOutput = understand({ raw_message: message, sender_role: deps.memory.session.role === 'buyer' ? 'seller' : 'buyer' });
    }
  } else {
    understandOutput = message;
  }

  // ─── Stage 2: Context ───
  const contextOutput = assembleStageContext(
    {
      understood: understandOutput,
      memory: deps.memory,
      facts: deps.facts,
      opponent: deps.opponent,
      skill: deps.skill,
      l5_signals: deps.l5_signals,
    },
    deps.config.adapters.DECIDE,
    deps.memoEncoding,
  );

  // ─── Stage 3: Decide ───
  const decideOutput = await decide({
    context: contextOutput,
    adapter: deps.config.adapters.DECIDE,
    skill: deps.skill,
    phase: deps.phase,
    config: deps.config,
    memory: { ...deps.memory, coaching: contextOutput.coaching },
    facts: deps.facts,
    opponent: deps.opponent,
  });

  // ─── Stage 4: Validate ───
  const validateOutput = validateStage(
    {
      decision: decideOutput,
      coaching: contextOutput.coaching,
      memory: { ...deps.memory, coaching: contextOutput.coaching },
      phase: deps.phase,
    },
    deps.previousMoves,
  );

  // ─── Stage 5: Respond ───
  const respondOutput = respond({
    validated: validateOutput,
    memory: { ...deps.memory, coaching: contextOutput.coaching },
    adapter: deps.config.adapters.RESPOND,
    skill: deps.skill,
    config: deps.config,
  });

  // ─── Stage 6: Persist ───
  const memoSnapshot = createSnapshot(
    { ...deps.memory, coaching: contextOutput.coaching },
    deps.round,
    deps.memoEncoding,
    deps.facts.slice(-5),
  );

  const persistInput: PersistInput = {
    session_id: deps.memory.session.session_id,
    round_number: deps.round,
    decision: validateOutput,
    response: respondOutput,
    memory: { ...deps.memory, coaching: contextOutput.coaching },
    memo_hash: memoSnapshot.hash,
    explainability: validateOutput.explainability,
  };

  let persistOutput;
  if (deps.persistFn) {
    persistOutput = await deps.persistFn(persistInput);
  } else {
    persistOutput = persist(persistInput, deps.phase);
  }

  // ─── Cost calculation ───
  const totalTokens = (decideOutput.tokens?.prompt ?? 0) + (decideOutput.tokens?.completion ?? 0)
    + (respondOutput.tokens?.prompt ?? 0) + (respondOutput.tokens?.completion ?? 0);
  const totalLatencyMs = Date.now() - startMs;
  const usdCost = (totalTokens / 1000) * USD_PER_1K_TOKENS;

  // Determine final phase
  const finalPhase = persistOutput.phase_transition?.to ?? deps.phase;

  return {
    round: deps.round,
    phase: finalPhase,
    stages: {
      understand: understandOutput,
      context: contextOutput,
      decide: decideOutput,
      validate: validateOutput,
      respond: respondOutput,
      persist: persistOutput,
    },
    explainability: validateOutput.explainability,
    cost: {
      tokens: totalTokens,
      usd: usdCost,
      latency_ms: totalLatencyMs,
    },
    done: persistOutput.session_done,
  };
}
