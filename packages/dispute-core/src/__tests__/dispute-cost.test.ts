import { describe, it, expect } from "vitest";
import {
  computeDisputeCost,
  getEscalationPeriod,
  getReviewerCount,
  computeTier3Discount,
} from "../dispute-cost.js";

// ---------------------------------------------------------------------------
// computeDisputeCost - Tier 1: max(amount × 0.5%, $3)
// ---------------------------------------------------------------------------

describe("computeDisputeCost - Tier 1", () => {
  it("applies minimum $3 for $100 transaction", () => {
    // $100 * 0.5% = $0.50 → min $3
    const result = computeDisputeCost(10_000, 1);
    expect(result.cost_cents).toBe(300);
  });

  it("applies minimum $3 for $500 transaction", () => {
    // $500 * 0.5% = $2.50 → min $3
    const result = computeDisputeCost(50_000, 1);
    expect(result.cost_cents).toBe(300);
  });

  it("applies rate for $1,000 transaction", () => {
    // $1,000 * 0.5% = $5
    const result = computeDisputeCost(100_000, 1);
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
// computeDisputeCost - Tier 2: max(amount × 2%, $12)
// ---------------------------------------------------------------------------

describe("computeDisputeCost - Tier 2", () => {
  it("applies minimum $12 for $100 transaction", () => {
    // $100 * 2% = $2 → min $12
    const result = computeDisputeCost(10_000, 2);
    expect(result.cost_cents).toBe(1_200);
  });

  it("applies minimum $12 for $500 transaction", () => {
    // $500 * 2% = $10 → min $12
    const result = computeDisputeCost(50_000, 2);
    expect(result.cost_cents).toBe(1_200);
  });

  it("applies rate for $1,000 transaction", () => {
    // $1,000 * 2% = $20
    const result = computeDisputeCost(100_000, 2);
    expect(result.cost_cents).toBe(2_000);
  });

  it("applies rate for $5,000 transaction", () => {
    // $5,000 * 2% = $100
    const result = computeDisputeCost(500_000, 2);
    expect(result.cost_cents).toBe(10_000);
  });

  it("applies rate for $10,000 transaction", () => {
    // $10,000 * 2% = $200
    const result = computeDisputeCost(1_000_000, 2);
    expect(result.cost_cents).toBe(20_000);
  });

  it("returns reviewer count for Tier 2", () => {
    const result = computeDisputeCost(50_000, 2);
    expect(result.reviewer_count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeDisputeCost - Tier 3: max(amount × 5%, $30)
// ---------------------------------------------------------------------------

describe("computeDisputeCost - Tier 3", () => {
  it("applies minimum $30 for $100 transaction", () => {
    // $100 * 5% = $5 → min $30
    const result = computeDisputeCost(10_000, 3);
    expect(result.cost_cents).toBe(3_000);
  });

  it("applies minimum $30 for $500 transaction", () => {
    // $500 * 5% = $25 → min $30
    const result = computeDisputeCost(50_000, 3);
    expect(result.cost_cents).toBe(3_000);
  });

  it("applies rate for $1,000 transaction", () => {
    // $1,000 * 5% = $50
    const result = computeDisputeCost(100_000, 3);
    expect(result.cost_cents).toBe(5_000);
  });

  it("returns reviewer count for Tier 3", () => {
    const result = computeDisputeCost(50_000, 3);
    expect(result.reviewer_count).toBe(7);
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
// getReviewerCount (updated to match 분쟁_시스템_v2.md +2 shift)
// ---------------------------------------------------------------------------

describe("getReviewerCount", () => {
  it("returns 5 tier2 reviewers for $500", () => {
    expect(getReviewerCount(50_000, 2)).toBe(5);
  });

  it("returns 7 tier3 reviewers for $500", () => {
    expect(getReviewerCount(50_000, 3)).toBe(7);
  });

  it("returns 7 tier2 reviewers for $1,000", () => {
    expect(getReviewerCount(100_000, 2)).toBe(7);
  });

  it("returns 9 tier2 reviewers for $5,000", () => {
    expect(getReviewerCount(500_000, 2)).toBe(9);
  });

  it("returns 29 tier2 reviewers for $100,000", () => {
    expect(getReviewerCount(10_000_000, 2)).toBe(29);
  });

  it("returns 33 tier3 reviewers for $100,000+", () => {
    expect(getReviewerCount(10_000_001, 3)).toBe(33);
  });
});

// ---------------------------------------------------------------------------
// computeTier3Discount
// ---------------------------------------------------------------------------

describe("computeTier3Discount", () => {
  it("returns free re-review for exact tie (margin 0)", () => {
    const result = computeTier3Discount(0, 5_000);
    expect(result.discounted_cost_cents).toBe(0);
    expect(result.is_free_rereview).toBe(true);
    expect(result.discount_pct).toBe(100);
  });

  it("returns 75% cost for 1-vote margin", () => {
    const result = computeTier3Discount(1, 5_000);
    expect(result.discounted_cost_cents).toBe(3_750);
    expect(result.discount_pct).toBe(25);
    expect(result.is_free_rereview).toBe(false);
  });

  it("returns 90% cost for 2-vote margin", () => {
    const result = computeTier3Discount(2, 5_000);
    expect(result.discounted_cost_cents).toBe(4_500);
    expect(result.discount_pct).toBe(10);
  });

  it("returns full price for 3+ vote margin", () => {
    const result = computeTier3Discount(3, 5_000);
    expect(result.discounted_cost_cents).toBe(5_000);
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
    expect(() => computeTier3Discount(-1, 5_000)).toThrow("tier2_margin must be non-negative");
  });
});
