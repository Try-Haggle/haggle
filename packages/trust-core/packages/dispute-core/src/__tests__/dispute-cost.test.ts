import { describe, it, expect } from "vitest";
import {
  computeDisputeCost,
  getEscalationPeriod,
  getReviewerCount,
  computeTier3Discount,
} from "../dispute-cost.js";

describe("computeDisputeCost", () => {
  describe("Tier 1 — AI Review", () => {
    it("returns fixed $5 regardless of amount", () => {
      expect(computeDisputeCost(10_000, 1).cost_cents).toBe(500);
      expect(computeDisputeCost(1_000_000, 1).cost_cents).toBe(500);
    });

    it("returns tier 1", () => {
      expect(computeDisputeCost(10_000, 1).tier).toBe(1);
    });
  });

  describe("Tier 2 — Panel Review (progressive)", () => {
    it("applies 1.2% for amount under $500", () => {
      // $100 → 1.2% = $1.20 → min $20
      const result = computeDisputeCost(10_000, 2);
      expect(result.cost_cents).toBe(2_000); // min $20
    });

    it("applies progressive rate for $1000", () => {
      // $500 * 1.2% = $6, $500 * 0.7% = $3.50 → $9.50 → min $20
      const result = computeDisputeCost(100_000, 2);
      expect(result.cost_cents).toBe(2_000); // min $20 still
    });

    it("applies progressive rate for $5000", () => {
      // $500*1.2% = $6, $500*0.7% = $3.50, $4000*0.3% = $12 → $21.50
      const result = computeDisputeCost(500_000, 2);
      expect(result.cost_cents).toBeGreaterThan(2_000);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown!.length).toBe(3);
    });

    it("applies all 4 brackets for $10000", () => {
      // $500*1.2%=$6 + $500*0.7%=$3.50 + $4000*0.3%=$12 + $5000*0.15%=$7.50 = $29
      const result = computeDisputeCost(1_000_000, 2);
      expect(result.cost_cents).toBe(2_900);
      expect(result.breakdown!.length).toBe(4);
    });

    it("enforces minimum $20", () => {
      const result = computeDisputeCost(5_000, 2);  // $50 * 1.2% = $0.60
      expect(result.cost_cents).toBe(2_000);
    });

    it("handles large amounts correctly", () => {
      // $100,000: $6 + $3.5 + $12 + $142.50 = $164
      const result = computeDisputeCost(10_000_000, 2);
      expect(result.cost_cents).toBe(16_400);
    });
  });

  describe("Tier 3 — Grand Panel", () => {
    it("applies 6% rate", () => {
      // $1000 * 6% = $60
      const result = computeDisputeCost(100_000, 3);
      expect(result.cost_cents).toBe(6_000);
    });

    it("enforces minimum $40", () => {
      // $100 * 6% = $6 → min $40
      const result = computeDisputeCost(10_000, 3);
      expect(result.cost_cents).toBe(4_000);
    });

    it("handles exact minimum boundary", () => {
      // $666.67 * 6% ≈ $40
      const result = computeDisputeCost(66_667, 3);
      expect(result.cost_cents).toBe(4_000);
    });
  });
});

describe("getEscalationPeriod", () => {
  it("returns 24h for amounts ≤$500", () => {
    expect(getEscalationPeriod(50_000)).toBe(24);
    expect(getEscalationPeriod(10_000)).toBe(24);
  });

  it("returns 48h for $500-$3K", () => {
    expect(getEscalationPeriod(50_001)).toBe(48);
    expect(getEscalationPeriod(300_000)).toBe(48);
  });

  it("returns 72h for >$3K", () => {
    expect(getEscalationPeriod(300_001)).toBe(72);
    expect(getEscalationPeriod(1_000_000)).toBe(72);
  });
});

describe("getReviewerCount", () => {
  it("returns 9/15 for ≤$500", () => {
    expect(getReviewerCount(50_000, 2)).toBe(9);
    expect(getReviewerCount(50_000, 3)).toBe(15);
  });

  it("returns 11/19 for $500-$1K", () => {
    expect(getReviewerCount(100_000, 2)).toBe(11);
    expect(getReviewerCount(100_000, 3)).toBe(19);
  });

  it("returns 13/23 for $1K-$3K", () => {
    expect(getReviewerCount(200_000, 2)).toBe(13);
    expect(getReviewerCount(200_000, 3)).toBe(23);
  });

  it("returns 51/91 for $50K+", () => {
    expect(getReviewerCount(10_000_000, 2)).toBe(51);
    expect(getReviewerCount(10_000_000, 3)).toBe(91);
  });

  it("scales with amount", () => {
    const small = getReviewerCount(30_000, 2);
    const large = getReviewerCount(5_000_000, 2);
    expect(large).toBeGreaterThan(small);
  });
});

describe("computeTier3Discount", () => {
  const base = 6_000; // $60

  it("returns free re-review on exact tie (margin=0)", () => {
    const result = computeTier3Discount(0, base);
    expect(result.final_cost_cents).toBe(0);
    expect(result.is_re_review).toBe(true);
    expect(result.discount_rate).toBe(1.0);
  });

  it("returns 75% on 1-vote margin", () => {
    const result = computeTier3Discount(1, base);
    expect(result.final_cost_cents).toBe(4_500);
    expect(result.is_re_review).toBe(false);
  });

  it("returns 90% on 2-vote margin", () => {
    const result = computeTier3Discount(2, base);
    expect(result.final_cost_cents).toBe(5_400);
  });

  it("returns full price on 3+ vote margin", () => {
    const result = computeTier3Discount(3, base);
    expect(result.final_cost_cents).toBe(6_000);
    expect(result.discount_rate).toBe(0);
  });

  it("returns full price on large margin", () => {
    const result = computeTier3Discount(5, base);
    expect(result.final_cost_cents).toBe(base);
  });
});
