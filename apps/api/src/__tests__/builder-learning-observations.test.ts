/**
 * Feature ② observation source (`collectLearningObservations`, exercised through
 * `processNegotiationAgentBuilderTurn`).
 *
 * The failure mode this guards against: recording OUR OWN planner questions as evidence
 * that the taxonomy is missing a check. "대략적인 예산 범위는 어느 정도인가요?" is asked on
 * essentially every first turn, so it would clear the promotion thresholds within two
 * listings, become a permanent "learned check", and then re-observe itself every turn.
 * Only the model's genuine long-tail questions may be recorded.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { callLLMMock } = vi.hoisted(() => ({ callLLMMock: vi.fn() }));
vi.mock("../negotiation/adapters/deepseek-client.js", () => ({ callLLM: callLLMMock }));

import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
} from "../services/negotiation-agent-builder-chat.service.js";

const LISTING = {
  id: "listing-1",
  title: "iPhone 15 Pro 256GB",
  category: "electronics",
  condition: "good",
  askPriceMinor: 90000,
  floorPriceMinor: 80000,
  marketMedianMinor: 90000,
  tags: ["iphone", "256gb"],
};

const PREVIOUS_MEMORY = {
  categoryInterest: "탐색 중",
  mustHave: [],
  avoid: [],
  riskStyle: "balanced" as const,
  negotiationStyle: "balanced" as const,
  openingTactic: "fair_market_anchor" as const,
  questions: [],
  source: [],
};

/** Parse through the REAL body schema so defaults match the production route exactly. */
function parseInput(body: Record<string, unknown>) {
  return negotiationAgentBuilderTurnBodySchema.parse(body);
}

function mockLLM(questions: string[]) {
  callLLMMock.mockResolvedValueOnce({
    content: JSON.stringify({
      memory: { ...PREVIOUS_MEMORY, questions },
      reply: "알겠습니다.",
      reasoning_summary: "test",
    }),
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    reasoning_used: false,
  });
}

async function runTurn(questions: string[], listing = LISTING) {
  mockLLM(questions);
  const result = await processNegotiationAgentBuilderTurn(
    parseInput({
      user_id: "11111111-1111-4111-8111-111111111111",
      agent_id: "verifier",
      message: "아이폰 찾고 있어요",
      previous_memory: PREVIOUS_MEMORY,
      listings: [listing],
    }),
  );
  return result.learning_observations ?? [];
}

beforeEach(() => vi.clearAllMocks());

describe("collectLearningObservations — only genuine taxonomy gaps", () => {
  it("records a long-tail question the taxonomy has no check for", async () => {
    const observations = await runTurn(["정품 충전기와 박스가 함께 있나요?"]);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.questionKo).toBe("정품 충전기와 박스가 함께 있나요?");
    expect(observations[0]?.sourceId).toBe("listing-1");
  });

  it("attributes to the MOST SPECIFIC taxonomy path, not the bare category", async () => {
    // An iPhone question must not be learned onto every electronics listing.
    const observations = await runTurn(["정품 충전기와 박스가 함께 있나요?"]);
    expect(observations[0]?.categoryPath).toBe("electronics/phones/iphone");
  });

  it("does NOT record a question the taxonomy scaffold already asks", async () => {
    // buyerAskKo of the iPhone IMEI gate — already covered by the taxonomy.
    const observations = await runTurn([
      "Should the agent require a clean IMEI (not lost/blacklisted) before closing?",
    ]);
    expect(observations).toEqual([]);
  });

  it("does NOT record our own planner questions (the self-reinforcing trap)", async () => {
    // A universal buyer slot — asked on nearly every first turn.
    const observations = await runTurn(["대략적인 예산 범위는 어느 정도인가요?"]);
    expect(observations).toEqual([]);
  });

  it("dedupes repeated questions inside one turn", async () => {
    const q = "정품 충전기와 박스가 함께 있나요?";
    const observations = await runTurn([q, q, ` ${q} `]);
    expect(observations).toHaveLength(1);
  });

  it("falls back to tag scopes when the listing resolves no taxonomy path", async () => {
    // "other" is not a taxonomy node. Dropping these was the whole long tail — a brass
    // telescope could be asked about forever and never learn anything.
    const observations = await runTurn(["렌즈에 흠집이나 곰팡이가 있나요?"], {
      ...LISTING,
      category: "other",
      tags: ["brass-telescope"],
    });
    expect(observations).toHaveLength(1);
    expect(observations[0]?.categoryPath).toBe("tag:brass-telescope");
  });

  it("records one row per candidate tag rather than guessing the item type", async () => {
    // Any single pick from ["vintage","brass-telescope","1900s"] is arbitrary; the
    // promotion thresholds decide which scope recurs across distinct listings.
    const observations = await runTurn(["렌즈에 흠집이나 곰팡이가 있나요?"], {
      ...LISTING,
      category: "other",
      tags: ["vintage", "brass-telescope", "1900s"],
    });
    expect(observations.map((o) => o.categoryPath)).toEqual([
      "tag:vintage",
      "tag:brass-telescope",
      "tag:1900s",
    ]);
  });

  it("records nothing when there is no tag to key on either", async () => {
    // Only a generic bucket — a row scoped to "other" would pool a telescope's
    // questions with a ceramic vase's and serve each to the other.
    const observations = await runTurn(["뭔가 특이한 질문?"], {
      ...LISTING,
      category: "other",
      tags: [],
    });
    expect(observations).toEqual([]);
  });

  it("still attributes a taxonomy hit to its most specific node only", async () => {
    // The tag fallback must not fan a matched listing out across its tags.
    const observations = await runTurn(["정품 충전기와 박스가 함께 있나요?"]);
    expect(observations.map((o) => o.categoryPath)).toEqual(["electronics/phones/iphone"]);
  });

  it("records nothing without listing context", async () => {
    mockLLM(["질문?"]);
    const result = await processNegotiationAgentBuilderTurn(
      parseInput({
        user_id: "11111111-1111-4111-8111-111111111111",
        agent_id: "verifier",
        message: "hi",
        previous_memory: PREVIOUS_MEMORY,
        listings: [],
      }),
    );
    expect(result.learning_observations).toEqual([]);
  });
});
