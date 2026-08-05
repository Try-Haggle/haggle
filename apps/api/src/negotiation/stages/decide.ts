/**
 * Stage 3: Decide
 *
 * Core decision logic extracted from the 13-step executor.
 * Routes to Skill (rule-based) or LLM depending on phase + action.
 */

import { callLLM } from "../adapters/deepseek-client.js";
import { shouldUseReasoning } from "../config.js";
import type { DecideInput, DecideOutput } from "../pipeline/types.js";
import { buildHarnessTrace } from "../referee/harness.js";
import { computeHarnessBox, DEFAULT_AUTONOMY } from "../referee/harness-box.js";
import type { EngineDecision, HarnessTrace } from "../types.js";

/**
 * Make a negotiation decision.
 *
 * Decision routing:
 * - BARGAINING + COUNTER → LLM augmentation (with skill fallback)
 * - All other cases → Skill rule-based (fallback when LLM unavailable)
 */
export async function decide(input: DecideInput): Promise<DecideOutput> {
  const { context, adapter, skill, phase, config, memory, facts, conversation } = input;
  const startMs = Date.now();

  // Step 1: Skill evaluateOffer (rule-based fallback, LLM augments in BARGAINING)
  const incomingOffer = memory.boundaries.opponent_offer;
  let decision: EngineDecision = await skill.evaluateOffer(
    memory,
    { price: incomingOffer },
    facts,
    phase,
  );
  let source: DecideOutput["source"] = "skill";
  let reasoningMode = false;
  let llmRaw: string | undefined;
  let tokens: DecideOutput["tokens"];

  // Step 2: LLM augmentation.
  // We let the LLM craft the actual move in OPENING and BARGAINING when the
  // skill produced a COUNTER. OPENING is included because that's where the
  // first anchor is made — leaving it to the deterministic skill alone made
  // every negotiation feel mechanical and stuck on a single price.
  const llmEligible =
    (phase === "OPENING" || phase === "BARGAINING") && decision.action === "COUNTER";
  if (llmEligible) {
    try {
      const useReasoning =
        config.reasoningEnabled &&
        shouldUseReasoning({
          gap: memory.boundaries.gap,
          gapRatio:
            memory.boundaries.gap /
            Math.abs(memory.boundaries.my_target - memory.boundaries.my_floor || 1),
          coachWarnings: context.briefing.warnings,
          opponentPattern: context.briefing
            .opponentPattern as import("../types.js").OpponentPatternType,
          softViolationCount: 0,
        });

      reasoningMode = useReasoning;

      // Build prompts
      const systemPrompt = adapter.buildSystemPrompt(skill.getLLMContext(), memory.session.role);
      const userPrompt = adapter.buildUserPrompt(
        memory,
        facts.slice(-5),
        signalLinesFromContext(context),
        undefined,
        conversation,
      );

      // Call LLM
      const llmResponse = await callLLM(systemPrompt, userPrompt, {
        reasoning: useReasoning,
        correlationId: memory.session.session_id,
      });

      llmRaw = llmResponse.content;
      tokens = {
        prompt: llmResponse.usage.prompt_tokens,
        completion: llmResponse.usage.completion_tokens,
      };

      // Parse response
      const llmDecision = adapter.parseResponse(llmResponse.content);

      // Use LLM decision if it has a valid price for COUNTER
      if (llmDecision.action === "COUNTER" && llmDecision.price && llmDecision.price > 0) {
        decision = llmDecision;
        source = "llm";
      } else if (["ACCEPT", "REJECT", "HOLD"].includes(llmDecision.action)) {
        decision = llmDecision;
        source = "llm";
      }
      // Otherwise, keep skill decision as fallback
    } catch (err) {
      // LLM failure → graceful fallback to skill decision
      console.warn("[decide] LLM fallback:", (err as Error).message);
      // decision already set from skill.evaluateOffer()
    }
  }

  // Harness rail: bound the chosen price to the engine's box (SOT §11).
  // The engine already produced box (coaching.acceptable_range) + baseline
  // (recommended_price); until now the LLM price wasn't bound to it. Clamp a
  // priced COUNTER into the box and record the trace. No-op when there's no
  // usable box (facts-only path) or the action carries no price.
  // The harness is a best-effort add-on: it must NEVER break a round. Any error
  // here (missing coaching, bad box, etc.) is swallowed so the negotiation still
  // completes with the un-clamped decision.
  let harness: HarnessTrace | undefined;
  try {
    // Opponent estimate (if the LLM reported one) shifts the aim within the box —
    // instrumental only; the box (my target/floor) stays the authoritative goal.
    const estimate = decision.opponent_estimate;
    const hb = computeHarnessBox(memory.coaching, memory.boundaries, DEFAULT_AUTONOMY, estimate);
    if (hb && decision.action === "COUNTER" && typeof decision.price === "number") {
      harness = buildHarnessTrace({
        range: { baseline: hb.baseline, min: hb.range.min, max: hb.range.max },
        autonomy: DEFAULT_AUTONOMY,
        aim: hb.aim,
        ...(estimate ? { opponent_estimate: estimate } : {}),
        ai: { price: decision.price, tactic: decision.tactic_used, source },
        model_id: adapter.modelId,
      });
      const clampedPrice = harness.ai_choice.price;
      if (typeof clampedPrice === "number" && clampedPrice !== decision.price) {
        decision = { ...decision, price: clampedPrice };
      }
    }
  } catch (err) {
    console.warn("[decide] harness skipped:", (err as Error).message);
  }

  const latencyMs = Date.now() - startMs;

  return {
    decision,
    source,
    reasoning_mode: reasoningMode,
    llm_raw: llmRaw,
    tokens,
    latency_ms: latencyMs,
    ...(harness ? { harness } : {}),
  };
}

function signalLinesFromContext(context: DecideInput["context"]): string[] | undefined {
  const lines = context.layers.L5_signals.split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}
