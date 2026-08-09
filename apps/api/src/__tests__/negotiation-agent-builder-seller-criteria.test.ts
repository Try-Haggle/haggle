/**
 * G-SELLER (Phase G) — the seller builder elicits per-item category criteria and
 * stores them structured (checkId-keyed). Two layers of coverage:
 *   1. reconcileCategoryCriteria — the deterministic seam (pure, golden).
 *   2. processNegotiationAgentBuilderTurn seller path — the LLM is mocked so we
 *      verify the wiring: scaffold from the listing, reconcile keeps the taxonomy
 *      authoritative, stances persist, standalone (no listing) stays empty.
 */

import type { CategoryCriterion } from "@haggle/shared";
import { describe, expect, it, vi } from "vitest";

const callLLMMock = vi.hoisted(() => vi.fn());

vi.mock("@haggle/db", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    raw: strings.join("?"),
    values,
  }),
}));

vi.mock("../negotiation/adapters/deepseek-client.js", () => ({
  callLLM: callLLMMock,
}));

import { extractSellerRequiredCriteria } from "../services/listing-strategy.service.js";
import {
  processNegotiationAgentBuilderTurn,
  reconcileCategoryCriteria,
} from "../services/negotiation-agent-builder-chat.service.js";

/** Minimal seller builder memory. */
function memory(overrides: Record<string, unknown> = {}) {
  return {
    categoryInterest: "selling my car",
    mustHave: [],
    avoid: [],
    dealBreakers: [],
    mustEmphasize: [],
    notes: [],
    categoryCriteria: [],
    riskStyle: "balanced" as const,
    negotiationStyle: "balanced" as const,
    openingTactic: "fair_market_anchor" as const,
    questions: [],
    source: [],
    ...overrides,
  };
}

const VEHICLE_LISTING = {
  id: "veh-1",
  title: "2019 Honda Civic",
  category: "vehicles",
  condition: "used",
  askPriceMinor: 1_500_000,
  floorPriceMinor: 1_300_000,
  marketMedianMinor: 1_500_000,
  tags: ["honda", "civic", "sedan"],
};

