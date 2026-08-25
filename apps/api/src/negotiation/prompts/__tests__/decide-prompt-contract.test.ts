import { describe, expect, it } from "vitest";
import type { CoreMemory, RoundFact } from "../../types.js";
import { buildDecideUserPrompt } from "../decide-user-prompt.js";

function makeMemory(): CoreMemory {
  return {
    session: {
      session_id: "test",
      phase: "BARGAINING",
      round: 5,
      rounds_remaining: 10,
      role: "buyer",
      max_rounds: 15,
      intervention_mode: "FULL_AUTO",
    },
    boundaries: {
      my_target: 500,
      my_floor: 650,
      current_offer: 520,
      opponent_offer: 620,
      gap: 100,
    },
    terms: { active: [], resolved_summary: "" },
    coaching: {
      recommended_price: 530,
      acceptable_range: { min: 480, max: 650 },
      suggested_tactic: "anchoring",
      hint: "",
      opponent_pattern: "LINEAR",
      convergence_rate: 0.1,
      time_pressure: 0.3,
      utility_snapshot: { u_price: 0.7, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.65 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: {
      style: "balanced",
      preferred_tactic: "reciprocal_concession",
      category_experience: "electronics",
      condition_trade_success_rate: 0.7,
      best_timing: "mid-bargaining",
      tone: { style: "professional", formality: "neutral", emoji_use: false },
    },
    skill_summary: "test",
  };
}

function makeFacts(count: number): RoundFact[] {
  return Array.from({ length: count }, (_, i) => ({
    round: i + 1,
    phase: "BARGAINING" as const,
    buyer_offer: 40000 + i * 100,
    seller_offer: 50000 - i * 100,
    gap: 10000 - i * 200,
    conditions_changed: {},
    coaching_given: { recommended: 45000, tactic: "reciprocal_concession" },
    coaching_followed: true,
    human_intervened: false,
    timestamp: Date.now(),
  }));
}

describe("decide prompt contract", () => {
  it("uses one private MEMO (S/B/C) and never dumps memo-codec NS/PT/RM", () => {
    const prompt = buildDecideUserPrompt(makeMemory(), makeFacts(2));
    expect(prompt).toContain("MEMO:");
    expect(prompt).toContain("S:BARGAINING");
    expect(prompt).toContain("B:t$5.00");
    expect(prompt).not.toMatch(/\bNS:/);
    expect(prompt).not.toMatch(/\bPT:/);
    expect(prompt).not.toMatch(/\bRM:/);
  });

  it("turns price facts into HNP acts when there is no spoken turn", () => {
    const facts = makeFacts(3);
    const withoutTalk = buildDecideUserPrompt(makeMemory(), facts);
    expect(withoutTalk).toContain("HNP:");
    expect(withoutTalk).toContain("ACTS:");
    expect(withoutTalk).toContain("1 BUYER OFFER");
    expect(withoutTalk).not.toContain("HIST:");

    const withTalk = buildDecideUserPrompt(makeMemory(), facts, undefined, undefined, {
      opponent_message: "battery is 87%",
      recent_turns: [
        { round: 1, sender: "BUYER", text: "would $370 work?", price_minor: 37000 },
        { round: 2, sender: "SELLER", text: "battery is 87%", price_minor: 48000 },
      ],
    });
    expect(withTalk).toContain("HNP:");
    expect(withTalk).toContain("ACTS:");
    expect(withTalk).toContain("1 BUYER OFFER");
    expect(withTalk).toContain("OPP_SAID:");
    expect(withTalk).not.toContain("HIST:");
    expect(withTalk).not.toMatch(/\bRM:/);
  });

  it("keeps early public acts instead of a last-N window", () => {
    const facts = makeFacts(8);
    const turns = Array.from({ length: 8 }, (_, i) => ({
      round: i + 1,
      sender: (i % 2 === 0 ? "BUYER" : "SELLER") as "BUYER" | "SELLER",
      text: `round ${i + 1} argued storage`,
      price_minor: 40000 + i * 100,
    }));
    const prompt = buildDecideUserPrompt(makeMemory(), facts, undefined, undefined, {
      opponent_message: "round 8 argued storage",
      recent_turns: turns,
    });
    expect(prompt).toContain("1 BUYER OFFER");
    expect(prompt).toContain("8 SELLER COUNTER");
    expect(prompt).not.toContain("HIST:");
  });
});
