import { describe, expect, it } from "vitest";
import {
  assembleContext,
  compileNegotiationAgentSnapshot,
  type EngineParamsInput,
  executeRound,
  type MasterStrategy,
  type NegotiationSession,
} from "../src/index.js";
import type { HnpMessage } from "../src/protocol/types.js";

const listedAtMs = Date.UTC(2026, 3, 25, 12);

/** A complete EngineParameters-shaped personality with sensible balancer-ish defaults. */
function params(overrides: Partial<EngineParamsInput> = {}): EngineParamsInput {
  return {
    weights: { w_p: 0.3, w_t: 0.25, w_r: 0.25, w_s: 0.2 },
    alpha: 1.0,
    beta: 1.0,
    u_threshold: 0.5,
    u_aspiration: 0.65,
    anchor_ratio: 0.7,
    v_t_floor: 0.5,
    w_rep: 0.55,
    v_s_base: 0.55,
    n_threshold: 10,
    ...overrides,
  };
}

// hunter-like: price-focused, slow concession (low beta), extreme anchor.
const HUNTER: EngineParamsInput = params({
  weights: { w_p: 0.5, w_t: 0.15, w_r: 0.2, w_s: 0.15 },
  alpha: 0.5,
  beta: 0.4,
  u_threshold: 0.55,
  u_aspiration: 0.7,
  anchor_ratio: 0.5,
  v_t_floor: 0.7,
  n_threshold: 12,
});

// closer-like: time-focused, fast concession (high beta), mild anchor.
const CLOSER: EngineParamsInput = params({
  weights: { w_p: 0.2, w_t: 0.5, w_r: 0.15, w_s: 0.15 },
  alpha: 2.0,
  beta: 2.0,
  u_threshold: 0.4,
  u_aspiration: 0.55,
  anchor_ratio: 0.85,
  v_t_floor: 0.3,
  n_threshold: 10,
});

const LISTING = {
  targetPriceMinor: 50_000,
  floorPriceMinor: 43_000,
  listedAtMs,
  deadlineAtMs: listedAtMs + 7 * 24 * 60 * 60 * 1000,
};

