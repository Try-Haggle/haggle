import { describe, it, expect } from "vitest";
import {
  createSettlementHold,
  resolveSettlement,
} from "../dispute-settlement.js";
import { createDepositRequirement, recordDeposit } from "../dispute-deposit.js";
import { REVIEWER_SHARE } from "../types.js";

// ---------------------------------------------------------------------------
// createSettlementHold
// ---------------------------------------------------------------------------

describe("createSettlementHold", () => {
  it("creates a hold with HELD status", () => {
    const hold = createSettlementHold("d-100", "ord-100", 50_000, "2026-04-01T00:00:00Z");

    expect(hold.dispute_id).toBe("d-100");
    expect(hold.held_amount_cents).toBe(50_000);
    expect(hold.status).toBe("HELD");
  });

  it("throws on non-positive amount", () => {
    expect(() => createSettlementHold("d-101", "ord-101", 0, "2026-04-01T00:00:00Z"))
      .toThrow("amount_cents must be positive");
  });
});

// ---------------------------------------------------------------------------
// buyer_favor — buyer gets full refund, dispute cost from seller deposit
// ---------------------------------------------------------------------------

describe("resolveSettlement - buyer_favor", () => {
  it("buyer gets full escrow amount", () => {
    const hold = createSettlementHold("d-200", "ord-200", 100_000, "2026-04-01T00:00:00Z");
    const r = resolveSettlement(hold, "buyer_favor", undefined, null, 500, "2026-04-05T00:00:00Z");

    expect(r.buyer_receives_cents).toBe(100_000);
    expect(r.seller_receives_cents).toBe(0);
    expect(r.hold.status).toBe("REFUNDED");
  });

  it("dispute cost split: 70% reviewers, 30% platform", () => {
    const hold = createSettlementHold("d-201", "ord-201", 100_000, "2026-04-01T00:00:00Z");
    const dispute_cost = 2_000; // $20
    const r = resolveSettlement(hold, "buyer_favor", undefined, null, dispute_cost, "2026-04-05T00:00:00Z");

    expect(r.dispute_cost_cents).toBe(2_000);
    expect(r.reviewer_receives_cents).toBe(1_400); // 70%
    // platform gets 30% of dispute cost (no deposit here)
    expect(r.platform_receives_cents).toBe(600);
  });
});

// ---------------------------------------------------------------------------
// seller_favor — buyer lost, dispute cost deducted from escrow
// ---------------------------------------------------------------------------

describe("resolveSettlement - seller_favor", () => {
  it("dispute cost deducted from escrow, rest goes to seller", () => {
    const hold = createSettlementHold("d-300", "ord-300", 100_000, "2026-04-01T00:00:00Z");
    const dispute_cost = 2_000;
    const r = resolveSettlement(hold, "seller_favor", undefined, null, dispute_cost, "2026-04-05T00:00:00Z");

    expect(r.buyer_receives_cents).toBe(0);
    expect(r.seller_receives_cents).toBe(98_000); // 100,000 - 2,000
    expect(r.hold.status).toBe("RELEASED");
  });

  it("dispute cost goes to reviewers + platform, not seller", () => {
    const hold = createSettlementHold("d-301", "ord-301", 100_000, "2026-04-01T00:00:00Z");
    const dispute_cost = 6_000;
    const r = resolveSettlement(hold, "seller_favor", undefined, null, dispute_cost, "2026-04-05T00:00:00Z");

    expect(r.reviewer_receives_cents).toBe(4_200); // 70%
    expect(r.platform_receives_cents).toBe(1_800); // 30% (no deposit forfeiture)
    expect(r.seller_receives_cents).toBe(94_000);
  });

  it("seller gets deposit back when seller wins", () => {
    const hold = createSettlementHold("d-302", "ord-302", 100_000, "2026-04-01T00:00:00Z");
    let deposit = createDepositRequirement("d-302", 2, 2_000);
    deposit = recordDeposit(deposit, "2026-04-01T01:00:00Z");

    const r = resolveSettlement(hold, "seller_favor", undefined, deposit, 500, "2026-04-05T00:00:00Z");

    expect(r.deposit_refund_cents).toBe(2_000);
  });
});

// ---------------------------------------------------------------------------
// partial_refund — seller lost, dispute cost from seller deposit
// ---------------------------------------------------------------------------

describe("resolveSettlement - partial_refund", () => {
  it("splits escrow correctly, dispute cost from deposit", () => {
    const hold = createSettlementHold("d-400", "ord-400", 100_000, "2026-04-01T00:00:00Z");
    const r = resolveSettlement(hold, "partial_refund", 40_000, null, 2_000, "2026-04-05T00:00:00Z");

    expect(r.buyer_receives_cents).toBe(40_000);
    expect(r.seller_receives_cents).toBe(60_000);
    expect(r.hold.status).toBe("PARTIAL_REFUND");
  });

  it("throws if refund_amount exceeds held amount", () => {
    const hold = createSettlementHold("d-401", "ord-401", 50_000, "2026-04-01T00:00:00Z");
    expect(() => resolveSettlement(hold, "partial_refund", 60_000, null, 500, "2026-04-05T00:00:00Z"))
      .toThrow("refund_amount_cents cannot exceed held_amount_cents");
  });

  it("throws if refund_amount undefined", () => {
    const hold = createSettlementHold("d-402", "ord-402", 50_000, "2026-04-01T00:00:00Z");
    expect(() => resolveSettlement(hold, "partial_refund", undefined, null, 500, "2026-04-05T00:00:00Z"))
      .toThrow("refund_amount_cents is required for partial_refund");
  });
});