/** Make callLLM return a builder JSON body with the given memory patch. */
function mockLLMReturn(memoryPatch: Record<string, unknown>, reply = "Noted.") {
  callLLMMock.mockResolvedValueOnce({
    content: JSON.stringify({
      memory: {
        categoryInterest: "selling my car",
        mustHave: [],
        avoid: [],
        dealBreakers: [],
        mustEmphasize: [],
        notes: [],
        categoryCriteria: [],
        riskStyle: "balanced",
        negotiationStyle: "balanced",
        openingTactic: "fair_market_anchor",
        questions: [],
        source: [],
        ...memoryPatch,
      },
      reply,
      reasoning_summary: "",
    }),
    finish_reason: "stop",
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
}

describe("reconcileCategoryCriteria (deterministic seam)", () => {
  const scaffold: CategoryCriterion[] = [
    {
      checkId: "title_status",
      questionKo: "명의/소유권(등록증)이 명확한가요?",
      buyerAskKo: "Should the agent only consider clean-title vehicles?",
      enforcement: "hard",
      requirement: "required",
    },
    {
      checkId: "mileage",
      questionKo: "주행거리는 얼마인가요?",
      buyerAskKo: "What maximum mileage do you want?",
      enforcement: "soft",
      requirement: "optional",
    },
  ];

  it("takes requirement + stance from the LLM but keeps the scaffold's id/question/enforcement", () => {
    const llmReturned: CategoryCriterion[] = [
      {
        // LLM tampered with everything except checkId — reconcile must ignore the
        // tampering and re-author from the scaffold.
        checkId: "title_status",
        questionKo: "HACKED",
        enforcement: "soft",
        requirement: "required",
        stance: "clean title, in hand",
      },
    ];
    const result = reconcileCategoryCriteria(scaffold, llmReturned, []);
    const title = result.find((c) => c.checkId === "title_status");
    expect(title?.questionKo).toBe("명의/소유권(등록증)이 명확한가요?"); // scaffold wins
    expect(title?.enforcement).toBe("hard"); // scaffold wins
    expect(title?.requirement).toBe("required"); // from LLM
    expect(title?.stance).toBe("clean title, in hand"); // from LLM, trimmed
  });

  it("PINS a hard-enforcement check to required — the LLM cannot downgrade a safety gate", () => {
    // A taxonomy hard check (clean title) is a deterministic safety gate. Even if the
    // builder LLM tries to mark it optional, reconcile keeps it required so the buyer
    // is still paused about it mid-negotiation. This was the real bug: a hard
    // clean-title got stored optional → the PAUSE never fired.
    // Partial LLM shape (checkId + requirement + stance) — reconcile re-authors the rest.
    const result = reconcileCategoryCriteria(
      scaffold,
      [{ checkId: "title_status", requirement: "optional", stance: "clean" }],
      [],
    );
    expect(result.find((c) => c.checkId === "title_status")?.requirement).toBe("required");
  });

  it("does NOT pin a soft check — the party may keep it optional OR escalate to required", () => {
    const asOptional = reconcileCategoryCriteria(
      scaffold,
      [{ checkId: "mileage", requirement: "optional" }],
      [],
    );
    expect(asOptional.find((c) => c.checkId === "mileage")?.requirement).toBe("optional");
    const escalated = reconcileCategoryCriteria(
      scaffold,
      [{ checkId: "mileage", requirement: "required" }],
      [],
    );
    expect(escalated.find((c) => c.checkId === "mileage")?.requirement).toBe("required");
  });

  it("drops LLM-invented check ids not in the scaffold", () => {
    const llmReturned: CategoryCriterion[] = [
      { checkId: "totally_made_up", questionKo: "x", enforcement: "hard", requirement: "required" },
    ];
    const result = reconcileCategoryCriteria(scaffold, llmReturned, []);
    expect(result.map((c) => c.checkId).sort()).toEqual(["mileage", "title_status"]);
  });

  it("carries a previous stance forward when the LLM omits it this turn", () => {
    const previous: CategoryCriterion[] = [
      {
        checkId: "title_status",
        questionKo: "명의/소유권(등록증)이 명확한가요?",
        enforcement: "hard",
        requirement: "required",
        stance: "clean, verified",
      },
    ];
    const result = reconcileCategoryCriteria(scaffold, undefined, previous);
    expect(result.find((c) => c.checkId === "title_status")?.stance).toBe("clean, verified");
  });

  it("returns [] for an empty scaffold (standalone agent, no listing)", () => {
    expect(
      reconcileCategoryCriteria([], [{ checkId: "title_status" } as CategoryCriterion], []),
    ).toEqual([]);
  });
});

describe("seller builder turn — category criteria wiring", () => {
  it("scaffolds the vehicle's checks and reconciles the LLM's requirement/stance", async () => {
    mockLLMReturn({
      categoryCriteria: [
        { checkId: "title_status", requirement: "required", stance: "clean title, in hand" },
        { checkId: "mileage", requirement: "optional", stance: "42,000 miles" },
      ],
    });

    const result = await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "Title is clean and in hand, 42k miles.",
      previous_memory: memory(),
      listings: [VEHICLE_LISTING],
    });

    const byId = new Map(result.memory.categoryCriteria.map((c) => [c.checkId, c]));
    // Every taxonomy check for vehicles is present (title, mileage, service_history).
    expect(byId.has("title_status")).toBe(true);
    expect(byId.has("mileage")).toBe(true);
    expect(byId.has("service_history")).toBe(true);
    // Answered ones carry the seller's stance + requirement.
    expect(byId.get("title_status")?.requirement).toBe("required");
    expect(byId.get("title_status")?.stance).toBe("clean title, in hand");
    expect(byId.get("mileage")?.stance).toBe("42,000 miles");
    // Unanswered check keeps its default requirement and no stance.
    expect(byId.get("service_history")?.stance).toBeUndefined();
    // questionKo comes from the taxonomy, never from the LLM.
    expect(byId.get("title_status")?.questionKo).toBe("명의/소유권(등록증)이 명확한가요?");
  });

  it("tolerates the LLM returning an empty/invalid requirement (coerces, no 502)", async () => {
    // Real DeepSeek output sometimes has requirement:"" — the schema must coerce it
    // instead of throwing a ZodError that fails the whole turn.
    mockLLMReturn({
      categoryCriteria: [
        { checkId: "title_status", requirement: "", stance: "clean" },
        { checkId: "mileage", requirement: "garbage", stance: "42k" },
        { checkId: "service_history", requirement: "" },
      ],
    });
    const result = await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "Clean title, 42k miles.",
      previous_memory: memory(),
      listings: [VEHICLE_LISTING],
    });
    const byId = new Map(result.memory.categoryCriteria.map((c) => [c.checkId, c]));
    // title_status is a HARD taxonomy check → reconcile defaults it to required.
    expect(byId.get("title_status")?.requirement).toBe("required");
    expect(byId.get("title_status")?.stance).toBe("clean");
    // mileage is soft → invalid "garbage" coerces to optional.
    expect(byId.get("mileage")?.requirement).toBe("optional");
    expect(byId.get("mileage")?.stance).toBe("42k");
  });

  it("persists a stance across turns even if the next turn's LLM omits it", async () => {
    // Turn 1: seller states the title.
    mockLLMReturn({
      categoryCriteria: [{ checkId: "title_status", requirement: "required", stance: "clean" }],
    });
    const turn1 = await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "Clean title.",
      previous_memory: memory(),
      listings: [VEHICLE_LISTING],
    });
    expect(turn1.memory.categoryCriteria.find((c) => c.checkId === "title_status")?.stance).toBe(
      "clean",
    );

    // Turn 2: LLM returns no categoryCriteria — the prior stance must survive.
    mockLLMReturn({ categoryCriteria: [] });
    const turn2 = await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "What else?",
      previous_memory: turn1.memory,
      listings: [VEHICLE_LISTING],
    });
    expect(turn2.memory.categoryCriteria.find((c) => c.checkId === "title_status")?.stance).toBe(
      "clean",
    );
  });

  it("keeps categoryCriteria empty for a standalone seller agent (no listing)", async () => {
    mockLLMReturn({
      // Even if the LLM hallucinates criteria, no listing → no scaffold → dropped.
      categoryCriteria: [{ checkId: "title_status", requirement: "required", stance: "x" }],
    });
    const result = await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "I sell electronics, hold firm.",
      previous_memory: memory(),
      listings: [],
    });
    expect(result.memory.categoryCriteria).toEqual([]);
  });
});

