import { describe, it, expect } from "vitest";
import {
  findWeightTier,
  computeWeightBuffer,
  computeApvAdjustment,
  USPS_GROUND_WEIGHT_TIERS,
} from "../weight-buffer.js";

// ─── findWeightTier ──────────────────────────────────────────────────────────

describe("findWeightTier", () => {
  it("maps 1 oz to the 'up to 4 oz' tier", () => {
    const tier = findWeightTier(1);
    expect(tier.label).toBe("up to 4 oz");
    expect(tier.rate_minor).toBe(450);
  });

  it("maps exactly 16 oz (1 lb) to the 'up to 1 lb' tier", () => {
    const tier = findWeightTier(16);
    expect(tier.label).toBe("up to 1 lb");
    expect(tier.rate_minor).toBe(600);
  });

  it("maps 17 oz to the 'up to 2 lb' tier", () => {
    const tier = findWeightTier(17);
    expect(tier.label).toBe("up to 2 lb");
    expect(tier.rate_minor).toBe(750);
  });

  it("maps 160 oz to the 'up to 10 lb' tier", () => {
    const tier = findWeightTier(160);
    expect(tier.label).toBe("up to 10 lb");
    expect(tier.rate_minor).toBe(1700);
  });

  it("throws when weight exceeds all tiers (321 oz)", () => {
    expect(() => findWeightTier(321)).toThrow("exceeds maximum tier");
  });

  it("maps 0 oz to the lightest tier ('up to 4 oz')", () => {
    const tier = findWeightTier(0);
    expect(tier.label).toBe("up to 4 oz");
    expect(tier.rate_minor).toBe(450);
  });
});

// ─── computeWeightBuffer ────────────────────────────────────────────────────

describe("computeWeightBuffer", () => {
  it("8 oz declared → buffer = 50 (next tier 12 oz)", () => {
    const result = computeWeightBuffer(8);
    expect(result.declared_tier.label).toBe("up to 8 oz");
    expect(result.next_tier?.label).toBe("up to 12 oz");
    expect(result.buffer_amount_minor).toBe(50);
  });

  it("16 oz (1 lb) declared → buffer = 150 (next tier 2 lb)", () => {
    const result = computeWeightBuffer(16);
    expect(result.declared_tier.label).toBe("up to 1 lb");
    expect(result.next_tier?.label).toBe("up to 2 lb");
    expect(result.buffer_amount_minor).toBe(150);
  });

  it("48 oz (3 lb) declared → buffer = 200 (next tier 5 lb)", () => {
    const result = computeWeightBuffer(48);
    expect(result.declared_tier.label).toBe("up to 3 lb");
    expect(result.next_tier?.label).toBe("up to 5 lb");
    expect(result.buffer_amount_minor).toBe(200);
  });

  it("320 oz (20 lb, heaviest) → buffer = 0, next_tier = null", () => {
    const result = computeWeightBuffer(320);
    expect(result.declared_tier.label).toBe("up to 20 lb");
    expect(result.next_tier).toBeNull();
    expect(result.buffer_amount_minor).toBe(0);
  });

  it("1 oz → buffer = 50 (next tier 8 oz)", () => {
    const result = computeWeightBuffer(1);
    expect(result.declared_tier.label).toBe("up to 4 oz");
    expect(result.next_tier?.label).toBe("up to 8 oz");
    expect(result.buffer_amount_minor).toBe(50);
  });
});

// ─── computeApvAdjustment ───────────────────────────────────────────────────

describe("computeApvAdjustment", () => {
  it("declared 16oz, actual 16oz → adjustment = 0 (same tier)", () => {
    const result = computeApvAdjustment(16, 16);
    expect(result.adjustment_minor).toBe(0);
    expect(result.declared_tier.label).toBe("up to 1 lb");
    expect(result.actual_tier.label).toBe("up to 1 lb");
  });

  it("declared 16oz, actual 20oz → adjustment = 150 (bumped to 2 lb)", () => {
    const result = computeApvAdjustment(16, 20);
    expect(result.adjustment_minor).toBe(150);
    expect(result.declared_tier.label).toBe("up to 1 lb");
    expect(result.actual_tier.label).toBe("up to 2 lb");
  });

  it("declared 16oz, actual 50oz → adjustment = 500 (bumped to 5 lb)", () => {
    const result = computeApvAdjustment(16, 50);
    expect(result.adjustment_minor).toBe(500);
    expect(result.declared_tier.label).toBe("up to 1 lb");
    expect(result.actual_tier.label).toBe("up to 5 lb");
  });

  it("declared 48oz, actual 40oz → adjustment = 0 (still same tier)", () => {
    const result = computeApvAdjustment(48, 40);
    expect(result.adjustment_minor).toBe(0);
    expect(result.declared_tier.label).toBe("up to 3 lb");
    expect(result.actual_tier.label).toBe("up to 3 lb");
  });
});