// ---------------------------------------------------------------------------
// deposit integration
// ---------------------------------------------------------------------------

describe("resolveSettlement - deposit handling", () => {
  it("seller deposit forfeited to platform when seller loses", () => {
    const hold = createSettlementHold("d-500", "ord-500", 100_000, "2026-04-01T00:00:00Z");
    let deposit = createDepositRequirement("d-500", 2, 2_000);
    deposit = recordDeposit(deposit, "2026-04-01T01:00:00Z");

    const dispute_cost = 500; // Tier 1 cost
    const r = resolveSettlement(hold, "buyer_favor", undefined, deposit, dispute_cost, "2026-04-05T00:00:00Z");

    // platform gets: 30% of dispute cost + forfeited deposit
    const platform_from_cost = dispute_cost - Math.round(dispute_cost * REVIEWER_SHARE);
    expect(r.platform_receives_cents).toBe(platform_from_cost + 2_000);
    expect(r.deposit_refund_cents).toBe(0);
  });

  it("no deposit forfeiture when seller wins", () => {
    const hold = createSettlementHold("d-501", "ord-501", 100_000, "2026-04-01T00:00:00Z");
    let deposit = createDepositRequirement("d-501", 3, 6_000);
    deposit = recordDeposit(deposit, "2026-04-01T01:00:00Z");

    const dispute_cost = 6_000;
    const r = resolveSettlement(hold, "seller_favor", undefined, deposit, dispute_cost, "2026-04-05T00:00:00Z");

    // platform gets only 30% of dispute cost, no deposit
    expect(r.platform_receives_cents).toBe(dispute_cost - Math.round(dispute_cost * REVIEWER_SHARE));
    expect(r.deposit_refund_cents).toBe(6_000);
  });
});

// ---------------------------------------------------------------------------
// Tier 1 — no deposit, fixed $5 cost
// ---------------------------------------------------------------------------

describe("resolveSettlement - Tier 1 (no deposits)", () => {
  it("Tier 1 cost ($5) still goes to reviewers + platform", () => {
    const hold = createSettlementHold("d-600", "ord-600", 30_000, "2026-04-01T00:00:00Z");
    const r = resolveSettlement(hold, "buyer_favor", undefined, null, 500, "2026-04-05T00:00:00Z");

    expect(r.dispute_cost_cents).toBe(500);
    expect(r.reviewer_receives_cents).toBe(350);
    expect(r.platform_receives_cents).toBe(150);
    expect(r.deposit_refund_cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// invariants
// ---------------------------------------------------------------------------

describe("resolveSettlement - invariants", () => {
  it("reviewer + platform = dispute_cost + forfeited_deposit", () => {
    const hold = createSettlementHold("d-700", "ord-700", 100_000, "2026-04-01T00:00:00Z");
    let deposit = createDepositRequirement("d-700", 2, 2_500);
    deposit = recordDeposit(deposit, "2026-04-01T01:00:00Z");

    const dispute_cost = 2_000;
    const r = resolveSettlement(hold, "buyer_favor", undefined, deposit, dispute_cost, "2026-04-05T00:00:00Z");

    // reviewer gets from dispute cost only, platform gets dispute cost share + deposit
    expect(r.reviewer_receives_cents + r.platform_receives_cents)
      .toBe(dispute_cost + deposit.amount_cents);
  });

  it("seller_favor: buyer + seller + dispute_cost = held_amount", () => {
    const hold = createSettlementHold("d-701", "ord-701", 100_000, "2026-04-01T00:00:00Z");
    const dispute_cost = 2_900;
    const r = resolveSettlement(hold, "seller_favor", undefined, null, dispute_cost, "2026-04-05T00:00:00Z");

    expect(r.buyer_receives_cents + r.seller_receives_cents + r.dispute_cost_cents)
      .toBe(hold.held_amount_cents);
  });
});

// ---------------------------------------------------------------------------
// error cases
// ---------------------------------------------------------------------------

describe("resolveSettlement - errors", () => {
  it("throws if already resolved", () => {
    const hold = createSettlementHold("d-800", "ord-800", 50_000, "2026-04-01T00:00:00Z");
    const r = resolveSettlement(hold, "buyer_favor", undefined, null, 500, "2026-04-05T00:00:00Z");

    expect(() => resolveSettlement(r.hold, "seller_favor", undefined, null, 500, "2026-04-06T00:00:00Z"))
      .toThrow("Settlement is already REFUNDED, cannot resolve");
  });
});
