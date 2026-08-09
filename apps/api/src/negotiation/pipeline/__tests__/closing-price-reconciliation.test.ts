/**
 * Closing rounds must state the price they settle at.
 *
 * Found in real e2e: the buyer offered $217.75, the seller closed, and the chat read
 * "Confirming the agreement at $215.00" while the session settled at $217.75. Three
 * things lined up:
 *
 *  1. `boundaries.current_offer` comes from `lastOfferPriceMinor`, which stores the
 *     price a round RESPONDED to — one round stale, i.e. the responder's own prior
 *     counter ($215). (Root cause; tracked separately.)
 *  2. The CLOSING-phase skills emit CONFIRM, not ACCEPT.
 *  3. Every reconciliation guard tested `action === "ACCEPT"`, so none of them fired.
 *
 * These tests pin (2)+(3) against the REAL pipeline and respond stage: whatever price
 * the engine arrives at, a closing round states and carries the offer on the table.
 */

import { describe, expect, it } from "vitest";
import { DeepSeekAdapter } from "../../adapters/deepseek-adapter.js";
import { DEFAULT_BUDDY_DNA } from "../../config.js";
import { DefaultEngineSkill } from "../../skills/default-engine-skill.js";
import { respond } from "../../stages/respond.js";
import type { CoreMemory, OpponentPattern, StageConfig } from "../../types.js";
import { isDealClosingAction } from "../../types.js";
import { executePipeline } from "../pipeline.js";
import type { PipelineDeps, ValidateOutput } from "../types.js";

const adapter = new DeepSeekAdapter();
const skill = new DefaultEngineSkill();

/** The offer on the table when the seller closes. Carries cents on purpose. */
const INCOMING_OFFER = 21775;
/** What a stale `boundaries.current_offer` hands the skill: the seller's own counter. */
const STALE_OWN_COUNTER = 21500;

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: "template", VALIDATE: "full" },
    memoEncoding: "codec",
    reasoningEnabled: false,
  };
}

function makeMemory(
  phase: CoreMemory["session"]["phase"],
  // The skill accepts outright when |current_offer - opponent_offer| is under 5% of
  // the target..floor range, so a still-open round needs a real gap between them.
  opponentOffer: number = STALE_OWN_COUNTER,
): CoreMemory {
  return {
    session: {
      session_id: "closing-test",
      phase,
      round: 5,
      rounds_remaining: 5,
      role: "seller",
      max_rounds: 10,
      intervention_mode: "FULL_AUTO",
    },
    boundaries: {
      my_target: 25000,
      my_floor: 20000,
      // Deliberately stale — this is exactly what produced the wrong chat number.
      current_offer: STALE_OWN_COUNTER,
      opponent_offer: opponentOffer,
      gap: Math.abs(STALE_OWN_COUNTER - opponentOffer),
    },
    terms: { active: [], resolved_summary: "" },
    coaching: {
      recommended_price: STALE_OWN_COUNTER,
      acceptable_range: { min: 20000, max: 25000 },
      suggested_tactic: "reciprocal_concession",
      hint: "",
      opponent_pattern: "LINEAR",
      convergence_rate: 0.5,
      time_pressure: 0.9,
      utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: "furniture-mattress-v1",
  };
}

const opponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ["reciprocal_concession"],
  condition_flexibility: 0.5,
  estimated_floor: 20000,
};

function makeDeps(phase: CoreMemory["session"]["phase"], opponentOffer?: number): PipelineDeps {
  return {
    skill,
    config: makeConfig(),
    memory: makeMemory(phase, opponentOffer),
    facts: [],
    opponent,
    phase,
    buddyDna: DEFAULT_BUDDY_DNA,
    previousMoves: [],
    round: 6,
    briefing: {
      opponentPattern: "LINEAR",
      timePressure: 0.9,
      gapTrend: [],
      opponentMoves: [],
      stagnation: false,
      utilitySnapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_total: 0.6 },
      warnings: [],
    },
    memoEncoding: "codec",
  };
}

