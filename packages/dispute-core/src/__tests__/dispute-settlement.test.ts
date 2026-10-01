import { describe, expect, it } from "vitest";
import { createDepositRequirement, recordDeposit } from "../dispute-deposit.js";
import { createSettlementHold, resolveSettlement } from "../dispute-settlement.js";

const now = "2026-10-01T00:00:00Z";

function fundedBonds(amountCents: number) {
  let bonds = createDepositRequirement("dispute", 2, amountCents);
  bonds = recordDeposit(bonds, now, "buyer");
  return recordDeposit(bonds, now, "seller");
}

function hold(amountCents = 50_000) {
  return createSettlementHold("dispute", "order", amountCents, now);
}

describe("review bond settlement", () => {
  it("keeps the $500 principal whole when the buyer wins", () => {
    const result = resolveSettlement(
      hold(),
      "buyer_favor",
      undefined,
      fundedBonds(1_200),
      1_200,
      now,
    );
    expect(result.buyer_receives_cents).toBe(50_000);
    expect(result.seller_receives_cents).toBe(0);
    expect(result.buyer_deposit_refund_cents).toBe(1_200);
    expect(result.seller_deposit_refund_cents).toBe(0);
    expect(result.reviewer_receives_cents).toBe(840);
    expect(result.platform_receives_cents).toBe(360);
  });

  it("keeps the $500 principal whole when the seller wins", () => {
    const result = resolveSettlement(
      hold(),
      "seller_favor",
      undefined,
      fundedBonds(1_200),
      1_200,
      now,
    );
    expect(result.seller_receives_cents).toBe(50_000);
    expect(result.buyer_receives_cents).toBe(0);
    expect(result.seller_deposit_refund_cents).toBe(1_200);
    expect(result.buyer_deposit_refund_cents).toBe(0);
    expect(result.reviewer_receives_cents + result.platform_receives_cents).toBe(1_200);
  });

  it("returns unused losing bond instead of treating it as extra revenue", () => {
    const result = resolveSettlement(
      hold(),
      "buyer_favor",
      undefined,
      fundedBonds(2_000),
      1_200,
      now,
    );
    expect(result.seller_deposit_refund_cents).toBe(800);
    expect(result.buyer_deposit_refund_cents).toBe(2_000);
    expect(result.reviewer_receives_cents + result.platform_receives_cents).toBe(1_200);
  });

  it("keeps partial-refund principal separate and charges the seller bond", () => {
    const result = resolveSettlement(
      hold(),
      "partial_refund",
      20_000,
      fundedBonds(1_200),
      1_200,
      now,
    );
    expect(result.buyer_receives_cents).toBe(20_000);
    expect(result.seller_receives_cents).toBe(30_000);
    expect(result.buyer_deposit_refund_cents).toBe(1_200);
    expect(result.seller_deposit_refund_cents).toBe(0);
  });

  it("does not collect T1 review fees from the order without a separate source", () => {
    const result = resolveSettlement(hold(), "seller_favor", undefined, null, 500, now);
    expect(result.seller_receives_cents).toBe(50_000);
    expect(result.dispute_cost_cents).toBe(0);
    expect(result.reviewer_receives_cents).toBe(0);
    expect(result.platform_receives_cents).toBe(0);
  });

  it("requires both funded bonds and enough money before charging a fee", () => {
    const buyerOnly = recordDeposit(createDepositRequirement("dispute", 2, 1_200), now, "buyer");
    expect(() =>
      resolveSettlement(hold(), "buyer_favor", undefined, buyerOnly, 1_200, now),
    ).toThrow("Both review deposits must be funded");
    expect(() =>
      resolveSettlement(hold(), "buyer_favor", undefined, fundedBonds(1_000), 1_200, now),
    ).toThrow("Losing party deposit cannot cover dispute cost");
  });

  it("conserves the principal and both bonds in either outcome", () => {
    for (const outcome of ["buyer_favor", "seller_favor", "partial_refund"] as const) {
      const result = resolveSettlement(
        hold(),
        outcome,
        outcome === "partial_refund" ? 20_000 : undefined,
        fundedBonds(1_200),
        1_200,
        now,
      );
      expect(
        result.buyer_receives_cents +
          result.seller_receives_cents +
          result.buyer_deposit_refund_cents +
          result.seller_deposit_refund_cents +
          result.reviewer_receives_cents +
          result.platform_receives_cents,
      ).toBe(52_400);
    }
  });

  it("rejects a second resolution and invalid partial refund", () => {
    const result = resolveSettlement(
      hold(),
      "buyer_favor",
      undefined,
      fundedBonds(1_200),
      1_200,
      now,
    );
    expect(() =>
      resolveSettlement(result.hold, "seller_favor", undefined, fundedBonds(1_200), 1_200, now),
    ).toThrow("Settlement is already");
    expect(() =>
      resolveSettlement(hold(), "partial_refund", 60_000, fundedBonds(1_200), 1_200, now),
    ).toThrow("cannot exceed held_amount_cents");
  });
});
