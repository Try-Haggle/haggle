/**
 * pipeline/pipeline.ts
 *
 * 6-Stage pipeline orchestrator.
 * Calls stages sequentially, accumulating results into PipelineResult.
 */

import { resolveMemoEncoding } from "../config.js";
import { createSnapshot } from "../memo/memo-manager.js";
import { collectSkillSlots, type SkillSlotContent } from "../prompts/skill-slots.js";
import { assembleStageContext } from "../stages/context.js";
import { decide } from "../stages/decide.js";
import { persist } from "../stages/persist.js";
import { respond } from "../stages/respond.js";
import { understand, understandFromStructured } from "../stages/understand.js";
import { validateStage } from "../stages/validate.js";
import { isDealClosingAction } from "../types.js";
import type {
  PersistInput,
  PersistOutput,
  PipelineDeps,
  PipelineResult,
  UnderstandOutput,
} from "./types.js";

// Token cost estimate: ~$0.0007 per 1K tokens (deepseek-v4-pro avg of cache-miss input + output)
const USD_PER_1K_TOKENS = 0.0007;

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
  if (typeof message === "string") {
    if (offerPrice !== undefined) {
      // Structured input bypass
      understandOutput = understandFromStructured(
        offerPrice,
        deps.memory.session.role === "buyer" ? "seller" : "buyer",
      );
    } else {
      understandOutput = understand({
        raw_message: message,
        sender_role: deps.memory.session.role === "buyer" ? "seller" : "buyer",
        known_shipping_terms: Boolean(
          deps.memory.fulfillment_context ||
            deps.memory.terms.active.some((term) => term.term_id === "shipping_method"),
        ),
      });
    }
  } else {
    understandOutput = message;
  }

  // ─── Resolve memo encoding (auto → codec|raw) ───
  // NOTE: modelContextWindow and tokenCostPerM are not yet available from adapter config.
  // Until StageConfig exposes these, 'auto' always resolves to 'codec' (safe default).
  const resolvedEncoding = resolveMemoEncoding({
    encoding: deps.memoEncoding as "auto" | "codec" | "raw",
  });

  // ─── Build hook context for SkillStack ───
  const hookContext = deps.skillStack
    ? {
        memory: deps.memory,
        recentFacts: deps.facts.slice(-5),
        opponentPattern: deps.opponent,
        phase: deps.phase,
      }
    : null;

  // ─── Stage 1.5: Skill 'understand' hook ───
  if (deps.skillStack && hookContext) {
    try {
      await deps.skillStack.dispatchHook({ ...hookContext, stage: "understand" });
      // termHints from understand hook can enrich future NLP parsing
    } catch {
      /* non-fatal */
    }
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
      memory_brief: deps.memory_brief,
      evermemo_brief: deps.evermemo_brief,
    },
    deps.config.adapters.DECIDE,
    resolvedEncoding,
    deps.skillStack,
  );

  // ─── Stage 2.5: Skill 'context' hook (knowledge + market data) ───
  const contextMarketLines: string[] = [];
  if (deps.skillStack && hookContext) {
    try {
      const contextHookResult = await deps.skillStack.dispatchHook({
        ...hookContext,
        stage: "context",
      });
      // Inject market data from HfmiMarketSkill into context output
      if (contextHookResult.decide?.marketData) {
        for (const md of contextHookResult.decide.marketData) {
          contextOutput.layers.L5_signals += `\nMKT_SKILL:${md.source}:$${md.price}`;
          contextMarketLines.push(`${md.source}: $${md.price} (advisory)`);
        }
      }
      // Inject knowledge body from ElectronicsKnowledgeSkill
      for (const [skillId, result] of Object.entries(contextHookResult.bySkill)) {
        const body = (result.content as Record<string, unknown>).body;
        if (typeof body === "string") {
          contextOutput.layers.L2_skill += `\n[${skillId}] ${body}`;
        }
        const md = (result.content as Record<string, unknown>).marketData as
          | { price?: number; source?: string }
          | undefined;
        if (md && typeof md.price === "number" && typeof md.source === "string") {
          contextOutput.layers.L5_signals += `\nMKT_SKILL:${md.source}:$${md.price}`;
          contextMarketLines.push(`${md.source}: $${md.price} (advisory)`);
        }
        // Merge observations
        const obs = (result.content as Record<string, unknown>).observations;
        if (Array.isArray(obs)) {
          contextOutput.layers.L5_signals += "\n" + obs.join("\n");
        }
      }
    } catch {
      /* non-fatal: skills failing doesn't block pipeline */
    }
  }

  // ─── Stage 3: Decide ───
  // Skill hooks already ran for understand/context. Peek decide + validate +
  // respond so their bodies land in labeled Decide slots (not L3, which Decide
  // does not read). Validate still runs again at 4.5 for the code path.
  let skillSlots: SkillSlotContent = { knowledge: [deps.skill.getLLMContext()] };
  const skillAdvisories: string[] = [];
  if (deps.skillStack && hookContext) {
    try {
      const [decideHookResult, validatePeek, respondPeek] = await Promise.all([
        deps.skillStack.dispatchHook({ ...hookContext, stage: "decide" }),
        deps.skillStack.dispatchHook({ ...hookContext, stage: "validate" }),
        deps.skillStack.dispatchHook({ ...hookContext, stage: "respond" }),
      ]);
      if (decideHookResult.decide?.advisories) {
        for (const adv of decideHookResult.decide.advisories) {
          if (adv.recommendedPrice) {
            skillAdvisories.push(
              `Advisor(${adv.skillId}): suggested price $${(adv.recommendedPrice / 100).toFixed(2)}`,
            );
          }
          if (adv.suggestedTactic) {
            skillAdvisories.push(`Advisor(${adv.skillId}): tactic=${adv.suggestedTactic}`);
          }
          if (adv.observations) {
            skillAdvisories.push(...adv.observations.map((o) => `Advisor(${adv.skillId}): ${o}`));
          }
        }
      }
      const respondContent = Object.values(respondPeek.bySkill)
        .map((r) => r.content as { toneGuidance?: string; terminology?: Record<string, string> })
        .find((c) => c.toneGuidance || c.terminology);
      const decideMarket = (decideHookResult.decide?.marketData ?? []).map(
        (md) => `${md.source}: $${md.price} (advisory)`,
      );
      skillSlots = collectSkillSlots({
        llmContext: deps.skill.getLLMContext(),
        decide: decideHookResult.decide,
        validate: validatePeek.validate,
        market: [...contextMarketLines, ...decideMarket],
        toneGuidance: respondContent?.toneGuidance,
        terminology: respondContent?.terminology,
      });
    } catch {
      /* non-fatal: Decide still gets the session skill pointer */
    }
  }

  // Keep L3 for explainability. Decide does not read L3; slots go to the system prompt.
  if (skillAdvisories.length > 0) {
    contextOutput.layers.L3_coaching +=
      "\n## Advisor Notes (optional, you may ignore)\n" +
      skillAdvisories.map((a) => `- ${a}`).join("\n");
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
    conversation: deps.conversation,
    skillSlots,
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
      const validateHookResult = await deps.skillStack.dispatchHook({
        ...hookContext,
        stage: "validate",
      });
      // Future: merge skill hard/soft rules with validateOutput
      // For now, log any skill-provided rules for observability
      if (validateHookResult.validate) {
        const { hardRules, softRules } = validateHookResult.validate;
        if (hardRules.length > 0 || softRules.length > 0) {
          console.info("[pipeline] skill validation rules:", {
            hard: hardRules.length,
            soft: softRules.length,
          });
        }
      }
    } catch {
      /* non-fatal */
    }
  }

  // ─── Deal-closing price/message reconciliation ───
  // Closing means agreeing to the exact offer on the table. The LLM may set a
  // divergent `price` or author a free-text `message` stating a different
  // number. Pin the accepted price to the incoming offer and drop the LLM
  // message so the deterministic renderer echoes that same price — keeping the
  // chat text, the persisted price, and the charged amount in agreement.
  //
  // CONFIRM closes a deal exactly like ACCEPT (both map to a DB `ACCEPT` and an
  // `ACCEPTED` session), and the CLOSING-phase skills emit CONFIRM, not ACCEPT —
  // so an ACCEPT-only check skipped every real closing round. That is how a round
  // shipped "Confirming the agreement at $215.00" while settling at $217.75: the
  // engine's `boundaries.current_offer` was the seller's own prior counter, and
  // nothing reconciled it against the offer actually being accepted.
  if (isDealClosingAction(validateOutput.final_decision.action)) {
    const acceptedPrice = offerPrice ?? understandOutput.price_offer;
    if (acceptedPrice !== undefined) {
      validateOutput.final_decision.price = acceptedPrice;
    }
    validateOutput.final_decision.message = undefined;
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
  const memoSnapshot = createSnapshot(deps.memory, deps.round, resolvedEncoding, deps.facts);

  const persistInput: PersistInput = {
    session_id: deps.memory.session.session_id,
    round_number: deps.round,
    decision: validateOutput,
    response: respondOutput,
    memory: deps.memory,
    memo_hash: memoSnapshot.hash,
    explainability: validateOutput.explainability,
  };

  let persistOutput: PersistOutput;
  if (deps.persistFn) {
    persistOutput = await deps.persistFn(persistInput);
  } else {
    persistOutput = persist(persistInput, deps.phase);
  }

  // ─── Cost calculation ───
  const totalTokens =
    (decideOutput.tokens?.prompt ?? 0) +
    (decideOutput.tokens?.completion ?? 0) +
    (respondOutput.tokens?.prompt ?? 0) +
    (respondOutput.tokens?.completion ?? 0);
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
