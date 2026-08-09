/**
 * The two price faults reported from e2e, reproduced through the REAL pipeline.
 *
 *  A. A seller asking $120 answered a $95 offer with **$130** — above the price they
 *     had published. `boundaries.my_target` for a seller IS the asking price, and the
 *     OPENING anchor was `my_target * (1 + margin)`.
 *  B. A buyer who had opened at $200 came back with **$194** — below their own standing
 *     offer, from the mirrored `my_target * (1 - margin)`.
 *
 * Underneath both: the engine never saw the price on the table. `opponent_offer` was set
 * to `coaching.recommended_price` (our own number), so `gap` was meaningless and the
 * anchor was computed from target/floor alone.
 *
 * These run the whole 6-stage pipeline rather than the pure envelope, so a regression in
 * the wiring — coach clamp, referee V8, or the boundaries fed in — fails here.
 */

import { describe, expect, it } from "vitest";
import { DeepSeekAdapter } from "../../adapters/deepseek-adapter.js";
import { DEFAULT_BUDDY_DNA } from "../../config.js";
import { DefaultEngineSkill } from "../../skills/default-engine-skill.js";
import type { CoreMemory, NegotiationPhase, OpponentPattern, StageConfig } from "../../types.js";
import { executePipeline } from "../pipeline.js";
import type { PipelineDeps } from "../types.js";

const adapter = new DeepSeekAdapter();
const skill = new DefaultEngineSkill();

function makeConfig(): StageConfig {
  return {
    adapters: { UNDERSTAND: adapter, DECIDE: adapter, RESPOND: adapter },
    modes: { RESPOND: "template", VALIDATE: "full" },
    memoEncoding: "codec",
    reasoningEnabled: false,
  };
}

function makeMemory(
  role: "buyer" | "seller",
  phase: NegotiationPhase,
  boundaries: CoreMemory["boundaries"],
): CoreMemory {
  return {
    session: {
      session_id: "price-fault",
      phase,
      round: 2,
      rounds_remaining: 8,
      role,
      max_rounds: 10,
      intervention_mode: "FULL_AUTO",
    },
    boundaries,
    terms: { active: [], resolved_summary: "" },
    coaching: {
      recommended_price: 0,
      acceptable_range: { min: 0, max: 0 },
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

const opponent: OpponentPattern = {
  aggression: 0.5,
  concession_rate: 0.03,
  preferred_tactics: ["reciprocal_concession"],
  condition_flexibility: 0.5,
  estimated_floor: 0,
};

function makeDeps(memory: CoreMemory, phase: NegotiationPhase): PipelineDeps {
  return {
    skill,
    config: makeConfig(),
    memory,
    facts: [],
    opponent,
    phase,
    buddyDna: DEFAULT_BUDDY_DNA,
    previousMoves: [],
    round: 3,
    briefing: {
      opponentPattern: "LINEAR",
      timePressure: 0.3,
      gapTrend: [],
      opponentMoves: [],
      stagnation: false,
      utilitySnapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_total: 0.6 },
      warnings: [],
    },
    memoEncoding: "codec",
  };
}

describe("A. seller asking $120 must never counter above $120", () => {
  const ASK = 12000;
  const BUYER_OFFER = 9500;
  const boundaries: CoreMemory["boundaries"] = {
    my_target: ASK,
    my_floor: 8000,
    current_offer: ASK,
    opponent_offer: BUYER_OFFER,
    gap: ASK - BUYER_OFFER,
    my_last_offer: ASK,
  };

  it("stays at or below the asking price on the opening anchor", async () => {
    const memory = makeMemory("seller", "OPENING", boundaries);
    const result = await executePipeline("Offer: $95", BUYER_OFFER, makeDeps(memory, "OPENING"));
    const price = result.stages.validate.final_decision.price;
    if (price != null) {
      expect(price).toBeLessThanOrEqual(ASK);
      expect(price).toBeGreaterThanOrEqual(BUYER_OFFER);
    }
  });

  it("stays at or below the asking price while bargaining", async () => {
    const memory = makeMemory("seller", "BARGAINING", boundaries);
    const result = await executePipeline("Offer: $95", BUYER_OFFER, makeDeps(memory, "BARGAINING"));
    const price = result.stages.validate.final_decision.price;
    if (price != null) expect(price).toBeLessThanOrEqual(ASK);
  });

  it("never counters below the buyer's standing offer", async () => {
    const memory = makeMemory("seller", "BARGAINING", boundaries);
    const result = await executePipeline("Offer: $95", BUYER_OFFER, makeDeps(memory, "BARGAINING"));
    const decision = result.stages.validate.final_decision;
    // Countering under $95 is strictly worse than accepting it.
    if (decision.action === "COUNTER" && decision.price != null) {
      expect(decision.price).toBeGreaterThanOrEqual(BUYER_OFFER);
    }
  });
});

describe("B. buyer who opened at $200 must never come back lower", () => {
  const MY_OPENING = 20000;
  const SELLER_ASK = 25000;
  const boundaries: CoreMemory["boundaries"] = {
    my_target: MY_OPENING,
    my_floor: 25000, // budget
    current_offer: MY_OPENING,
    opponent_offer: SELLER_ASK,
    gap: SELLER_ASK - MY_OPENING,
    my_last_offer: MY_OPENING,
  };

  it("never offers below its own previous offer", async () => {
    for (const phase of ["OPENING", "BARGAINING"] as NegotiationPhase[]) {
      const memory = makeMemory("buyer", phase, boundaries);
      const result = await executePipeline("Offer: $250", SELLER_ASK, makeDeps(memory, phase));
      const price = result.stages.validate.final_decision.price;
      if (price != null) expect(price).toBeGreaterThanOrEqual(MY_OPENING);
    }
  });

  it("never bids above the seller's standing price", async () => {
    const memory = makeMemory("buyer", "BARGAINING", boundaries);
    const result = await executePipeline("Offer: $250", SELLER_ASK, makeDeps(memory, "BARGAINING"));
    const price = result.stages.validate.final_decision.price;
    if (price != null) expect(price).toBeLessThanOrEqual(SELLER_ASK);
  });

  it("still anchors under target before it has offered anything", async () => {
    // A buyer's target is private; opening under it is ordinary negotiation, so the
    // fix must not flatten that. Only their OWN previous offer bounds them below.
    const { my_last_offer: _drop, ...noPriorOffer } = boundaries;
    const memory = makeMemory("buyer", "OPENING", noPriorOffer as CoreMemory["boundaries"]);
    const result = await executePipeline("Offer: $250", SELLER_ASK, makeDeps(memory, "OPENING"));
    const price = result.stages.validate.final_decision.price;
    if (price != null) expect(price).toBeLessThanOrEqual(MY_OPENING);
  });
});
