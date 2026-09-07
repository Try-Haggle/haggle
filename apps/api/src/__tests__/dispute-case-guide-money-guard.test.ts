import { describe, expect, it } from "vitest";
import {
  assertDisputeCaseGuideDoesNotMoveMoney,
  buildDisputeCaseGuideMoneySafetyFields,
  DISPUTE_CASE_GUIDE_AUTO_APPLIED,
  DISPUTE_CASE_GUIDE_FORBIDDEN_MONEY_SIDE_EFFECTS,
  DISPUTE_CASE_GUIDE_MONEY_MOVED,
} from "../lib/dispute-case-guide-money-guard.js";

describe("dispute-case-guide-money-guard (F1)", () => {
  it("keeps Case Guide money_moved and auto_applied permanently false", () => {
    expect(DISPUTE_CASE_GUIDE_MONEY_MOVED).toBe(false);
    expect(DISPUTE_CASE_GUIDE_AUTO_APPLIED).toBe(false);
    expect(buildDisputeCaseGuideMoneySafetyFields()).toEqual({
      money_moved: false,
      auto_applied: false,
    });
  });

  it("lists the money side-effects Case Guide must never invoke alone", () => {
    expect(DISPUTE_CASE_GUIDE_FORBIDDEN_MONEY_SIDE_EFFECTS).toEqual([
      "finalizeDisputeResolution",
      "executeRefund",
      "refundDeposit",
      "createRefundRecord",
      "createSettlementReleaseRecord",
      "updateCommerceOrderStatus",
    ]);
  });

  it("accepts advisory Case Guide payloads with money_moved/auto_applied false", () => {
    expect(() =>
      assertDisputeCaseGuideDoesNotMoveMoney({
        money_moved: false,
        auto_applied: false,
      }),
    ).not.toThrow();
    expect(() => assertDisputeCaseGuideDoesNotMoveMoney({})).not.toThrow();
  });

  it("rejects any attempt to mark Case Guide as money-moving", () => {
    expect(() =>
      assertDisputeCaseGuideDoesNotMoveMoney({
        money_moved: true,
      }),
    ).toThrow(/must not set money_moved=true/);
    expect(() =>
      assertDisputeCaseGuideDoesNotMoveMoney({
        auto_applied: true,
      }),
    ).toThrow(/must not set auto_applied=true/);
  });
});