describe("buyer builder turn — mirrors the seller's required criteria (Flow 2)", () => {
  it("flags [SELLER REQUIRES] in the prompt and reconciles the buyer's stances", async () => {
    mockLLMReturn({
      categoryInterest: "buying a car",
      categoryCriteria: [
        { checkId: "title_status", requirement: "required", stance: "clean only" },
        { checkId: "service_history", requirement: "optional", stance: "nice to have" },
      ],
    });

    const result = await processNegotiationAgentBuilderTurn({
      side: "buyer",
      // The seller requires a clean title + service history for this listing.
      seller_required_criteria: [
        { checkId: "title_status", ask: "Should the agent only consider clean-title vehicles?" },
        { checkId: "service_history", ask: "Do you want vehicles with service history?" },
      ],
      message: "Clean title is a must; service history would be nice.",
      previous_memory: memory({ categoryInterest: "buying a car" }),
      listings: [VEHICLE_LISTING],
    });

    // The buyer's structured criteria are reconciled (scaffold-authoritative).
    const byId = new Map(result.memory.categoryCriteria.map((c) => [c.checkId, c]));
    expect(byId.get("title_status")?.stance).toBe("clean only");
    expect(byId.get("title_status")?.requirement).toBe("required");
    expect(byId.get("service_history")?.stance).toBe("nice to have");

    // The system prompt surfaces the seller-required checks with a buyer-framed ask
    // and the [SELLER REQUIRES] flag so the LLM mirrors them.
    const systemPrompt = callLLMMock.mock.calls.at(-1)?.[0] as string;
    expect(systemPrompt).toContain("[SELLER REQUIRES]");
    expect(systemPrompt).toContain("Should the agent only consider clean-title vehicles?");
  });

  it("DETERMINISTICALLY asks the buyer about an unaddressed seller requirement (Flow 2 mirror)", async () => {
    // The LLM volunteers nothing about the seller's requirement; the deterministic
    // mirror must still force the buyer to be asked (ask-once).
    mockLLMReturn({ categoryInterest: "buying a car", budgetMax: 15000, mustHave: ["reliable"] });
    const result = await processNegotiationAgentBuilderTurn({
      side: "buyer",
      seller_required_criteria: [
        { checkId: "title_status", ask: "Should the agent only consider clean-title vehicles?" },
      ],
      message: "Budget is $15k, want something reliable.",
      previous_memory: memory({ categoryInterest: "buying a car", budgetMax: 15000 }),
      listings: [VEHICLE_LISTING],
    });
    // The buyer is asked the seller's required check even though the LLM didn't.
    expect(result.memory.questions).toContain(
      "Should the agent only consider clean-title vehicles?",
    );
  });

  it("does NOT re-ask a seller requirement the buyer already answered", async () => {
    mockLLMReturn({
      categoryInterest: "buying a car",
      budgetMax: 15000,
      categoryCriteria: [
        { checkId: "title_status", requirement: "required", stance: "clean only" },
      ],
    });
    const result = await processNegotiationAgentBuilderTurn({
      side: "buyer",
      seller_required_criteria: [
        { checkId: "title_status", ask: "Should the agent only consider clean-title vehicles?" },
      ],
      message: "Clean title only, please.",
      previous_memory: memory({ categoryInterest: "buying a car", budgetMax: 15000 }),
      listings: [VEHICLE_LISTING],
    });
    expect(result.memory.questions).not.toContain(
      "Should the agent only consider clean-title vehicles?",
    );
  });

  it("does not leak the seller-required flag onto a standalone buyer agent (no listing)", async () => {
    mockLLMReturn({ categoryInterest: "reusable buyer agent" });
    const result = await processNegotiationAgentBuilderTurn({
      side: "buyer",
      seller_required_criteria: [{ checkId: "title_status", ask: "clean title?" }],
      message: "I usually buy safe.",
      previous_memory: memory({ categoryInterest: "reusable buyer agent" }),
      listings: [],
    });
    // No listing → no scaffold → no structured criteria, and no criteria block.
    expect(result.memory.categoryCriteria).toEqual([]);
    const systemPrompt = callLLMMock.mock.calls.at(-1)?.[0] as string;
    expect(systemPrompt).not.toContain("[SELLER REQUIRES]");
  });
});

