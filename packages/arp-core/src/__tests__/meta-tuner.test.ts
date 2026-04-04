import { describe, it, expect } from "vitest";
import { tuneConfig } from "../meta-tuner.js";
import type { ArpCycleHistory } from "../types.js";
import { DEFAULT_ARP_CONFIG } from "../types.js";

// ---------------------------------------------------------------------------
// tuneConfig
// ---------------------------------------------------------------------------

describe("tuneConfig", () => {
  it("returns no adjustment for insufficient history", () => {
    const result = tuneConfig([{ direction: "INCREASE", magnitude: 2, cycle_index: 0 }]);
    expect(result.adjustments).toContain("insufficient_history");
    expect(result.cycle_days).toBe(DEFAULT_ARP_CONFIG.cycle_days);
  });

  it("detects oscillation (INC → DEC → INC)", () => {
    const history: ArpCycleHistory[] = [
      { direction: "INCREASE", magnitude: 3, cycle_index: 0 },
      { direction: "DECREASE", magnitude: 2, cycle_index: 1 },
      { direction: "INCREASE", magnitude: 2, cycle_index: 2 },
    ];
    const result = tuneConfig(history);
    expect(result.adjustments.some(a => a.includes("oscillation"))).toBe(true);
    expect(result.step_hours).toBeLessThan(DEFAULT_ARP_CONFIG.step_hours);
    expect(result.cycle_days).toBeGreaterThan(DEFAULT_ARP_CONFIG.cycle_days);
  });

  it("detects long HOLD (5+ consecutive)", () => {
    const history: ArpCycleHistory[] = Array.from({ length: 5 }, (_, i) => ({
      direction: "HOLD" as const,
      magnitude: 0,
      cycle_index: i,
    }));
    const result = tuneConfig(history);
    expect(result.adjustments.some(a => a.includes("long_hold"))).toBe(true);
    expect(result.cycle_days).toBeGreaterThan(DEFAULT_ARP_CONFIG.cycle_days);
  });

  it("detects strong trend (2+ same direction)", () => {
    const history: ArpCycleHistory[] = [
      { direction: "INCREASE", magnitude: 3, cycle_index: 0 },
      { direction: "INCREASE", magnitude: 4, cycle_index: 1 },
    ];
    const result = tuneConfig(history);
    expect(result.adjustments.some(a => a.includes("trend"))).toBe(true);
    expect(result.cycle_days).toBeLessThan(DEFAULT_ARP_CONFIG.cycle_days);
    expect(result.max_steps_per_cycle).toBeGreaterThan(DEFAULT_ARP_CONFIG.max_steps_per_cycle);
  });

  it("clamps cycle_days to min 7", () => {
    const history: ArpCycleHistory[] = [
      { direction: "INCREASE", magnitude: 5, cycle_index: 0 },
      { direction: "INCREASE", magnitude: 5, cycle_index: 1 },
    ];
    const config = { ...DEFAULT_ARP_CONFIG, cycle_days: 8 };
    const result = tuneConfig(history, config);
    expect(result.cycle_days).toBeGreaterThanOrEqual(7);
  });

  it("clamps cycle_days to max 60", () => {
    const history: ArpCycleHistory[] = Array.from({ length: 5 }, (_, i) => ({
      direction: "HOLD" as const,
      magnitude: 0,
      cycle_index: i,
    }));
    const config = { ...DEFAULT_ARP_CONFIG, cycle_days: 55 };
    const result = tuneConfig(history, config);
    expect(result.cycle_days).toBeLessThanOrEqual(60);
  });

  it("clamps step_hours to min 3", () => {
    const history: ArpCycleHistory[] = [
      { direction: "INCREASE", magnitude: 2, cycle_index: 0 },
      { direction: "DECREASE", magnitude: 2, cycle_index: 1 },
      { direction: "INCREASE", magnitude: 2, cycle_index: 2 },
    ];
    const config = { ...DEFAULT_ARP_CONFIG, step_hours: 3 };
    const result = tuneConfig(history, config);
    expect(result.step_hours).toBeGreaterThanOrEqual(3);
  });

  it("no adjustment when history shows mixed non-pattern", () => {
    const history: ArpCycleHistory[] = [
      { direction: "INCREASE", magnitude: 2, cycle_index: 0 },
      { direction: "HOLD", magnitude: 0, cycle_index: 1 },
      { direction: "DECREASE", magnitude: 1, cycle_index: 2 },
    ];
    const result = tuneConfig(history);
    // HOLD between INC and DEC breaks oscillation, only 1 non-hold per direction
    // INC at 0, DEC at 2 → last 2 non-hold = [INC, DEC] → different = trend NOT detected
    // Actually trend detector checks last 2 non-HOLD: [INCREASE, DECREASE] → different → no trend
    // Oscillation: needs 3 non-HOLD, only 2 → no oscillation
    expect(result.adjustments).toContain("no_adjustment_needed");
  });
});
