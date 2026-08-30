import { describe, expect, it } from "vitest";
import { DeepSeekAdapter } from "../../adapters/deepseek-adapter.js";
import { DEFAULT_BUDDY_DNA } from "../../config.js";
import type { ValidateOutput } from "../../pipeline/types.js";
import { DefaultEngineSkill } from "../../skills/default-engine-skill.js";
import type { CoreMemory, StageConfig } from "../../types.js";
import { respond } from "../respond.js";

const adapter = new DeepSeekAdapter();
const skill = new DefaultEngineSkill();

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: "template", VALIDATE: "full" },
    memoEncoding: "codec",
  };
}

function makeMemory(): CoreMemory {
  return {
    session: {
      session_id: "test-session",
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
    skill_summary: "electronics-iphone-pro-v1",
  };
}

function makeValidateOutput(action: string = "COUNTER", price?: number): ValidateOutput {
  return {
    final_decision: { action: action as any, price, reasoning: "test" },
    validation: { passed: true, hardPassed: true, violations: [] },
    auto_fix_applied: false,
    retry_count: 0,
    explainability: {
      round: 3,
      coach_recommendation: {
        price: 87000,
        basis: "reciprocal_concession",
        acceptable_range: { min: 83000, max: 95000 },
      },
      decision: { source: "skill", action, reasoning_summary: "test" },
      referee_result: { violations: [], action: "PASS", auto_fix_applied: false },
      final_output: { action, price },
    },
  };
}

describe("Stage 5: respond", () => {
  it("generates message in template mode", () => {
    const result = respond({
      validated: makeValidateOutput("COUNTER", 86000),
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });

    expect(result.message).toBeTruthy();
    expect(result.message).toContain("$860");
    expect(result.tone).toBe("professional");
  });

  it("generates ACCEPT message", () => {
    const result = respond({
      validated: makeValidateOutput("ACCEPT", 90000),
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });

    expect(result.message.toLowerCase()).toMatch(/agreed|deal|accept/);
  });

  it("generates REJECT message", () => {
    const result = respond({
      validated: makeValidateOutput("REJECT"),
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });

    expect(result.message.toLowerCase()).toMatch(/pass|can't|doesn't|unable/);
  });

  it("generates HOLD message", () => {
    const result = respond({
      validated: makeValidateOutput("HOLD"),
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });

    expect(result.message.toLowerCase()).toMatch(/review|think|pause/);
  });

  it("drops an ACCEPT LLM message that confirms the wrong price and uses the agreed one", () => {
    // final_decision.price is the agreed price ($13,400); the LLM confirmed at $13,500.
    const validated = makeValidateOutput("ACCEPT", 1_340_000);
    validated.final_decision.message = "Confirming the agreement at $13,500.00. Ready to proceed.";
    const result = respond({
      validated,
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });
    expect(result.message).not.toContain("13500");
    expect(result.message).toContain("$13,400");
  });

  it("keeps an ACCEPT LLM message that confirms the correct price", () => {
    const validated = makeValidateOutput("ACCEPT", 1_340_000);
    validated.final_decision.message = "Deal — $13,400 it is. Ready to proceed to settlement.";
    const result = respond({
      validated,
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });
    expect(result.message).toBe("Deal — $13,400 it is. Ready to proceed to settlement.");
  });

  it("drops an LLM message that names the private floor", () => {
    const validated = makeValidateOutput("COUNTER", 86000);
    validated.final_decision.message = "I can't go below $950 — that's my floor.";
    const result = respond({
      validated,
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });
    expect(result.message).not.toContain("950");
    expect(result.message).not.toMatch(/floor/i);
  });

  it("keeps an LLM message that states the correct price", () => {
    const validated = makeValidateOutput("COUNTER", 1_345_000); // $13,450
    validated.final_decision.message = "How about $13,450? That's my best.";
    const result = respond({
      validated,
      memory: makeMemory(),
      adapter,
      skill,
      config: makeConfig(),
    });
    expect(result.message).toBe("How about $13,450? That's my best.");
  });

  it("falls back to template for llm mode", () => {
    const config = makeConfig();
    config.modes.RESPOND = "llm";

    const result = respond({
      validated: makeValidateOutput("COUNTER", 86000),
      memory: makeMemory(),
      adapter,
      skill,
      config,
    });

    // LLM mode falls back to template
    expect(result.message).toBeTruthy();
    expect(result.tone).toBe("professional");
  });
});
