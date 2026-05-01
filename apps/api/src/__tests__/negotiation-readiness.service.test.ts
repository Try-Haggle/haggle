import { describe, expect, it } from "vitest";
import { evaluateNegotiationStartReadiness } from "../services/negotiation-readiness.service.js";

describe("evaluateNegotiationStartReadiness", () => {
  it("blocks buyer starts when product, budget, and priority are missing", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: { alpha: { price: 0.4, time: 0.2 } },
      memoryBrief: null,
    });

    expect(result).toMatchObject({
      ready: false,
      missing_slots: ["product_intent", "budget_boundary", "buyer_priority"],
      question: "What product or category should I negotiate for?",
    });
  });

  it("allows buyer starts when strategy snapshot has sufficient context", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: {
        item: { title: "iPhone 15 Pro", category: "electronics" },
        buyer_budget: { max_budget_minor: 95000 },
        must_have: ["battery >= 90%", "unlocked"],
      },
      memoryBrief: null,
    });

    expect(result.ready).toBe(true);
    expect(result.missing_slots).toEqual([]);
  });

  it("uses HIL memory cards to fill missing strategy slots", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: { alpha: { price: 0.4 } },
      memoryBrief: {
        userId: "buyer-1",
        items: [
          {
            cardType: "interest",
            memoryKey: "demand_intent:item:iphone",
            summary: "buyer shopping intent: iphone",
            strength: 0.7,
            memory: { normalizedValue: "iphone" },
            evidenceRefs: [],
          },
          {
            cardType: "pricing",
            memoryKey: "price_resistance:ceiling:ceiling_95000",
            summary: "buyer pricing boundary: ceiling_95000",
            strength: 0.7,
            memory: { normalizedValue: "ceiling_95000" },
            evidenceRefs: [],
          },
          {
            cardType: "preference",
            memoryKey: "term_preference:battery:battery_90_plus",
            summary: "buyer term preference: battery >= 90%",
            strength: 0.7,
            memory: { normalizedValue: "battery >= 90%" },
            evidenceRefs: [],
          },
        ],
      },
    });

    expect(result.ready).toBe(true);
    expect(result.source_summary.memory_cards).toBe(3);
  });

  it("treats explicit no-preference memory as a completed buyer priority", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: { alpha: { price: 0.4 } },
      memoryBrief: {
        userId: "buyer-1",
        items: [
          {
            cardType: "interest",
            memoryKey: "advisor:category_interest",
            summary: "Interested in iPhone 15",
            strength: 0.65,
            memory: { categoryInterest: "iPhone 15", source: ["no additional requirements"] },
            evidenceRefs: [],
          },
          {
            cardType: "pricing",
            memoryKey: "advisor:budget_model",
            summary: "Target $400, max $450",
            strength: 0.72,
            memory: { targetPrice: 400, budgetMax: 450 },
            evidenceRefs: [],
          },
        ],
      },
    });

    expect(result.ready).toBe(true);
    expect(result.missing_slots).toEqual([]);
  });

  it("does not block seller-created sessions", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "SELLER",
      strategySnapshot: {},
      memoryBrief: null,
    });

    expect(result.ready).toBe(true);
  });

  it("asks for confirmation when memory targets iPhone 15 but selected product is iPhone 14", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: {
        item: { title: "Apple iPhone 14 128GB unlocked" },
        buyer_budget: { max_budget_minor: 50000 },
        must_have: ["battery >= 90%"],
      },
      memoryBrief: {
        userId: "buyer-1",
        items: [
          {
            cardType: "interest",
            memoryKey: "advisor:category_interest",
            summary: "Interested in iPhone 15",
            strength: 0.75,
            memory: { categoryInterest: "iPhone 15" },
            evidenceRefs: [],
          },
        ],
      },
    });

    expect(result.ready).toBe(false);
    expect(result.missing_slots).toContain("product_identity_confirmation");
    expect(result.product_identity_gate).toMatchObject({
      status: "confirm",
      comparison: { alignment: "related" },
    });
  });

  it("allows confirmed product identity differences", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: {
        item: { title: "Apple iPhone 15 256GB unlocked" },
        buyer_budget: { max_budget_minor: 50000 },
        must_have: ["battery >= 90%"],
      },
      memoryBrief: {
        userId: "buyer-1",
        items: [
          {
            cardType: "interest",
            memoryKey: "advisor:category_interest",
            summary: "Interested in iPhone 15 128GB",
            strength: 0.75,
            memory: { categoryInterest: "iPhone 15 128GB" },
            evidenceRefs: [],
          },
        ],
      },
      productIdentityConfirmed: true,
    });

    expect(result.ready).toBe(true);
    expect(result.product_identity_gate).toMatchObject({
      status: "confirm",
      comparison: { alignment: "variant" },
    });
  });

  it("observes unrelated product memory without blocking browsing flow", () => {
    const result = evaluateNegotiationStartReadiness({
      role: "BUYER",
      strategySnapshot: {
        item: { title: "Apple iPhone 15" },
        buyer_budget: { max_budget_minor: 50000 },
        must_have: ["battery >= 90%"],
      },
      memoryBrief: {
        userId: "buyer-1",
        items: [
          {
            cardType: "interest",
            memoryKey: "advisor:category_interest",
            summary: "Interested in laptop for school",
            strength: 0.75,
            memory: { categoryInterest: "laptop for school" },
            evidenceRefs: [],
          },
        ],
      },
    });

    expect(result.ready).toBe(true);
    expect(result.product_identity_gate).toMatchObject({
      status: "observe",
      comparison: { alignment: "different" },
    });
  });
});
