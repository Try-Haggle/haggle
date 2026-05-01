/**
 * Live HTTP E2E for advisor memory -> negotiation demo.
 *
 * This test intentionally calls the running local API, the real DB, and the
 * real LLM provider. It is opt-in:
 *   RUN_LIVE_LLM_E2E_TESTS=1 pnpm --filter @haggle/api test -- src/__tests__/llm-memory-e2e-live.test.ts
 *
 * Why HTTP instead of createServer(): the Vitest setup mocks @haggle/db for
 * normal unit tests. Hitting the running API keeps this test honest.
 */

import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

dotenv.config({ path: resolve(import.meta.dirname, "../../../../.env") });
dotenv.config({ path: resolve(import.meta.dirname, "../../.env"), override: false });

const API_BASE = process.env.LIVE_API_BASE ?? "http://127.0.0.1:3001";
const shouldRunLive = process.env.RUN_LIVE_LLM_E2E_TESTS === "1" && !!process.env.XAI_API_KEY;
const describeLive = shouldRunLive ? describe : describe.skip;
const MAX_E2E_USD = Number(process.env.LIVE_LLM_E2E_MAX_USD ?? "0.08");

type AdvisorMemory = {
  categoryInterest: string;
  budgetMax?: number;
  targetPrice?: number;
  mustHave: string[];
  avoid: string[];
  riskStyle: "safe_first" | "balanced" | "lowest_price";
  negotiationStyle: "defensive" | "balanced" | "aggressive";
  openingTactic: "condition_anchor" | "fair_market_anchor" | "speed_close";
  questions: string[];
  source: string[];
};

type AdvisorTurnResponse = {
  memory: AdvisorMemory;
  reply: string;
  turn_cost: {
    tokens: { prompt: number; completion: number; total: number };
    estimated_usd: number;
  };
};

type MemoryCard = {
  card_type: string;
  memory_key: string;
  summary: string;
  memory: Record<string, unknown>;
  strength: string | number;
};

type MemoryResponse = {
  cards: MemoryCard[];
};

type NegotiationInitResponse = {
  demo_id: string;
  strategy: {
    target_price: number;
    floor_price: number;
    opening_tactic: string;
    approach: string;
    key_concerns: string[];
    negotiation_style: string;
  };
  hil_memory: {
    applied: boolean;
    cards: MemoryCard[];
  };
  pipeline: Array<{
    stage: string;
    user_prompt?: string;
    tokens?: { prompt: number; completion: number };
  }>;
  cost: {
    total_usd: number;
    total_tokens: { prompt: number; completion: number };
  };
};

type NegotiationRoundResponse = {
  round: number;
  phase: string;
  final: {
    decision: { action: string; price?: number; reasoning?: string; tactic_used?: string };
    rendered_message: string;
    hil_memory: { applied: boolean; cards: MemoryCard[] };
    validation: { passed: boolean; hard_passed: boolean };
  };
  cost: {
    round_usd: number;
    total_usd: number;
    round_tokens: { prompt: number; completion: number };
    total_tokens: { prompt: number; completion: number };
  };
};

