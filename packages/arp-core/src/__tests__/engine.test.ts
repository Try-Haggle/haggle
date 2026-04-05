import { describe, it, expect } from "vitest";
import { computeAdjustment } from "../engine.js";
import type { ArpConfig, SegmentData, SignalResult } from "../types.js";
import { DEFAULT_ARP_CONFIG } from "../types.js";

function makeSegment(overrides?: Partial<SegmentData>): SegmentData {
  return {
    key: { category: "ELECTRONICS_SMALL", amount_tier: "MID" },
    review_hours: 48,
    sample_count: 50,
    ...overrides,
  };
}

function makeSignals(net_magnitude: number): SignalResult {
  const direction =
    net_magnitude > 0 ? "INCREASE" as const :
    net_magnitude < 0 ? "DECREASE" as const :
    "HOLD" as const;
  return {
    signals: [],
    net_magnitude,
    direction,
  };
}

// ---------------------------------------------------------------------------
// computeAdjustment
// ---------------------------------------------------------------------------

describe("computeAdjustment", () => {
  it("skips if sample_count < min", () => {
    const result = computeAdjustment(makeSegment({ sample_count: 10 }), makeSignals(3));
    expect(result.skipped).toBe(true);
    expect(result.new_hours).toBe(48);
    expect(result.step_count).toBe(0);
  });

  it("returns HOLD when magnitude is 0", () => {
    const result = computeAdjustment(makeSegment(), makeSignals(0));
    expect(result.direction).toBe("HOLD");
    expect(result.new_hours).toBe(48);
    expect(result.step_count).toBe(0);
    expect(result.skipped).toBe(false);
  });

  it("increases by 1 step (6h) for magnitude 2", () => {
    const result = computeAdjustment(makeSegment(), makeSignals(2));
    // magnitude 2 / magnitude_per_step 2 = 1 step → +6h
    expect(result.step_count).toBe(1);
    expect(result.new_hours).toBe(54);
    expect(result.direction).toBe("INCREASE");
  });

  it("increases by 2 steps (12h) for magnitude 5", () => {
    const result = computeAdjustment(makeSegment(), makeSignals(5));
    // magnitude 5 / 2 = 2.5 → floor = 2 steps (max also 2)
    expect(result.step_count).toBe(2);
    expect(result.new_hours).toBe(60);
  });

  it("caps at max_steps_per_cycle", () => {
    const result = computeAdjustment(makeSegment(), makeSignals(10));
    // 10 / 2 = 5 steps → capped at 2
    expect(result.step_count).toBe(2);
    expect(result.new_hours).toBe(60);
  });

  it("decreases by 1 step for magnitude -2", () => {
    const result = computeAdjustment(makeSegment(), makeSignals(-2));
    expect(result.step_count).toBe(1);
    expect(result.new_hours).toBe(42);
    expect(result.direction).toBe("DECREASE");
  });

  it("clamps to min_hours (24h)", () => {
    const seg = makeSegment({ review_hours: 26 });
    const result = computeAdjustment(seg, makeSignals(-4));
    // 26 - 12 = 14 → clamped to 24
    expect(result.new_hours).toBe(24);
  });

  it("clamps to max_hours (336h)", () => {
    const seg = makeSegment({ review_hours: 330 });
    const result = computeAdjustment(seg, makeSignals(4));
    // 330 + 12 = 342 → clamped to 336
    expect(result.new_hours).toBe(336);
  });

  it("magnitude below threshold yields 0 steps", () => {
    // magnitude 1 / magnitude_per_step 2 = 0.5 → floor = 0
    const result = computeAdjustment(makeSegment(), makeSignals(1));
    expect(result.step_count).toBe(0);
    expect(result.new_hours).toBe(48);
    expect(result.direction).toBe("HOLD");
  });

  it("respects custom config", () => {
    const config: ArpConfig = {
      ...DEFAULT_ARP_CONFIG,
      step_hours: 12,
      max_steps_per_cycle: 3,
      magnitude_per_step: 1,
    };
    const result = computeAdjustment(makeSegment(), makeSignals(2), config);
    // 2 / 1 = 2 steps → +24h
    expect(result.step_count).toBe(2);
    expect(result.new_hours).toBe(72);
  });
});
