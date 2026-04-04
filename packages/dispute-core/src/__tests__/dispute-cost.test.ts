import { describe, it, expect } from "vitest";
import {
  computeDisputeCost,
  getEscalationPeriod,
  getReviewerCount,
  computeTier3Discount,
} from "../dispute-cost.js";

// ---------------------------------------------------------------------------
// computeDisputeCost - Tier 1
// ---------------------------------------------------------------------------

describe("computeDisputeCost - Tier 1", () => {
  it("returns fixed $5 cost for any amount", () => {
    const result = computeDisputeCost(10_000, 1); // $100
    expect(result.cost_cents).toBe(500);
  });

  it("returns null reviewer_count for Tier 1", () => {
    const result = computeDisputeCost(50_000, 1);
    expect(result.reviewer_count).toBeNull();
  });

  it("includes correct tier in result", () => {
    const result = computeDisputeCost(10_000, 1);
    expect(result.tier).toBe(1);
  });

  it("includes escalation period", () => {
    const result = computeDisputeCost(10_000, 1);
    expect(result.escalation_period_hours).toBe(24);
  });
});

// ---------------------------------------------------------------------------
// computeDisputeCost - Tier 2 progressive rate
// ---------------------------------------------------------------------------

describe("computeDisputeCost - Tier 2", () => {
  it("applies minimum $20 for $100 transaction", () => {
    // $100 = 10,000 cents. 10,000 * 0.012 = 120 cents = $1.20 -> min $20
    const result = computeDisputeCost(10_000, 2);
    expect(result.cost_cents).toBe(2_000);
  });

  it("applies minimum $20 for $500 transaction", () => {
    // 50,000 * 0.012 = 600 cents = $6 -> min $20
    const result = computeDisputeCost(50_000, 2);
    expect(result.cost_cents).toBe(2_000);
  });

  it("applies minimum $20 for $1,000 transaction", () => {
    // First $500: 50,000 * 0.012 = 600
    // Next $500: 50,000 * 0.007 = 350
    // Total: 950 -> min $20
    const result = computeDisputeCost(100_000, 2);
    expect(result.cost_cents).toBe(2_000);
  });

  it("computes cost for $5,000 transaction (three brackets)", () => {
    // First $500: 50,000 * 0.012 = 600
    // Next $500: 50,000 * 0.007 = 350
    // Next $4,000: 400,000 * 0.003 = 1,200
    // Total: 2,150
    const result = computeDisputeCost(500_000, 2);
    expect(result.cost_cents).toBe(2_150);
  });

  it("computes cost for $10,000 transaction (all four brackets)", () => {
    // First $500: 50,000 * 0.012 = 600
    // Next $500: 50,000 * 0.007 = 350
    // Next $4,000: 400,000 * 0.003 = 1,200
    // Next $5,000: 500,000 * 0.0015 = 750
    // Total: 2,900
    const result = computeDisputeCost(1_000_000, 2);
    expect(result.cost_cents).toBe(2_900);
  });

  it("returns reviewer count for Tier 2", () => {
    const result = computeDisputeCost(50_000, 2);
    expect(result.reviewer_count).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// computeDisputeCost - Tier 3
// ---------------------------------------------------------------------------

describe("computeDisputeCost - Tier 3", () => {
  it("computes 6% cost for $1,000 transaction", () => {
    const result = computeDisputeCost(100_000, 3);
    expect(result.cost_cents).toBe(6_000);
  });

  it("applies minimum $40 for small transactions", () => {
    // $100: 6% = $6 = 600 cents -> min $40 = 4,000 cents
    const result = computeDisputeCost(10_000, 3);
    expect(result.cost_cents).toBe(4_000);
  });

  it("returns reviewer count for Tier 3", () => {
    const result = computeDisputeCost(50_000, 3);
    expect(result.reviewer_count).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// computeDisputeCost - validation
// ---------------------------------------------------------------------------

describe("computeDisputeCost - validation", () => {
  it("throws for zero amount", () => {
    expect(() => computeDisputeCost(0, 1)).toThrow("amount_cents must be positive");
  });

  it("throws for negative amount", () => {
    expect(() => computeDisputeCost(-100, 2)).toThrow("amount_cents must be positive");
  });
});

// ---------------------------------------------------------------------------
// getEscalationPeriod
// ---------------------------------------------------------------------------

describe("getEscalationPeriod", () => {
  it("returns 24h for $200 transaction", () => {
    expect(getEscalationPeriod(20_000)).toBe(24);
  });

  it("returns 24h for $500 (boundary)", () => {
    expect(getEscalationPeriod(50_000)).toBe(24);
  });

  it("returns 48h for $1,000 transaction", () => {
    expect(getEscalationPeriod(100_000)).toBe(48);
  });

  it("returns 48h for $3,000 (boundary)", () => {
    expect(getEscalationPeriod(300_000)).toBe(48);
  });

  it("returns 72h for $5,000 transaction", () => {
    expect(getEscalationPeriod(500_000)).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// getReviewerCount
// ---------------------------------------------------------------------------

describe("getReviewerCount", () => {
  it("returns 9 tier2 reviewers for $500", () => {
    expect(getReviewerCount(50_000, 2)).toBe(9);
  });

  it("returns 15 tier3 reviewers for $500", () => {
    expect(getReviewerCount(50_000, 3)).toBe(15);
  });

  it("returns 13 tier2 reviewers for $2,000", () => {
    expect(getReviewerCount(200_000, 2)).toBe(13);
  });

  it("returns 51 tier2 reviewers for $100,000", () => {
    expect(getReviewerCount(10_000_000, 2)).toBe(51);
  });

  it("returns 91 tier3 reviewers for $100,000", () => {
    expect(getReviewerCount(10_000_000, 3)).toBe(91);
  });
});

// ---------------------------------------------------------------------------
// computeTier3Discount
// ---------------------------------------------------------------------------

describe("computeTier3Discount", () => {
  it("returns free re-review for exact tie (margin 0)", () => {
    const result = computeTier3Discount(0, 6_000);
    expect(result.discounted_cost_cents).toBe(0);
    expect(result.is_free_rereview).toBe(true);
    expect(result.discount_pct).toBe(100);
  });

  it("returns 75% cost for 1-vote margin", () => {
    const result = computeTier3Discount(1, 6_000);
    expect(result.discounted_cost_cents).toBe(4_500);
    expect(result.discount_pct).toBe(25);
    expect(result.is_free_rereview).toBe(false);
  });

  it("returns 90% cost for 2-vote margin", () => {
    const result = computeTier3Discount(2, 6_000);
    expect(result.discounted_cost_cents).toBe(5_400);
    expect(result.discount_pct).toBe(10);
  });

  it("returns full price for 3+ vote margin", () => {
    const result = computeTier3Discount(3, 6_000);
    expect(result.discounted_cost_cents).toBe(6_000);
    expect(result.discount_pct).toBe(0);
  });

  it("returns full price for large margin", () => {
    const result = computeTier3Discount(5, 10_000);
    expect(result.discounted_cost_cents).toBe(10_000);
  });

  it("preserves original cost in result", () => {
    const result = computeTier3Discount(1, 8_000);
    expect(result.original_cost_cents).toBe(8_000);
  });

  it("throws for negative margin", () => {
    expect(() => computeTier3Discount(-1, 6_000)).toThrow("tier2_margin must be non-negative");
  });
});
