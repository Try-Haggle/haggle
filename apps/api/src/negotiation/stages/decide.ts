/**
 * Stage 3: Decide
 *
 * Core decision logic extracted from the 13-step executor.
 * Routes to Skill (rule-based) or LLM depending on phase + action.
 */

import { callLLM } from "../adapters/deepseek-client.js";
import { getDecideTemperature } from "../config.js";
import { resolveDecideModel } from "../decide-model.js";
import type { DecideInput, DecideOutput } from "../pipeline/types.js";
import { encodeSkillSlots } from "../prompts/skill-slots.js";
import { buildHarnessTrace } from "../referee/harness.js";
import { computeHarnessBox, DEFAULT_AUTONOMY } from "../referee/harness-box.js";
import type { CoreMemory, EngineDecision, HarnessTrace } from "../types.js";

/**
 * LLM miss: repeat the last standing offer. Do not emit Faratin.
 * Faratin lives in Skills → Advisor only.
 */
export function holdLastOfferOrPause(memory: CoreMemory): EngineDecision {
  const last = memory.boundaries.my_last_offer;
  const standing =
    typeof last === "number" && last > 0
      ? last
      : memory.session.phase !== "OPENING" &&
          typeof memory.boundaries.current_offer === "number" &&
          memory.boundaries.current_offer > 0
        ? memory.boundaries.current_offer
        : undefined;

  if (standing !== undefined) {
    return {
      action: "COUNTER",
      price: standing,
      reasoning: "LLM unavailable — repeating last offer. Faratin is a skill, not a fill.",
      tactic_used: "hold_last",
    };
  }

  return {
    action: "HOLD",
    reasoning: "LLM unavailable — no last offer to repeat. Faratin is a skill, not a fill.",
  };
}

/**
 * Make a negotiation decision.
 *
 * Decision routing:
 * - OPENING/BARGAINING + COUNTER → LLM (timeout/invalid → last offer or HOLD)
 * - All other cases → Skill rule-based
 * Faratin is an Advisor skill, not a timeout success path.
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
  let llmRaw: string | undefined;
  let tokens: DecideOutput["tokens"];
  let routedModel: string | undefined;

  // Step 2: LLM augmentation.
  // We let the LLM craft the actual move in OPENING and BARGAINING when the
  // skill produced a COUNTER. OPENING is included because that's where the
  // first anchor is made — leaving it to the deterministic skill alone made
  // every negotiation feel mechanical and stuck on a single price.
  const llmEligible =
    (phase === "OPENING" || phase === "BARGAINING") && decision.action === "COUNTER";
  if (llmEligible) {
    try {
      // Live prompt path: docs/engine/decide-prompt-contract.md
      const systemPrompt = adapter.buildSystemPrompt(
        encodeSkillSlots(input.skillSlots ?? { knowledge: [skill.getLLMContext()] }),
        memory.session.role,
        memory.listing_context,
      );
      const userPrompt = adapter.buildUserPrompt(
        memory,
        facts,
        signalLinesFromContext(context),
        undefined,
        conversation,
      );

      const route = resolveDecideModel({
        publishedAskMinor: memory.listing_context?.published_ask_minor,
        sellerAskMinor: memory.session.role === "seller" ? memory.boundaries.my_target : undefined,
        allowedModelId: memory.session.allowed_model,
        proCredit: memory.session.pro_model_credit === true,
      });
      routedModel = route.model;

      const llmResponse = await callLLM(systemPrompt, userPrompt, {
        temperature: getDecideTemperature(config.temperature),
        correlationId: memory.session.session_id,
        model: route.model,
      });

      llmRaw = llmResponse.content;
      tokens = {
        prompt: llmResponse.usage.prompt_tokens,
        completion: llmResponse.usage.completion_tokens,
      };

      // Parse response
      const llmDecision = adapter.parseResponse(llmResponse.content);

      if (llmDecision.action === "COUNTER" && llmDecision.price && llmDecision.price > 0) {
        decision = llmDecision;
        source = "llm";
      } else if (["ACCEPT", "REJECT", "HOLD"].includes(llmDecision.action)) {
        decision = llmDecision;
        source = "llm";
      } else {
        decision = holdLastOfferOrPause(memory);
        source = "skill";
      }
    } catch (err) {
      console.warn("[decide] LLM fallback:", (err as Error).message);
      decision = holdLastOfferOrPause(memory);
      source = "skill";
    }
  }

  // Harness rail: bound the chosen price to the safety envelope (autonomy 1).
  // recommended_price is logged as baseline but is not the clamp center.
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
        model_id: routedModel ?? adapter.modelId,
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
    reasoning_mode: false,
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
