import { describe, it, expect } from "vitest";
import { computeSlaPenalty, getFrequencyMultiplier } from "../sla-penalty.js";

describe("getFrequencyMultiplier", () => {
  it("returns 1.0 for first violation", () => {
    expect(getFrequencyMultiplier(1)).toBe(1.0);
  });

  it("returns 1.0 for 0 violations (edge case)", () => {
    expect(getFrequencyMultiplier(0)).toBe(1.0);
  });

  it("returns 1.5 for second violation in 90 days", () => {
    expect(getFrequencyMultiplier(2)).toBe(1.5);
  });

  it("returns 2.5 for third violation in 90 days", () => {
    expect(getFrequencyMultiplier(3)).toBe(2.5);
  });

  it("returns 4.0 for fourth+ violation in 90 days", () => {
    expect(getFrequencyMultiplier(4)).toBe(4.0);
    expect(getFrequencyMultiplier(10)).toBe(4.0);
  });
});

describe("computeSlaPenalty", () => {
  it("computes basic penalty: SLA 3 days, 1 day overdue, first violation", () => {
    const result = computeSlaPenalty({
      overdue_days: 1,
      sla_days: 3,
      violations_in_90d: 1,
    });
    // base(5) × (1/3) × 1.0 = 1.67
    expect(result.penalty).toBeCloseTo(1.67, 1);
    expect(result.overdue_ratio).toBeCloseTo(0.33, 1);
    expect(result.frequency_multiplier).toBe(1.0);
  });

  it("computes heavier penalty for longer overdue", () => {
    const result = computeSlaPenalty({
      overdue_days: 5,
      sla_days: 3,
      violations_in_90d: 1,
    });
    // base(5) × (5/3) × 1.0 = 8.33
    expect(result.penalty).toBeCloseTo(8.33, 1);
    expect(result.overdue_ratio).toBeCloseTo(1.67, 1);
  });

  it("escalates with frequency multiplier", () => {
    const first = computeSlaPenalty({
      overdue_days: 2,
      sla_days: 3,
      violations_in_90d: 1,
    });
    const third = computeSlaPenalty({
      overdue_days: 2,
      sla_days: 3,
      violations_in_90d: 3,
    });
    // Third should be 2.5x the first
    expect(third.penalty).toBeCloseTo(first.penalty * 2.5, 1);
  });

  it("computes maximum severity: 14-day no-show on 5-day SLA, 4th violation", () => {
    const result = computeSlaPenalty({
      overdue_days: 9, // 14 - 5 = 9 overdue
      sla_days: 5,
      violations_in_90d: 4,
    });
    // base(5) × (9/5) × 4.0 = 36.0
    expect(result.penalty).toBe(36.0);
    expect(result.frequency_multiplier).toBe(4.0);
  });

  it("returns 0 penalty when overdue_days is 0", () => {
    const result = computeSlaPenalty({
      overdue_days: 0,
      sla_days: 3,
      violations_in_90d: 1,
    });
    expect(result.penalty).toBe(0);
  });

  it("returns 0 penalty when overdue_days is negative", () => {
    const result = computeSlaPenalty({
      overdue_days: -1,
      sla_days: 3,
      violations_in_90d: 1,
    });
    expect(result.penalty).toBe(0);
  });

  it("returns 0 penalty when sla_days is 0", () => {
    const result = computeSlaPenalty({
      overdue_days: 2,
      sla_days: 0,
      violations_in_90d: 1,
    });
    expect(result.penalty).toBe(0);
  });
});
