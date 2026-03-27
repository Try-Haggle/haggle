import { describe, it, expect } from "vitest";
import {
  computeTier1Cost,
  computeTier2Cost,
  computeTier3Cost,
  computeDisputeCost,
  computeWorstCaseCost,
  getEscalationPeriodHours,
  getReviewerCount,
} from "../dispute-cost.js";

// ---------------------------------------------------------------------------
// Tier 1 — Progressive rate
// ---------------------------------------------------------------------------

describe("computeTier1Cost", () => {
  it("returns minimum $1 for very small amount ($10)", () => {
    const r = computeTier1Cost(1_000); // $10
    // $10 × 1.2% = $0.12 → min $1
    expect(r.cost_minor).toBe(100);
    expect(r.tier).toBe(1);
  });

  it("returns minimum $1 for $50", () => {
    const r = computeTier1Cost(5_000); // $50
    // $50 × 1.2% = $0.60 → min $1
    expect(r.cost_minor).toBe(100);
  });

  it("computes $100 correctly", () => {
    const r = computeTier1Cost(10_000); // $100
    // $100 × 1.2% = $1.20 = 120 minor
    expect(r.cost_minor).toBe(120);
  });

  it("computes $500 correctly", () => {
    const r = computeTier1Cost(50_000); // $500
    // $500 × 1.2% = $6.00 = 600 minor
    expect(r.cost_minor).toBe(600);
  });

  it("computes $1,000 correctly (first bracket boundary)", () => {
    const r = computeTier1Cost(100_000); // $1,000
    // $1,000 × 1.2% = $12.00
    expect(r.cost_minor).toBe(1_200);
  });

  it("computes $5,000 correctly (crosses into second bracket)", () => {
    const r = computeTier1Cost(500_000); // $5,000
    // First $1K × 1.2% = $12
    // Next $4K × 0.7% = $28
    // Total = $40 = 4,000 minor
    expect(r.cost_minor).toBe(4_000);
  });

  it("computes $10,000 correctly (second bracket boundary)", () => {
    const r = computeTier1Cost(1_000_000); // $10,000
    // First $1K × 1.2% = $12
    // Next $9K × 0.7% = $63
    // Total = $75 = 7,500 minor
    expect(r.cost_minor).toBe(7_500);
  });

  it("computes $30,000 correctly (crosses into third bracket)", () => {
    const r = computeTier1Cost(3_000_000); // $30,000
    // First $1K × 1.2% = $12 = 1,200
    // Next $9K × 0.7% = $63 = 6,300
    // Next $20K × 0.3% = $60 = 6,000
    // Total = $135 = 13,500 minor
    expect(r.cost_minor).toBe(13_500);
  });

  it("computes $100,000 correctly (third bracket boundary)", () => {
    const r = computeTier1Cost(10_000_000); // $100,000
    // First $1K × 1.2% = $12 = 1,200
    // Next $9K × 0.7% = $63 = 6,300
    // Next $90K × 0.3% = $270 = 27,000
    // Total = $345 = 34,500 minor
    expect(r.cost_minor).toBe(34_500);
  });

  it("computes $500,000 correctly (fourth bracket)", () => {
    const r = computeTier1Cost(50_000_000); // $500,000
    // First $1K × 1.2% = $12 = 1,200
    // Next $9K × 0.7% = $63 = 6,300
    // Next $90K × 0.3% = $270 = 27,000
    // Next $400K × 0.15% = $600 = 60,000
    // Total = $945 = 94,500 minor
    expect(r.cost_minor).toBe(94_500);
  });

  it("returns 0 for amount 0", () => {
    expect(computeTier1Cost(0).cost_minor).toBe(0);
  });

  it("returns 0 for negative amount", () => {
    expect(computeTier1Cost(-1000).cost_minor).toBe(0);
  });

  it("includes breakdown entries", () => {
    const r = computeTier1Cost(500_000); // $5,000
    expect(r.breakdown.length).toBeGreaterThanOrEqual(2);
    expect(r.breakdown[0].rate).toBe(0.012);
    expect(r.breakdown[1].rate).toBe(0.007);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — 3%, min $20
// ---------------------------------------------------------------------------

describe("computeTier2Cost", () => {
  it("returns min $20 for $100 transaction", () => {
    const r = computeTier2Cost(10_000); // $100
    // $100 × 3% = $3 → min $20
    expect(r.cost_minor).toBe(2_000);
  });

  it("returns min $20 for $500 transaction", () => {
    const r = computeTier2Cost(50_000); // $500
    // $500 × 3% = $15 → min $20
    expect(r.cost_minor).toBe(2_000);
  });

  it("computes $1,000 correctly (above minimum)", () => {
    const r = computeTier2Cost(100_000); // $1,000
    // $1,000 × 3% = $30
    expect(r.cost_minor).toBe(3_000);
  });

  it("computes $10,000 correctly", () => {
    const r = computeTier2Cost(1_000_000); // $10,000
    // $10,000 × 3% = $300
    expect(r.cost_minor).toBe(30_000);
  });

  it("returns 0 for amount 0", () => {
    expect(computeTier2Cost(0).cost_minor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tier 3 — 6%, min $40
// ---------------------------------------------------------------------------

describe("computeTier3Cost", () => {
  it("returns min $40 for $100 transaction", () => {
    const r = computeTier3Cost(10_000); // $100
    // $100 × 6% = $6 → min $40
    expect(r.cost_minor).toBe(4_000);
  });

  it("returns min $40 for $500 transaction", () => {
    const r = computeTier3Cost(50_000); // $500
    // $500 × 6% = $30 → min $40
    expect(r.cost_minor).toBe(4_000);
  });

  it("computes $1,000 correctly (above minimum)", () => {
    const r = computeTier3Cost(100_000); // $1,000
    // $1,000 × 6% = $60
    expect(r.cost_minor).toBe(6_000);
  });

  it("computes $10,000 correctly", () => {
    const r = computeTier3Cost(1_000_000); // $10,000
    // $10,000 × 6% = $600
    expect(r.cost_minor).toBe(60_000);
  });

  it("returns 0 for amount 0", () => {
    expect(computeTier3Cost(0).cost_minor).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeDisputeCost (combined)
// ---------------------------------------------------------------------------

describe("computeDisputeCost", () => {
  it("delegates to correct tier function", () => {
    const t1 = computeDisputeCost(100_000, 1);
    const t2 = computeDisputeCost(100_000, 2);
    const t3 = computeDisputeCost(100_000, 3);
    expect(t1.tier).toBe(1);
    expect(t2.tier).toBe(2);
    expect(t3.tier).toBe(3);
    expect(t1.cost_minor).toBe(1_200); // $12
    expect(t2.cost_minor).toBe(3_000); // $30
    expect(t3.cost_minor).toBe(6_000); // $60
  });
});

// ---------------------------------------------------------------------------
// computeWorstCaseCost
// ---------------------------------------------------------------------------

describe("computeWorstCaseCost", () => {
  it("sums all 3 tiers for $1,000 transaction", () => {
    const r = computeWorstCaseCost(100_000); // $1,000
    expect(r.tier1_minor).toBe(1_200); // $12
    expect(r.tier2_minor).toBe(3_000); // $30
    expect(r.tier3_minor).toBe(6_000); // $60
    expect(r.total_minor).toBe(10_200); // $102
  });

  it("uses minimums for small transaction ($100)", () => {
    const r = computeWorstCaseCost(10_000); // $100
    expect(r.tier1_minor).toBe(120); // $1.20
    expect(r.tier2_minor).toBe(2_000); // $20 min
    expect(r.tier3_minor).toBe(4_000); // $40 min
    expect(r.total_minor).toBe(6_120); // $61.20
  });

  it("uses minimums for $10 transaction", () => {
    const r = computeWorstCaseCost(1_000); // $10
    expect(r.tier1_minor).toBe(100); // $1 min
    expect(r.tier2_minor).toBe(2_000); // $20 min
    expect(r.tier3_minor).toBe(4_000); // $40 min
    expect(r.total_minor).toBe(6_100); // $61
  });
});

// ---------------------------------------------------------------------------
// Escalation periods
// ---------------------------------------------------------------------------

describe("getEscalationPeriodHours", () => {
  it("Tier 1→2: always 24 hours", () => {
    expect(getEscalationPeriodHours(1, 1_000)).toBe(24);
    expect(getEscalationPeriodHours(1, 100_000)).toBe(24);
    expect(getEscalationPeriodHours(1, 10_000_000)).toBe(24);
  });

  it("Tier 2→3: 24h for ≤$500", () => {
    expect(getEscalationPeriodHours(2, 50_000)).toBe(24); // $500
    expect(getEscalationPeriodHours(2, 10_000)).toBe(24); // $100
  });

  it("Tier 2→3: 48h for $501-$5,000", () => {
    expect(getEscalationPeriodHours(2, 50_100)).toBe(48); // $501
    expect(getEscalationPeriodHours(2, 500_000)).toBe(48); // $5,000
  });

  it("Tier 2→3: 72h for $5,001+", () => {
    expect(getEscalationPeriodHours(2, 500_100)).toBe(72); // $5,001
    expect(getEscalationPeriodHours(2, 10_000_000)).toBe(72); // $100,000
  });
});

// ---------------------------------------------------------------------------
// Reviewer counts (v8.3)
// ---------------------------------------------------------------------------

describe("getReviewerCount", () => {
  it("returns 9/15 for ≤$500", () => {
    expect(getReviewerCount(50_000, 2)).toBe(9);
    expect(getReviewerCount(50_000, 3)).toBe(15);
  });

  it("returns 13/23 for $1K-$3K", () => {
    expect(getReviewerCount(200_000, 2)).toBe(13); // $2,000
    expect(getReviewerCount(200_000, 3)).toBe(23);
  });

  it("returns 19/33 for $5K-$10K", () => {
    expect(getReviewerCount(800_000, 2)).toBe(19); // $8,000
    expect(getReviewerCount(800_000, 3)).toBe(33);
  });

  it("returns 91/151 for $1M+", () => {
    expect(getReviewerCount(200_000_000, 2)).toBe(91); // $2M
    expect(getReviewerCount(200_000_000, 3)).toBe(151);
  });
});
