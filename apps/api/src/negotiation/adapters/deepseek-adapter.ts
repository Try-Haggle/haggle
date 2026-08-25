import { buildDecideSystemPrompt } from "../prompts/decide-system-prompt.js";
import { buildDecideUserPrompt } from "../prompts/decide-user-prompt.js";
import type { ListingHint } from "../prompts/tag-family-fewshot.js";
import type {
  ConversationContext,
  CoreMemory,
  EngineDecision,
  ModelAdapter,
  OpponentEstimate,
  RoundFact,
} from "../types.js";

export { encodeListingContext, encodeStrategyContext } from "../prompts/decide-user-prompt.js";

/**
 * DeepSeek Model Adapter — Tier: basic.
 * Uses Structured Output (JSON mode) for reliable parsing.
 *
 * User-prompt blocks are assembled only in decide-user-prompt.ts.
 * See docs/engine/decide-prompt-contract.md.
 */
export class DeepSeekAdapter implements ModelAdapter {
  readonly modelId = "deepseek";
  readonly tier = "basic" as const;
  readonly location = "remote" as const;
  readonly capabilities = ["parse", "reason", "generate"] as const;

  buildSystemPrompt(
    skillContext: string,
    role?: "buyer" | "seller",
    listing?: ListingHint | null,
  ): string {
    return buildDecideSystemPrompt(skillContext, role, listing);
  }

  buildUserPrompt(
    memory: CoreMemory,
    recentFacts: RoundFact[],
    signals?: string[],
    prevMemory?: CoreMemory,
    conversation?: ConversationContext,
  ): string {
    return buildDecideUserPrompt(memory, recentFacts, signals, prevMemory, conversation);
  }

  parseResponse(raw: string): EngineDecision {
    let cleaned = raw.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    try {
      const parsed = JSON.parse(cleaned);

      if (!parsed.action || typeof parsed.action !== "string") {
        throw new Error('Missing or invalid "action" field');
      }
      if (!parsed.reasoning || typeof parsed.reasoning !== "string") {
        throw new Error('Missing or invalid "reasoning" field');
      }

      const decision: EngineDecision = {
        action: parsed.action,
        reasoning: parsed.reasoning,
      };

      if (typeof parsed.price === "number" && parsed.price > 0) {
        decision.price = Math.round(parsed.price * 100);
      }
      if (parsed.non_price_terms && typeof parsed.non_price_terms === "object") {
        decision.non_price_terms = parsed.non_price_terms;
      }
      if (typeof parsed.tactic_used === "string") {
        decision.tactic_used = parsed.tactic_used;
      }
      if (typeof parsed.message === "string") {
        const trimmed = parsed.message.trim();
        if (trimmed.length > 0) decision.message = trimmed;
      }

      const est = parseOpponentEstimate(parsed.opponent_estimate);
      if (est) decision.opponent_estimate = est;

      return decision;
    } catch (err) {
      const actionMatch = cleaned.match(/"action"\s*:\s*"(\w+)"/);
      if (actionMatch) {
        return {
          action: actionMatch[1] as EngineDecision["action"],
          reasoning: `Parse recovery from malformed response: ${(err as Error).message}`,
        };
      }
      throw new Error(`Failed to parse LLM response: ${(err as Error).message}`);
    }
  }

  coachingLevel(): "DETAILED" | "STANDARD" | "LIGHT" {
    return "STANDARD";
  }
}

function parseOpponentEstimate(raw: unknown): OpponentEstimate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const oe = raw as Record<string, unknown>;
  const num01 = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : undefined;
  const time_pressure = num01(oe.time_pressure);
  const toughness = num01(oe.toughness);
  const confidence = num01(oe.confidence);
  if (time_pressure === undefined || toughness === undefined || confidence === undefined) {
    return undefined;
  }
  const est: OpponentEstimate = { time_pressure, toughness, confidence };
  if (typeof oe.est_reservation_price === "number" && oe.est_reservation_price > 0) {
    est.est_reservation_price = Math.round(oe.est_reservation_price * 100);
  }
  return est;
}
