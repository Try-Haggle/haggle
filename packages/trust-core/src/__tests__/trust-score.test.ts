import { describe, it, expect } from "vitest";
import {
  computeTrustScore,
  redistributeWeights,
  recomputeWithWeights,
} from "../trust-score.js";
import type { TrustInput, TrustWeights } from "../types.js";
import { TRUST_WEIGHTS_V1 } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fullInput(overrides: Partial<TrustInput> = {}): TrustInput {
  return {
    trade_completion_rate: 0.95,
    dispute_win_rate: 0.80,
    dispute_incidence_rate: 0.05, // low = good, inverted to 0.95
    sla_compliance_rate: 0.90,
    cancellation_rate: 0.03, // low = good, inverted to 0.97
    auto_confirm_rate: 0.85,
    peer_rating: 0.88,
    trade_frequency: 0.60,
    account_tenure: 0.70,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeTrustScore
// ---------------------------------------------------------------------------

describe("computeTrustScore", () => {
  it("computes score for a fully populated input", () => {
    const result = computeTrustScore(fullInput(), 25);
    expect(result.score).toBeTypeOf("number");
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
    expect(result.cold_start).toBe("MATURE");
    expect(result.inputs_used).toBe(9);
    expect(result.inputs_total).toBe(9);
    expect(result.weights_version).toBe("v1");
  });

  it("returns null score for NEW user (< 5 trades)", () => {
    const result = computeTrustScore(fullInput(), 3);
    expect(result.score).toBeNull();
    expect(result.cold_start).toBe("NEW");
    expect(result.inputs_used).toBe(0);
  });

  it("computes score for SCORING user (5-19 trades)", () => {
    const result = computeTrustScore(fullInput(), 10);
    expect(result.score).toBeTypeOf("number");
    expect(result.cold_start).toBe("SCORING");
  });

  it("inverts dispute_incidence_rate (lower is better)", () => {
    const highDispute = computeTrustScore(
      fullInput({ dispute_incidence_rate: 0.50 }),
      25,
    );
    const lowDispute = computeTrustScore(
      fullInput({ dispute_incidence_rate: 0.02 }),
      25,
    );
    expect(lowDispute.score!).toBeGreaterThan(highDispute.score!);
  });

  it("inverts cancellation_rate (lower is better)", () => {
    const highCancel = computeTrustScore(
      fullInput({ cancellation_rate: 0.30 }),
      25,
    );
    const lowCancel = computeTrustScore(
      fullInput({ cancellation_rate: 0.01 }),
      25,
    );
    expect(lowCancel.score!).toBeGreaterThan(highCancel.score!);
  });

  it("handles perfect score (all 1.0, inverted at 0.0)", () => {
    const perfect: TrustInput = {
      trade_completion_rate: 1.0,
      dispute_win_rate: 1.0,
      dispute_incidence_rate: 0.0,
      sla_compliance_rate: 1.0,
      cancellation_rate: 0.0,
      auto_confirm_rate: 1.0,
      peer_rating: 1.0,
      trade_frequency: 1.0,
      account_tenure: 1.0,
    };
    const result = computeTrustScore(perfect, 25);
    expect(result.score).toBe(100);
  });

  it("handles worst score (all 0.0, inverted at 1.0)", () => {
    const worst: TrustInput = {
      trade_completion_rate: 0.0,
      dispute_win_rate: 0.0,
      dispute_incidence_rate: 1.0,
      sla_compliance_rate: 0.0,
      cancellation_rate: 1.0,
      auto_confirm_rate: 0.0,
      peer_rating: 0.0,
      trade_frequency: 0.0,
      account_tenure: 0.0,
    };
    const result = computeTrustScore(worst, 25);
    expect(result.score).toBe(0);
  });

  it("clamps score to 0-100 range", () => {
    // Even with extreme inputs, score should be clamped
    const result = computeTrustScore(fullInput(), 25);
    expect(result.score!).toBeGreaterThanOrEqual(0);
    expect(result.score!).toBeLessThanOrEqual(100);
  });

  it("uses custom weights when provided", () => {
    const heavyCompletion: TrustWeights = {
      ...TRUST_WEIGHTS_V1,
      trade_completion_rate: 0.90,
      dispute_win_rate: 0.01,
      dispute_incidence_rate: 0.01,
      sla_compliance_rate: 0.01,
      cancellation_rate: 0.01,
      auto_confirm_rate: 0.01,
      peer_rating: 0.01,
      trade_frequency: 0.02,
      account_tenure: 0.02,
    };
    const r1 = computeTrustScore(
      fullInput({ trade_completion_rate: 1.0 }),
      25,
      heavyCompletion,
      "custom",
    );
    const r2 = computeTrustScore(
      fullInput({ trade_completion_rate: 0.5 }),
      25,
      heavyCompletion,
      "custom",
    );
    // With 90% weight on completion, the difference should be large
    expect(r1.score! - r2.score!).toBeGreaterThan(30);
    expect(r1.weights_version).toBe("custom");
  });
});

// ---------------------------------------------------------------------------
// redistributeWeights — partial inputs
// ---------------------------------------------------------------------------

describe("redistributeWeights", () => {
  it("redistributes when some inputs are null", () => {
    const buyerOnly: TrustInput = {
      trade_completion_rate: 0.95,
      dispute_win_rate: 0.80,
      dispute_incidence_rate: 0.05,
      sla_compliance_rate: null, // no seller data
      cancellation_rate: 0.03,
      auto_confirm_rate: 0.85,
      peer_rating: 0.88,
      trade_frequency: 0.60,
      account_tenure: 0.70,
    };

    const entries = redistributeWeights(buyerOnly, TRUST_WEIGHTS_V1);
    expect(entries).toHaveLength(8); // 9 - 1 null
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it("redistributes when multiple inputs are null", () => {
    const minimal: TrustInput = {
      trade_completion_rate: 0.90,
      dispute_win_rate: null,
      dispute_incidence_rate: 0.10,
      sla_compliance_rate: null,
      cancellation_rate: null,
      auto_confirm_rate: null,
      peer_rating: null,
      trade_frequency: 0.50,
      account_tenure: 0.30,
    };

    const entries = redistributeWeights(minimal, TRUST_WEIGHTS_V1);
    expect(entries).toHaveLength(4);
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 5);
  });

  it("returns empty array when all inputs are null", () => {
    const empty: TrustInput = {
      trade_completion_rate: null,
      dispute_win_rate: null,
      dispute_incidence_rate: null,
      sla_compliance_rate: null,
      cancellation_rate: null,
      auto_confirm_rate: null,
      peer_rating: null,
      trade_frequency: null,
      account_tenure: null,
    };

    const entries = redistributeWeights(empty, TRUST_WEIGHTS_V1);
    expect(entries).toHaveLength(0);
  });

  it("inverts dispute_incidence_rate correctly", () => {
    const input = fullInput({ dispute_incidence_rate: 0.20 });
    const entries = redistributeWeights(input, TRUST_WEIGHTS_V1);
    const dispute = entries.find((e) => e.key === "dispute_incidence_rate");
    expect(dispute!.value).toBeCloseTo(0.80); // 1 - 0.20
  });

  it("inverts cancellation_rate correctly", () => {
    const input = fullInput({ cancellation_rate: 0.15 });
    const entries = redistributeWeights(input, TRUST_WEIGHTS_V1);
    const cancel = entries.find((e) => e.key === "cancellation_rate");
    expect(cancel!.value).toBeCloseTo(0.85); // 1 - 0.15
  });

  it("buyer-only user gets correct score without SLA", () => {
    const buyerInput: TrustInput = {
      trade_completion_rate: 0.95,
      dispute_win_rate: 0.90,
      dispute_incidence_rate: 0.02,
      sla_compliance_rate: null,
      cancellation_rate: 0.01,
      auto_confirm_rate: 0.90,
      peer_rating: 0.85,
      trade_frequency: 0.50,
      account_tenure: 0.40,
    };

    const result = computeTrustScore(buyerInput, 25);
    expect(result.score).toBeTypeOf("number");
    expect(result.inputs_used).toBe(8);
    // Score should be high (good buyer)
    expect(result.score!).toBeGreaterThan(70);
  });

  it("seller-only user gets correct score without auto_confirm", () => {
    const sellerInput: TrustInput = {
      trade_completion_rate: 0.98,
      dispute_win_rate: 0.85,
      dispute_incidence_rate: 0.03,
      sla_compliance_rate: 0.95,
      cancellation_rate: 0.02,
      auto_confirm_rate: null,
      peer_rating: 0.90,
      trade_frequency: 0.70,
      account_tenure: 0.80,
    };

    const result = computeTrustScore(sellerInput, 25);
    expect(result.score).toBeTypeOf("number");
    expect(result.inputs_used).toBe(8);
    expect(result.score!).toBeGreaterThan(70);
  });
});

// ---------------------------------------------------------------------------
// recomputeWithWeights (backtest)
// ---------------------------------------------------------------------------

describe("recomputeWithWeights", () => {
  it("produces different score with different weights", () => {
    const input = fullInput();
    const r1 = computeTrustScore(input, 25);
    const altWeights: TrustWeights = {
      ...TRUST_WEIGHTS_V1,
      trade_completion_rate: 0.05,
      peer_rating: 0.27, // bump peer_rating massively
    };
    const r2 = recomputeWithWeights(input, 25, altWeights, "v2");
    expect(r2.weights_version).toBe("v2");
    expect(r2.score).not.toBe(r1.score);
  });
});
