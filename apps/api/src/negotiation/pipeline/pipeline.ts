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
import { resolveMemoEncoding } from '../config.js';

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

  // ─── Resolve memo encoding (auto → codec|raw) ───
  // NOTE: modelContextWindow and tokenCostPerM are not yet available from adapter config.
  // Until StageConfig exposes these, 'auto' always resolves to 'codec' (safe default).
  const resolvedEncoding = resolveMemoEncoding({
    encoding: deps.memoEncoding as 'auto' | 'codec' | 'raw',
  });

  // ─── Build hook context for SkillStack ───
  const hookContext = deps.skillStack ? {
    memory: deps.memory,
    recentFacts: deps.facts.slice(-5),
    opponentPattern: deps.opponent,
    phase: deps.phase,
  } : null;

  // ─── Stage 1.5: Skill 'understand' hook ───
  if (deps.skillStack && hookContext) {
    try {
      await deps.skillStack.dispatchHook({ ...hookContext, stage: 'understand' });
      // termHints from understand hook can enrich future NLP parsing
    } catch { /* non-fatal */ }
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
    resolvedEncoding,
    deps.skillStack,
  );

  // ─── Stage 2.5: Skill 'context' hook (knowledge + market data) ───
  if (deps.skillStack && hookContext) {
    try {
      const contextHookResult = await deps.skillStack.dispatchHook({ ...hookContext, stage: 'context' });
      // Inject market data from HfmiMarketSkill into context output
      if (contextHookResult.decide?.marketData) {
        for (const md of contextHookResult.decide.marketData) {
          contextOutput.layers.l5 = (contextOutput.layers.l5 || '') +
            `\nMKT_SKILL:${md.source}:$${md.price}`;
        }
      }
      // Inject knowledge body from ElectronicsKnowledgeSkill
      for (const [skillId, result] of Object.entries(contextHookResult.bySkill)) {
        const body = (result.content as Record<string, unknown>).body;
        if (typeof body === 'string') {
          contextOutput.layers.l2 = (contextOutput.layers.l2 || '') + `\n[${skillId}] ${body}`;
        }
        // Merge observations
        const obs = (result.content as Record<string, unknown>).observations;
        if (Array.isArray(obs)) {
          contextOutput.layers.l5 = (contextOutput.layers.l5 || '') +
            '\n' + obs.join('\n');
        }
      }
    } catch { /* non-fatal: skills failing doesn't block pipeline */ }
  }

  // ─── Stage 3: Decide ───
  // First, get skill advisories for the decide stage
  let skillAdvisories: string[] = [];
  if (deps.skillStack && hookContext) {
    try {
      const decideHookResult = await deps.skillStack.dispatchHook({ ...hookContext, stage: 'decide' });
      if (decideHookResult.decide?.advisories) {
        for (const adv of decideHookResult.decide.advisories) {
          if (adv.recommendedPrice) {
            skillAdvisories.push(`Advisor(${adv.skillId}): suggested price $${(adv.recommendedPrice / 100).toFixed(2)}`);
          }
          if (adv.suggestedTactic) {
            skillAdvisories.push(`Advisor(${adv.skillId}): tactic=${adv.suggestedTactic}`);
          }
          if (adv.observations) {
            skillAdvisories.push(...adv.observations.map(o => `Advisor(${adv.skillId}): ${o}`));
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  // Inject advisories into context L3 layer (optional, LLM may ignore)
  if (skillAdvisories.length > 0) {
    contextOutput.layers.l3 = (contextOutput.layers.l3 || '') +
      '\n## Advisor Notes (optional, you may ignore)\n' +
      skillAdvisories.map(a => `- ${a}`).join('\n');
  }

  const decideOutput = await decide({
    context: contextOutput,
    adapter: deps.config.adapters.DECIDE,
    skill: deps.skill,
    phase: deps.phase,
    config: deps.config,
    memory: deps.memory,
    facts: deps.facts,
    opponent: deps.opponent,
  });

  // ─── Stage 4: Validate ───
  const validateOutput = validateStage(
    {
      decision: decideOutput,
      briefing: contextOutput.briefing,
      memory: deps.memory,
      phase: deps.phase,
    },
    deps.previousMoves,
  );

  // ─── Stage 4.5: Skill 'validate' hook (custom rules) ───
  if (deps.skillStack && hookContext) {
    try {
      const validateHookResult = await deps.skillStack.dispatchHook({ ...hookContext, stage: 'validate' });
      // Future: merge skill hard/soft rules with validateOutput
      // For now, log any skill-provided rules for observability
      if (validateHookResult.validate) {
        const { hardRules, softRules } = validateHookResult.validate;
        if (hardRules.length > 0 || softRules.length > 0) {
          console.info('[pipeline] skill validation rules:', { hard: hardRules.length, soft: softRules.length });
        }
      }
    } catch { /* non-fatal */ }
  }

  // ─── Stage 5: Respond ───
  const respondOutput = respond({
    validated: validateOutput,
    memory: deps.memory,
    adapter: deps.config.adapters.RESPOND,
    skill: deps.skill,
    config: deps.config,
  });

  // ─── Stage 6: Persist ───
  const memoSnapshot = createSnapshot(
    deps.memory,
    deps.round,
    resolvedEncoding,
    deps.facts.slice(-5),
  );

  const persistInput: PersistInput = {
    session_id: deps.memory.session.session_id,
    round_number: deps.round,
    decision: validateOutput,
    response: respondOutput,
    memory: deps.memory,
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