describe("compileNegotiationAgentSnapshot", () => {
  it("passes the resolved EngineParameters through verbatim", () => {
    const s = compileNegotiationAgentSnapshot({
      role: "SELLER",
      preset: "hunter",
      params: HUNTER,
      listing: LISTING,
    });

    expect(s.role).toBe("SELLER");
    expect(s.p_target).toBe(50_000);
    expect(s.p_limit).toBe(43_000);
    // personality flows through (not collapsed to a default)
    expect(s.beta).toBe(0.4);
    expect(s.alpha).toBe(0.5);
    expect(s.u_threshold).toBe(0.55);
    expect(s.u_aspiration).toBe(0.7);
    expect(s.v_t_floor).toBe(0.7);
    expect(s.anchor_ratio).toBe(0.5);
    expect(s.n_threshold).toBe(12);
    expect(s.w_rep).toBe(0.55);
    expect(s.w_info).toBeCloseTo(0.45, 6);
    expect(s.weights.w_p).toBeCloseTo(0.5, 6);
    expect(s.time_value.beta).toBe(0.4);
    expect(s.thresholds.accept).toBe(0.7);
    expect(s.thresholds.counter).toBe(0.55);
    expect(s.compiler.source).toBe("engine_params");
    expect(s.compiler.selected_playbook).toBe("hunter");
  });

  it("normalizes weights to sum to 1", () => {
    const s = compileNegotiationAgentSnapshot({
      role: "BUYER",
      params: params({ weights: { w_p: 2, w_t: 1, w_r: 1, w_s: 0 } }),
      listing: LISTING,
    });
    const sum = s.weights.w_p + s.weights.w_t + s.weights.w_r + s.weights.w_s;
    expect(sum).toBeCloseTo(1, 10);
    const ctx = assembleContext(s, {
      p_effective: 47_000,
      r_score: 0.8,
      i_completeness: 0.9,
      t_elapsed: s.t_deadline * 0.4,
      n_success: 1,
      n_dispute_losses: 0,
    });
    expect(ctx.weights).toEqual(s.weights);
    expect(ctx.time.t_deadline).toBe(s.t_deadline);
  });

  it("makes the same listing behave differently under different personalities", () => {
    const hunter = compileNegotiationAgentSnapshot({
      role: "SELLER",
      preset: "hunter",
      params: HUNTER,
      listing: LISTING,
    });
    const closer = compileNegotiationAgentSnapshot({
      role: "SELLER",
      preset: "closer",
      params: CLOSER,
      listing: LISTING,
    });

    const hunterRound = executeRound(
      makeSellerSession(hunter),
      forceCounter(hunter),
      makeBuyerOffer(45_000),
      makeRoundData(hunter, 0.25, 45_000),
    );
    const closerRound = executeRound(
      makeSellerSession(closer),
      forceCounter(closer),
      makeBuyerOffer(45_000),
      makeRoundData(closer, 0.25, 45_000),
    );

    expect(hunterRound.decision).toBe("COUNTER");
    expect(closerRound.decision).toBe("COUNTER");
    // hunter concedes slowly (low beta) → holds price higher than the fast closer.
    expect(hunterRound.message.price).toBeGreaterThan(closerRound.message.price);
  });

  it("reuses the same personality across products but recompiles prices", () => {
    const phone = compileNegotiationAgentSnapshot({
      role: "SELLER",
      params: HUNTER,
      listing: LISTING,
    });
    const laptop = compileNegotiationAgentSnapshot({
      role: "SELLER",
      params: HUNTER,
      listing: { ...LISTING, targetPriceMinor: 120_000, floorPriceMinor: 100_000 },
    });

    expect(laptop.p_target).toBe(120_000);
    expect(laptop.p_limit).toBe(100_000);
    expect(phone.p_target).toBe(50_000);
    expect(laptop.weights).toEqual(phone.weights);
    expect(laptop.beta).toEqual(phone.beta);
    expect(laptop.thresholds).toEqual(phone.thresholds);
  });

  it("keeps deadline math as absolute epoch milliseconds", () => {
    const deadlineAtMs = listedAtMs + 36 * 60 * 60 * 1000;
    const s = compileNegotiationAgentSnapshot({
      role: "SELLER",
      params: params(),
      listing: {
        id: "listing-1",
        category: "electronics",
        condition: "good",
        targetPriceMinor: 50_000,
        floorPriceMinor: 44_000,
        listedAtMs,
        deadlineAtMs,
      },
    });

    expect(s.created_at).toBe(listedAtMs);
    expect(s.expires_at).toBe(deadlineAtMs);
    expect(s.t_deadline).toBe(deadlineAtMs - listedAtMs);
    expect(s.time_value).toMatchObject({
      listed_at_ms: listedAtMs,
      deadline_at_ms: deadlineAtMs,
      t_total_ms: deadlineAtMs - listedAtMs,
      source: "listing_selling_deadline",
    });
    expect(s.listing_context).toMatchObject({
      id: "listing-1",
      category: "electronics",
      condition: "good",
    });
  });
});

function forceCounter(strategy: MasterStrategy): MasterStrategy {
  return { ...strategy, u_threshold: 0.99, u_aspiration: 1.01 };
}

function makeSellerSession(strategy: MasterStrategy): NegotiationSession {
  return {
    session_id: "seller-session",
    strategy_id: strategy.id,
    role: "SELLER",
    status: "ACTIVE",
    counterparty_id: "buyer-1",
    rounds: [],
    current_round: 1,
    rounds_no_concession: 0,
    last_offer_price: strategy.p_target,
    last_utility: null,
    created_at: strategy.created_at,
    updated_at: strategy.created_at,
  };
}

function makeBuyerOffer(price: number): HnpMessage {
  return {
    session_id: "seller-session",
    round: 2,
    type: "OFFER",
    price,
    sender_role: "BUYER",
    timestamp: listedAtMs,
  };
}

function makeRoundData(strategy: MasterStrategy, progress: number, offerPrice: number) {
  return {
    p_effective: offerPrice,
    r_score: 0.8,
    i_completeness: 0.9,
    t_elapsed: strategy.t_deadline * progress,
    n_success: 0,
    n_dispute_losses: 0,
  };
}