describe("extractSellerRequiredCriteria (buyer-safe projection)", () => {
  it("exposes only REQUIRED criteria as {checkId, ask}, hiding stance/optional", () => {
    const snapshot = {
      negotiationAgentBuilderMemory: {
        categoryCriteria: [
          {
            checkId: "title_status",
            questionKo: "명의/소유권(등록증)이 명확한가요?",
            buyerAskKo: "Should the agent only consider clean-title vehicles?",
            enforcement: "hard",
            requirement: "required",
            stance: "clean title, in hand", // must NOT be exposed
          },
          {
            checkId: "mileage",
            questionKo: "주행거리는 얼마인가요?",
            buyerAskKo: "What maximum mileage do you want?",
            enforcement: "soft",
            requirement: "optional", // must NOT be exposed (optional)
            stance: "42k",
          },
          {
            // required but NO stance — the scaffold's auto-default the seller never
            // engaged; must NOT be exposed.
            checkId: "service_history",
            questionKo: "정비 이력이 있나요?",
            buyerAskKo: "Do you want vehicles with service history?",
            enforcement: "soft",
            requirement: "required",
          },
        ],
      },
    };
    const exposed = extractSellerRequiredCriteria(snapshot);
    expect(exposed).toEqual([
      { checkId: "title_status", ask: "Should the agent only consider clean-title vehicles?" },
    ]);
  });

  it("returns [] when there is no criteria / no snapshot memory", () => {
    expect(extractSellerRequiredCriteria({})).toEqual([]);
    expect(extractSellerRequiredCriteria({ negotiationAgentBuilderMemory: {} })).toEqual([]);
  });
});

