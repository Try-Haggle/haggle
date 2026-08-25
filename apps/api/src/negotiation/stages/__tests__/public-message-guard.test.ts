import { describe, expect, it } from "vitest";
import { DEFAULT_BUDDY_DNA } from "../../config.js";
import type { CoreMemory } from "../../types.js";
import { messageLeaksPrivateState } from "../public-message-guard.js";

function memory(): CoreMemory {
  return {
    session: {
      session_id: "s",
      phase: "BARGAINING",
      round: 3,
      rounds_remaining: 7,
      role: "buyer",
      max_rounds: 10,
      intervention_mode: "FULL_AUTO",
    },
    boundaries: {
      my_target: 83000,
      my_floor: 95000,
      current_offer: 85000,
      opponent_offer: 90000,
      gap: 5000,
    },
    terms: { active: [], resolved_summary: "" },
    coaching: {
      recommended_price: 87000,
      acceptable_range: { min: 83000, max: 95000 },
      suggested_tactic: "reciprocal_concession",
      hint: "",
      opponent_pattern: "LINEAR",
      convergence_rate: 0.5,
      time_pressure: 0.3,
      utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: "test",
  };
}

describe("messageLeaksPrivateState", () => {
  it("allows the outgoing offer and the opponent's last number", () => {
    expect(messageLeaksPrivateState("How about $860?", memory(), 86000)).toBe(false);
    expect(messageLeaksPrivateState("You asked $900, I can do $860.", memory(), 86000)).toBe(false);
  });

  it("rejects a private floor or target that is not the public offer", () => {
    expect(messageLeaksPrivateState("I won't go above $950.", memory(), 86000)).toBe(true);
    expect(messageLeaksPrivateState("My target is $830.", memory(), 86000)).toBe(true);
    expect(messageLeaksPrivateState("박스 추천은 $870입니다.", memory(), 86000)).toBe(true);
  });

  it("rejects reservation phrasing even when the floor equals the offer", () => {
    expect(
      messageLeaksPrivateState("I can't go below $950 — that's my floor.", memory(), 95000),
    ).toBe(true);
  });
});