describeLive("Live LLM memory E2E over HTTP", () => {
  it("has a real conversation, persists DB-backed memory, and uses it in negotiation", async () => {
    await expectApiHealthy();

    const userId = randomUUID();
    const agentId = "mia";
    let totalEstimatedUsd = 0;

    try {
      await deleteMemory(userId);

      const advisorMessage =
        "아이폰 15 프로 256GB 찾고 있어. 예산은 최대 500달러고, 배터리 90% 이상이고 언락 모델이면 좋아. 너무 끌지 말고 괜찮으면 빠르게 거래하고 싶어.";

      const advisorTurn = await postJson<AdvisorTurnResponse>("/intelligence/demo/advisor-turn", {
        user_id: userId,
        agent_id: agentId,
        message: advisorMessage,
        previous_memory: emptyAdvisorMemory(),
        listings: [
          {
            id: "live-e2e-iphone-15-pro",
            title: "iPhone 15 Pro 256GB Black",
            category: "electronics",
            condition: "battery 91%, unlocked, clean IMEI, light wear",
            askPriceMinor: 50_000,
            floorPriceMinor: 43_000,
            marketMedianMinor: 52_000,
            tags: ["electronics/phones/iphone", "electronics/phones/iphone/pro"],
            sellerNote: "Seller can close today if the buyer is decisive.",
          },
        ],
      });
      totalEstimatedUsd += advisorTurn.turn_cost.estimated_usd;

      expect(advisorTurn.reply.length).toBeGreaterThan(0);
      expect(advisorTurn.memory.categoryInterest.length).toBeGreaterThan(0);
      expect([advisorTurn.memory.categoryInterest, ...advisorTurn.memory.source].join(" ").toLowerCase()).toMatch(
        /iphone|아이폰/,
      );
      expect(advisorTurn.memory.budgetMax).toBe(500);
      expect(advisorTurn.memory.mustHave.join(" ").toLowerCase()).toMatch(/battery|배터리|unlock|언락/);

      await postJson("/intelligence/demo/advisor-memory", {
        user_id: userId,
        agent_id: agentId,
        message: advisorMessage,
        memory: advisorTurn.memory,
      });

      const storedMemory = await getJson<MemoryResponse>(`/intelligence/demo/memory?user_id=${userId}`);
      const memoryKeys = storedMemory.cards.map((card) => card.memory_key);
      expect(memoryKeys).toContain("advisor:category_interest");
      expect(memoryKeys).toContain("advisor:risk_and_tactic");
      expect(memoryKeys).toContain("advisor:budget_model");
      expect(memoryKeys).toContain("advisor:must_have");

      const init = await postJson<NegotiationInitResponse>("/negotiations/demo/init", {
        user_id: userId,
        language: "ko",
        preset: "balanced",
        buyer_agent_id: agentId,
        seller_agent_id: "dealer_hana",
        item: {
          title: "iPhone 15 Pro 256GB Black",
          condition: "battery 91%, unlocked, clean IMEI, light wear",
          swappa_median_minor: 52_000,
        },
        seller: {
          ask_price_minor: 50_000,
          floor_price_minor: 43_000,
        },
        buyer_budget: {
          max_budget_minor: 50_000,
        },
      });
      totalEstimatedUsd += init.cost.total_usd;

      expect(init.demo_id).toMatch(/^demo_/);
      expect(init.hil_memory.applied).toBe(true);
      expect(init.hil_memory.cards.length).toBeGreaterThanOrEqual(3);
      expect(JSON.stringify(init.hil_memory)).toMatch(/budget|battery|unlock|배터리|언락/i);
      expect(init.pipeline.map((stage) => stage.stage)).toEqual([
        "0a_STRATEGY_GENERATION",
        "0b_TERM_ANALYSIS",
      ]);
      expect(init.pipeline[0]?.user_prompt).toContain("Stored HIL Memory");
      expect(init.cost.total_tokens.prompt + init.cost.total_tokens.completion).toBeGreaterThan(0);

      const round = await postJson<NegotiationRoundResponse>(`/negotiations/demo/${init.demo_id}/round`, {
        seller_price_minor: 48_000,
        seller_message:
          "I can do $480 if we close today. Battery health is 91%, it is unlocked, and the IMEI is clean.",
      });
      totalEstimatedUsd = advisorTurn.turn_cost.estimated_usd + round.cost.total_usd;

      expect(round.round).toBe(1);
      expect(round.final.rendered_message.length).toBeGreaterThan(0);
      expect(round.final.validation.hard_passed).toBe(true);
      expect(round.final.hil_memory.applied).toBe(true);
      expect(round.final.decision.action).toMatch(/ACCEPT|COUNTER|CONFIRM|REJECT|HOLD/);
      expect(round.cost.round_tokens.prompt + round.cost.round_tokens.completion).toBeGreaterThan(0);

      console.info(
        "[live-llm-memory-e2e]",
        JSON.stringify({
          user_id: userId,
          cards_saved: storedMemory.cards.map((card) => ({
            key: card.memory_key,
            summary: card.summary,
          })),
          advisor_turn_cost_usd: advisorTurn.turn_cost.estimated_usd,
          negotiation_total_cost_usd: round.cost.total_usd,
          estimated_total_usd: Number(totalEstimatedUsd.toFixed(8)),
          init_strategy: init.strategy,
          round_decision: round.final.decision,
          rendered_message: round.final.rendered_message,
        }),
      );

      expect(totalEstimatedUsd).toBeLessThanOrEqual(MAX_E2E_USD);
    } finally {
      await deleteMemory(userId);
      const remaining = await getJson<MemoryResponse>(`/intelligence/demo/memory?user_id=${userId}`);
      expect(remaining.cards).toHaveLength(0);
    }
  }, 180_000);
});

function emptyAdvisorMemory(): AdvisorMemory {
  return {
    categoryInterest: "electronics",
    mustHave: [],
    avoid: [],
    riskStyle: "balanced",
    negotiationStyle: "balanced",
    openingTactic: "fair_market_anchor",
    questions: [],
    source: [],
  };
}

async function expectApiHealthy(): Promise<void> {
  const response = await fetch(`${API_BASE}/health`);
  expect(response.status, `API health check failed at ${API_BASE}/health`).toBe(200);
}

async function deleteMemory(userId: string): Promise<void> {
  await fetchJson(`/intelligence/demo/memory?user_id=${userId}`, { method: "DELETE" });
}

async function getJson<T>(path: string): Promise<T> {
  return fetchJson<T>(path, { method: "GET" });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fetchJson<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${init.method ?? "GET"} ${path}: ${text.slice(0, 2000)}`);
  }

  return text ? (JSON.parse(text) as T) : (undefined as T);
}
