/**
 * Live LLM memory-behavior test.
 *
 * This test intentionally calls the real xAI API, so it is opt-in:
 *   RUN_LIVE_LLM_TESTS=1 XAI_API_KEY=... pnpm --filter @haggle/api test -- src/__tests__/llm-memory-live.test.ts
 *
 * It verifies that different seller memories produce different negotiation
 * recommendations for the same listing/offer, while tracking estimated cost.
 */

import { describe, expect, it } from "vitest";
import dotenv from "dotenv";
import { resolve } from "node:path";
import { callLLM } from "../negotiation/adapters/xai-client.js";

dotenv.config({ path: resolve(import.meta.dirname, "../../../../.env") });
dotenv.config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

const shouldRunLive = process.env.RUN_LIVE_LLM_TESTS === "1" && !!process.env.XAI_API_KEY;
const describeLive = shouldRunLive ? describe : describe.skip;

const USD_PER_1K_TOKENS = Number(process.env.LIVE_LLM_TEST_USD_PER_1K ?? "0.0015");
const MAX_TEST_USD = Number(process.env.LIVE_LLM_TEST_MAX_USD ?? "0.02");

type MemoryRecommendation = {
  action: "COUNTER" | "ACCEPT" | "REJECT" | "HOLD";
  counter_price_minor?: number;
  accepted_price_minor?: number;
  reasoning: string;
};

type MemoryComparisonResponse = {
  fast_close: MemoryRecommendation;
  price_protect: MemoryRecommendation;
  comparison: string;
};

describeLive("Live LLM memory behavior", () => {
  it("changes the negotiation recommendation when only seller memory changes", async () => {
    const response = await callLLM(
      [
        "You are a negotiation strategy evaluator for Haggle.",
        "Return ONLY valid JSON.",
        "Use cents for all prices.",
        "For the same listing and buyer offer, compare two seller memories.",
        "The price_protect memory must protect price more than the fast_close memory unless the offer is already at target.",
      ].join("\n"),
      [
        "Listing:",
        "- item: iPhone 15 Pro 256GB Black",
        "- seller target price: 50000 cents",
        "- seller floor price: 43000 cents",
        "- buyer offer: 45000 cents",
        "- selling deadline: 36 hours from now",
        "",
        "Memory A, fast_close:",
        "- seller prefers quick liquidation",
        "- seller accepts reasonable committed buyers",
        "- seller is willing to trade some price for speed",
        "",
        "Memory B, price_protect:",
        "- seller strongly protects asking price",
        "- seller dislikes early concessions",
        "- seller would rather wait than train buyers to expect discounts",
        "",
        "Return exactly this JSON shape:",
        "{",
        '  "fast_close": {"action":"COUNTER|ACCEPT|REJECT|HOLD","counter_price_minor":number optional,"accepted_price_minor":number optional,"reasoning":"string"},',
        '  "price_protect": {"action":"COUNTER|ACCEPT|REJECT|HOLD","counter_price_minor":number optional,"accepted_price_minor":number optional,"reasoning":"string"},',
        '  "comparison":"string"',
        "}",
      ].join("\n"),
      {
        maxTokens: 350,
        correlationId: "live-llm-memory-behavior",
      },
    );

    const parsed = JSON.parse(response.content) as MemoryComparisonResponse;
    const fastPrice = effectiveRecommendedPrice(parsed.fast_close);
    const protectPrice = effectiveRecommendedPrice(parsed.price_protect);
    const totalTokens = response.usage.prompt_tokens + response.usage.completion_tokens;
    const estimatedUsd = estimateUsd(totalTokens);

    console.info(
      "[live-llm-memory-test]",
      JSON.stringify({
        model: process.env.XAI_MODEL ?? "grok-4-fast",
        prompt_tokens: response.usage.prompt_tokens,
        completion_tokens: response.usage.completion_tokens,
        total_tokens: totalTokens,
        estimated_usd: estimatedUsd,
        max_usd: MAX_TEST_USD,
        fast_close: parsed.fast_close,
        price_protect: parsed.price_protect,
      }),
    );

    expect(parsed.fast_close.reasoning.length).toBeGreaterThan(0);
    expect(parsed.price_protect.reasoning.length).toBeGreaterThan(0);
    expect(fastPrice).toBeGreaterThanOrEqual(43_000);
    expect(protectPrice).toBeGreaterThanOrEqual(43_000);
    expect(protectPrice).toBeGreaterThan(fastPrice);
    expect(estimatedUsd).toBeLessThanOrEqual(MAX_TEST_USD);
  }, 60_000);
});

function effectiveRecommendedPrice(recommendation: MemoryRecommendation): number {
  if (typeof recommendation.counter_price_minor === "number") return recommendation.counter_price_minor;
  if (typeof recommendation.accepted_price_minor === "number") return recommendation.accepted_price_minor;
  throw new Error(`Recommendation has no effective price: ${JSON.stringify(recommendation)}`);
}

function estimateUsd(totalTokens: number): number {
  return Number(((totalTokens / 1000) * USD_PER_1K_TOKENS).toFixed(6));
}
