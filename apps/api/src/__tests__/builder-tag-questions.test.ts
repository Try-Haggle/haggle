import { buildBuyerChoiceQuestions, buildCategoryCriteriaScaffold } from "@haggle/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callLLMMock = vi.hoisted(() => vi.fn());
vi.mock("@haggle/db", () => ({ sql: vi.fn() }));
vi.mock("../negotiation/adapters/deepseek-client.js", () => ({ callLLM: callLLMMock }));

import {
  negotiationAgentBuilderTurnBodySchema,
  processNegotiationAgentBuilderTurn,
} from "../services/negotiation-agent-builder-chat.service.js";
import { buildAdvisorRequirementPlan } from "../services/tag-garden-requirements.js";

const listing = {
  id: "phone-1",
  title: "iPhone 15 Pro",
  category: "electronics",
  condition: "good",
  tags: ["iphone-15-pro"],
  askPriceMinor: 85000,
  floorPriceMinor: 80000,
  marketMedianMinor: 85000,
};
const choices = buildBuyerChoiceQuestions([listing.category, ...listing.tags]);
const baseMemory = negotiationAgentBuilderTurnBodySchema.parse({
  message: "test",
  previous_memory: {
    categoryInterest: listing.title,
    budgetMax: 850,
    targetPrice: 680,
    mustHave: [],
    avoid: [],
    riskStyle: "balanced",
    negotiationStyle: "aggressive",
    openingTactic: "fair_market_anchor",
    source: [],
    questions: [],
  },
}).previous_memory;

async function turn(overrides: Record<string, unknown> = {}) {
  callLLMMock.mockResolvedValueOnce({
    content: JSON.stringify({
      memory: baseMemory,
      reply: "Your budget is saved. 배터리는 90% 이상인가요? 언락 모델이 필수인가요?",
    }),
    finish_reason: "stop",
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
  return processNegotiationAgentBuilderTurn(
    negotiationAgentBuilderTurnBodySchema.parse({
      side: "buyer",
      message: "My target price is $680, and my max budget is $850.",
      previous_memory: baseMemory,
      listings: [listing],
      ...overrides,
    }),
  );
}

beforeEach(() => callLLMMock.mockReset());

describe("listing-tag question contract", () => {
  it("keeps mandatory and preference choices identical to the shared taxonomy across categories", () => {
    for (const tags of [
      ["electronics", "iphone-15-pro"],
      ["vehicles", "sedan"],
      ["fashion", "sneakers"],
      ["electronics", "airpods"],
    ]) {
      const plan = buildAdvisorRequirementPlan({
        memory: baseMemory,
        listings: [{ ...listing, category: tags[0], tags }],
      });
      for (const question of buildBuyerChoiceQuestions(tags)) {
        expect(plan.requiredSlots.find((s) => s.slotId === question.checkId)).toMatchObject({
          questionKo: question.question,
          enforcement: question.enforcement,
          answerOptions: question.options.map((o) => o.label),
        });
      }
    }
  });

  it("routes the budget reply to the first mandatory choice and removes duplicate model questions", async () => {
    const result = await turn();
    expect(result.quick_setup_check_id).toBe("imei_verification");
    expect(result.memory.questions).toEqual([]);
    expect(result.reply).toContain("Your budget is saved.");
    expect(result.reply).toContain("Quick Setup");
    expect(result.reply).not.toMatch(/배터리|언락|\?/);
    expect(result.tag_requirements.blockingSlots.map((s) => s.slotId)).toEqual([
      "imei_verification",
      "financing_paid_off",
      "water_damage",
      "find_my_status",
    ]);
    expect(callLLMMock.mock.calls[0]?.[1]).toContain(
      "do not ask these in reply or memory.questions",
    );
  });

  it("preserves tapped stances omitted by the model before deciding the next choice", async () => {
    const first = choices[0]!;
    const criterion = {
      ...buildCategoryCriteriaScaffold(listing.tags).find((c) => c.checkId === first.checkId)!,
      stance: first.options[0]!.stance,
    };
    const result = await turn({
      previous_memory: { ...baseMemory, categoryCriteria: [criterion] },
    });
    expect(result.memory.categoryCriteria.find((c) => c.checkId === first.checkId)?.stance).toBe(
      criterion.stance,
    );
    expect(result.quick_setup_check_id).toBe("financing_paid_off");
    expect(result.tag_requirements.blockingSlots.map((s) => s.slotId)).not.toContain(first.checkId);
  });

  it("uses the exact inherited free-text check after hard choices, without leaking model choice questions", async () => {
    const criteria = buildCategoryCriteriaScaffold(listing.tags)
      .filter((c) => c.enforcement === "hard")
      .map((c) => ({ ...c, stance: "answered" }));
    const result = await turn({ previous_memory: { ...baseMemory, categoryCriteria: criteria } });
    expect(result.memory.questions).toEqual([
      "Should the agent only consider fully working units?",
    ]);
    expect(result.reply).toContain(result.memory.questions[0]);
    expect(result.reply).not.toMatch(/배터리|언락/);
  });

  it("accepts every canonical answer including Any without manufacturing additional hard gates", async () => {
    const criteria = buildCategoryCriteriaScaffold(listing.tags).map((c) => ({
      ...c,
      stance:
        choices.find((q) => q.checkId === c.checkId)?.options.at(-1)?.stance ?? "no preference",
    }));
    const result = await turn({ previous_memory: { ...baseMemory, categoryCriteria: criteria } });
    expect(result.tag_requirements.missingSlots.filter((s) => s.tagPath === "taxonomy")).toEqual(
      [],
    );
    expect(result.tag_requirements.hasBlockingMissingSlots).toBe(false);
    expect(result.quick_setup_check_id).toBeUndefined();
    expect(result.reply).not.toMatch(/배터리|언락|\?/);
    expect(
      result.memory.categoryCriteria.find((c) => c.checkId === "battery_health"),
    ).toMatchObject({
      enforcement: "soft",
      requirement: "optional",
      stance: "no battery-health minimum",
    });
  });

  it("focuses a seller-required soft check in the same choice UI", async () => {
    const criteria = buildCategoryCriteriaScaffold(listing.tags).map((c) => ({
      ...c,
      stance: c.checkId === "storage_capacity" ? undefined : "answered",
    }));
    const result = await turn({
      previous_memory: { ...baseMemory, categoryCriteria: criteria },
      seller_required_criteria: [
        { checkId: "storage_capacity", ask: "Model-invented storage question?" },
      ],
    });
    expect(result.quick_setup_check_id).toBe("storage_capacity");
    expect(result.memory.questions).toEqual([]);
    expect(result.reply).not.toContain("Model-invented");
  });

  it("does not open phone gates from chat text when the listing tags identify an accessory", () => {
    const plan = buildAdvisorRequirementPlan({
      memory: { ...baseMemory, categoryInterest: "iPhone with clean IMEI" },
      listings: [{ ...listing, title: "AirPods", tags: ["airpods"] }],
    });
    expect(plan.requiredSlots.map((s) => s.slotId)).not.toContain("imei_verification");
    expect(plan.matchedTags).not.toContain("electronics/phones/iphone");
  });
});