describe("G-GEN long-tail — uncovered category (2-layer hybrid)", () => {
  // Category "other" has no taxonomy node → the long tail is all the LLM has.
  const UNCOVERED_LISTING = {
    id: "oth-1",
    title: "Vintage brass telescope",
    category: "other",
    condition: "used",
    askPriceMinor: 40_000,
    floorPriceMinor: 32_000,
    marketMedianMinor: 40_000,
    tags: ["telescope", "brass", "vintage", "optics"],
  };

  it("shows the product-specific long-tail block but keeps categoryCriteria empty (taxonomy-only)", async () => {
    // The LLM tries to invent a criterion — reconcile must drop it (no scaffold).
    mockLLMReturn({
      categoryInterest: "selling optics",
      mustEmphasize: ["original lens, no fungus"],
      categoryCriteria: [{ checkId: "lens_clarity", requirement: "required", stance: "clear" }],
    });

    const result = await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "Original lens, no fungus or haze.",
      previous_memory: memory({ categoryInterest: "selling optics" }),
      listings: [UNCOVERED_LISTING],
    });

    // Long-tail block is present for an item with an uncovered category.
    const systemPrompt = callLLMMock.mock.calls.at(-1)?.[0] as string;
    expect(systemPrompt).toContain("PRODUCT-SPECIFIC FACTORS");
    // The generative layer cannot inject a fake taxonomy check id.
    expect(result.memory.categoryCriteria).toEqual([]);
    // The long-tail answer lands in the free-text bucket instead.
    expect(result.memory.mustEmphasize).toContain("original lens, no fungus");
  });

  it("does not add the long-tail block to a standalone agent (no listing)", async () => {
    mockLLMReturn({ categoryInterest: "reusable seller agent" });
    await processNegotiationAgentBuilderTurn({
      side: "seller",
      seller_required_criteria: [],
      message: "I sell odds and ends, hold firm.",
      previous_memory: memory({ categoryInterest: "reusable seller agent" }),
      listings: [],
    });
    const systemPrompt = callLLMMock.mock.calls.at(-1)?.[0] as string;
    expect(systemPrompt).not.toContain("PRODUCT-SPECIFIC FACTORS");
  });

  it("on a no-listing turn, preserves real prior criteria but drops fabricated check ids", async () => {
    mockLLMReturn({ categoryInterest: "buying a car" });
    const result = await processNegotiationAgentBuilderTurn({
      side: "buyer",
      seller_required_criteria: [],
      message: "still deciding",
      previous_memory: memory({
        categoryInterest: "buying a car",
        categoryCriteria: [
          // real taxonomy check — must survive
          {
            checkId: "title_status",
            questionKo: "명의/소유권(등록증)이 명확한가요?",
            enforcement: "hard",
            requirement: "required",
            stance: "clean only",
          },
          // fabricated check id — must be dropped (invariant enforced even on fallback)
          {
            checkId: "totally_made_up",
            questionKo: "x",
            enforcement: "hard",
            requirement: "required",
            stance: "y",
          },
        ],
      }),
      listings: [], // empty scaffold → fallback path
    });
    expect(result.memory.categoryCriteria.map((c) => c.checkId)).toEqual(["title_status"]);
  });
});
