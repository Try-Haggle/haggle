import { describe, it, expect } from "vitest";
import { computeSignals } from "../signals.js";
import type { SignalMetrics } from "../types.js";

function baseMetrics(overrides?: Partial<SignalMetrics>): SignalMetrics {
  return {
    total_actions: 100,
    late_disputes: 0,
    late_valid_disputes: 0,
    discovery_p90_hours: 36, // 36/48 = 75% > 70% threshold → not triggered
    auto_confirms: 50,
    buyer_valid_disputes: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Individual signals
// ---------------------------------------------------------------------------

describe("computeSignals", () => {
  it("returns HOLD when no signals triggered", () => {
    const result = computeSignals(baseMetrics(), 48);
    expect(result.direction).toBe("HOLD");
    expect(result.net_magnitude).toBe(0);
    expect(result.signals.every(s => !s.triggered)).toBe(true);
  });

  it("late_dispute_rate > 15% triggers INCREASE (+2)", () => {
    const result = computeSignals(baseMetrics({ late_disputes: 20 }), 48);
    const sig = result.signals.find(s => s.name === "late_dispute_rate")!;
    expect(sig.triggered).toBe(true);
    expect(sig.magnitude).toBe(2);
  });

  it("late_valid_dispute_rate > 10% triggers INCREASE (+3)", () => {
    const result = computeSignals(baseMetrics({ late_valid_disputes: 15 }), 48);
    const sig = result.signals.find(s => s.name === "late_valid_dispute_rate")!;
    expect(sig.triggered).toBe(true);
    expect(sig.magnitude).toBe(3);
  });

  it("discovery_p90 < 70% of period triggers DECREASE (-1)", () => {
    // p90 = 20h, review = 48h → ratio = 0.417 < 0.70
    const result = computeSignals(baseMetrics({ discovery_p90_hours: 20 }), 48);
    const sig = result.signals.find(s => s.name === "discovery_p90_ratio")!;
    expect(sig.triggered).toBe(true);
    expect(sig.magnitude).toBe(-1);
  });

  it("auto_confirm_rate > 95% triggers DECREASE (-0.5)", () => {
    const result = computeSignals(baseMetrics({ auto_confirms: 97 }), 48);
    const sig = result.signals.find(s => s.name === "auto_confirm_rate")!;
    expect(sig.triggered).toBe(true);
    expect(sig.magnitude).toBe(-0.5);
  });

  it("buyer_valid_rate > 3% triggers INCREASE (+1)", () => {
    const result = computeSignals(baseMetrics({ buyer_valid_disputes: 5 }), 48);
    const sig = result.signals.find(s => s.name === "buyer_valid_rate")!;
    expect(sig.triggered).toBe(true);
    expect(sig.magnitude).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // Combined signals
  // ---------------------------------------------------------------------------

  it("multiple INCREASE signals sum magnitudes", () => {
    const result = computeSignals(baseMetrics({
      late_disputes: 20,           // +2
      late_valid_disputes: 15,     // +3 (15/100 > 10%)
      buyer_valid_disputes: 5,     // +1
    }), 48);
    // 2 + 3 + 1 = 6, but discovery_p90 = 36/48 = 0.75 > 0.70 → not triggered
    expect(result.net_magnitude).toBe(6);
    expect(result.direction).toBe("INCREASE");
  });

  it("INCREASE and DECREASE signals net out", () => {
    const result = computeSignals(baseMetrics({
      late_disputes: 20,           // +2
      discovery_p90_hours: 20,     // -1
      auto_confirms: 97,           // -0.5
    }), 48);
    expect(result.net_magnitude).toBe(0.5);
    expect(result.direction).toBe("INCREASE");
  });

  it("net negative → DECREASE", () => {
    const result = computeSignals(baseMetrics({
      discovery_p90_hours: 10,     // -1
      auto_confirms: 97,           // -0.5
    }), 48);
    expect(result.net_magnitude).toBe(-1.5);
    expect(result.direction).toBe("DECREASE");
  });

  it("handles zero total_actions gracefully", () => {
    const result = computeSignals(baseMetrics({ total_actions: 0 }), 48);
    expect(result.direction).toBe("HOLD");
    expect(result.net_magnitude).toBe(0);
  });

  it("handles zero review_hours (discovery_p90 ratio defaults to 1)", () => {
    const result = computeSignals(baseMetrics(), 0);
    // p90 ratio = 1 (>= 0.70) → not triggered
    const sig = result.signals.find(s => s.name === "discovery_p90_ratio")!;
    expect(sig.triggered).toBe(false);
  });

  it("exactly at threshold does not trigger (strict >)", () => {
    const result = computeSignals(baseMetrics({ late_disputes: 15 }), 48);
    // 15/100 = 0.15, threshold = 0.15 → NOT triggered (> not >=)
    const sig = result.signals.find(s => s.name === "late_dispute_rate")!;
    expect(sig.triggered).toBe(false);
  });
});