describe("isDealClosingAction", () => {
  it("treats CONFIRM as closing, not just ACCEPT", () => {
    // The whole bug was CONFIRM falling outside an ACCEPT-only check.
    expect(isDealClosingAction("CONFIRM")).toBe(true);
    expect(isDealClosingAction("ACCEPT")).toBe(true);
  });

  it("leaves non-closing actions alone", () => {
    for (const action of ["COUNTER", "REJECT", "HOLD", "DISCOVER"] as const) {
      expect(isDealClosingAction(action)).toBe(false);
    }
  });
});

describe("CLOSING round through the real pipeline", () => {
  it("settles and states the incoming offer, not the engine's stale price", async () => {
    const result = await executePipeline(
      `Offer: $${INCOMING_OFFER / 100}`,
      INCOMING_OFFER,
      makeDeps("CLOSING"),
    );
    const decision = result.stages.validate.final_decision;

    // The CLOSING skill emits CONFIRM priced at boundaries.current_offer (stale).
    expect(isDealClosingAction(decision.action)).toBe(true);
    expect(decision.price).toBe(INCOMING_OFFER);
    expect(decision.price).not.toBe(STALE_OWN_COUNTER);

    // And the chat text agrees with it — this is the line the user reads.
    expect(result.stages.respond.message).toContain("217.75");
    expect(result.stages.respond.message).not.toContain("215");
  });

  it("leaves a BARGAINING counter's own price alone", async () => {
    // Reconciliation must not reach past closing rounds: a counter's price IS the
    // new offer and has nothing to do with the incoming one. The offer is set below
    // the seller's target so the skill counters rather than closing.
    const lowball = 21000;
    const result = await executePipeline("Offer: $210", lowball, makeDeps("BARGAINING", lowball));
    const decision = result.stages.validate.final_decision;
    expect(isDealClosingAction(decision.action)).toBe(false);
    expect(decision.price).not.toBe(lowball);
  });
});

describe("respond stage rejects a closing message that names another price", () => {
  function validated(action: string, price: number, message?: string): ValidateOutput {
    return {
      final_decision: {
        action: action as never,
        price,
        reasoning: "test",
        ...(message !== undefined ? { message } : {}),
      },
      validation: { passed: true, hardPassed: true, violations: [] },
      auto_fix_applied: false,
      retry_count: 0,
      explainability: {} as never,
    };
  }

  const render = (v: ValidateOutput) =>
    respond({
      validated: v,
      memory: makeMemory("CLOSING"),
      adapter,
      skill,
      config: makeConfig(),
    }).message;

  it("drops a CONFIRM message stating a different number", () => {
    // Before the fix this guard only ran for ACCEPT, so a CONFIRM sailed through.
    const message = render(
      validated("CONFIRM", INCOMING_OFFER, "Great — we're agreed at $215. Sending the invoice."),
    );
    expect(message).not.toContain("215");
    expect(message).toContain("217.75");
  });

  it("keeps a CONFIRM message that states the agreed number", () => {
    const text = "Deal at $217.75 — I'll get it packed today.";
    expect(render(validated("CONFIRM", INCOMING_OFFER, text))).toBe(text);
  });

  it("still lets a COUNTER phrase its own offer freely", () => {
    const text = "I can come down to $215 given the wear.";
    expect(render(validated("COUNTER", STALE_OWN_COUNTER, text))).toBe(text);
  });
});

describe("money formatting is single-valued", () => {
  it("shows cents when the offer has them and hides them when it does not", () => {
    const withCents = respond({
      validated: {
        final_decision: { action: "COUNTER", price: 21775, reasoning: "t" },
        validation: { passed: true, hardPassed: true, violations: [] },
        auto_fix_applied: false,
        retry_count: 0,
        explainability: {} as never,
      },
      memory: makeMemory("BARGAINING"),
      adapter,
      skill,
      config: makeConfig(),
    }).message;
    expect(withCents).toContain("$217.75");

    const whole = respond({
      validated: {
        final_decision: { action: "COUNTER", price: 19400, reasoning: "t" },
        validation: { passed: true, hardPassed: true, violations: [] },
        auto_fix_applied: false,
        retry_count: 0,
        explainability: {} as never,
      },
      memory: makeMemory("BARGAINING"),
      adapter,
      skill,
      config: makeConfig(),
    }).message;
    // "$194.00" was the machine-sounding half of the badge/message mismatch.
    expect(whole).toContain("$194");
    expect(whole).not.toContain("$194.00");
  });
});
