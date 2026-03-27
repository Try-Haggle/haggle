import { describe, it, expect } from "vitest";
import { createTrustSnapshot, backtestSnapshot, backtestBatch } from "../snapshot.js";
import type { TrustInput, TrustWeights } from "../types.js";
import { TRUST_WEIGHTS_V1 } from "../types.js";

function fullInput(): TrustInput {
  return {
    trade_completion_rate: 0.95,
    dispute_win_rate: 0.80,
    dispute_incidence_rate: 0.05,
    sla_compliance_rate: 0.90,
    cancellation_rate: 0.03,
    auto_confirm_rate: 0.85,
    peer_rating: 0.88,
    trade_frequency: 0.60,
    account_tenure: 0.70,
  };
}

describe("createTrustSnapshot", () => {
  it("creates snapshot with computed score", () => {
    const snap = createTrustSnapshot("user_1", fullInput(), 25, "v1", "2026-03-25T00:00:00Z");
    expect(snap.user_id).toBe("user_1");
    expect(snap.computed_score).toBeTypeOf("number");
    expect(snap.computed_score!).toBeGreaterThan(0);
    expect(snap.cold_start).toBe("MATURE");
    expect(snap.weights_version).toBe("v1");
    expect(snap.trade_count).toBe(25);
    expect(snap.snapshot_at).toBe("2026-03-25T00:00:00Z");
  });

  it("creates snapshot with null score for NEW user", () => {
    const snap = createTrustSnapshot("user_2", fullInput(), 2, "v1");
    expect(snap.computed_score).toBeNull();
    expect(snap.cold_start).toBe("NEW");
  });

  it("preserves raw inputs as a copy", () => {
    const input = fullInput();
    const snap = createTrustSnapshot("user_3", input, 25, "v1");
    input.trade_completion_rate = 0.0; // mutate original
    expect(snap.raw_inputs.trade_completion_rate).toBe(0.95); // snapshot unaffected
  });
});

describe("backtestSnapshot", () => {
  it("compares old vs new weights for a single snapshot", () => {
    const snap = createTrustSnapshot("user_1", fullInput(), 25, "v1");
    const newWeights: TrustWeights = {
      ...TRUST_WEIGHTS_V1,
      peer_rating: 0.25, // massively increase peer_rating weight
      trade_completion_rate: 0.03, // reduce completion weight
    };

    const comparison = backtestSnapshot(snap, newWeights, "v2");
    expect(comparison.user_id).toBe("user_1");
    expect(comparison.old_score).toBe(snap.computed_score);
    expect(comparison.new_score).toBeTypeOf("number");
    expect(comparison.delta).toBeTypeOf("number");
    expect(comparison.old_weights_version).toBe("v1");
    expect(comparison.new_weights_version).toBe("v2");
  });

  it("returns null delta for NEW user snapshot", () => {
    const snap = createTrustSnapshot("user_new", fullInput(), 2, "v1");
    const comparison = backtestSnapshot(snap, TRUST_WEIGHTS_V1, "v1");
    expect(comparison.delta).toBeNull();
  });
});

describe("backtestBatch", () => {
  it("computes aggregate stats across multiple snapshots", () => {
    const snapshots = [
      createTrustSnapshot("u1", fullInput(), 25, "v1"),
      createTrustSnapshot("u2", { ...fullInput(), peer_rating: 0.30 }, 30, "v1"),
      createTrustSnapshot("u3", { ...fullInput(), trade_completion_rate: 0.50 }, 20, "v1"),
      createTrustSnapshot("u4", fullInput(), 2, "v1"), // NEW — will be null
    ];

    const newWeights: TrustWeights = {
      ...TRUST_WEIGHTS_V1,
      peer_rating: 0.30,
      trade_frequency: 0.01,
      account_tenure: 0.01,
      trade_completion_rate: 0.06,
    };

    const result = backtestBatch(snapshots, newWeights, "v2");
    expect(result.comparisons).toHaveLength(4);
    expect(result.stats.total).toBe(4);
    expect(result.stats.scored).toBe(3); // 1 NEW user excluded
    expect(result.stats.avg_delta).toBeTypeOf("number");
  });

  it("counts affected users by delta threshold", () => {
    // Create users with varying inputs so weight changes cause different deltas
    const inputs: TrustInput[] = [];
    for (let i = 0; i < 10; i++) {
      inputs.push({
        ...fullInput(),
        peer_rating: i * 0.1, // 0.0 to 0.9
        trade_completion_rate: 1.0 - i * 0.05, // 1.0 to 0.55
      });
    }

    const snapshots = inputs.map((inp, i) =>
      createTrustSnapshot(`u${i}`, inp, 25, "v1"),
    );

    const extremeWeights: TrustWeights = {
      ...TRUST_WEIGHTS_V1,
      peer_rating: 0.50, // extreme shift
      trade_completion_rate: 0.03,
    };

    const result = backtestBatch(snapshots, extremeWeights, "extreme");
    expect(result.stats.affected_5plus).toBeGreaterThanOrEqual(0);
    expect(result.stats.affected_10plus).toBeGreaterThanOrEqual(0);
    expect(result.stats.affected_5plus).toBeGreaterThanOrEqual(result.stats.affected_10plus);
  });
});
