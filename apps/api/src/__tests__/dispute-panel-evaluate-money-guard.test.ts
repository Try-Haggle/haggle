import { describe, expect, it } from "vitest";
import {
  assertDisputePanelEvaluateDoesNotMoveMoney,
  buildDisputePanelEvaluateMoneySafetyFields,
  DISPUTE_PANEL_EVALUATE_AUTO_APPLIED,
  DISPUTE_PANEL_EVALUATE_FORBIDDEN_MONEY_SIDE_EFFECTS,
} from "../lib/dispute-panel-evaluate-money-guard.js";

describe("dispute-panel-evaluate-money-guard (E2)", () => {
  it("keeps panel evaluate auto_applied permanently false", () => {
    expect(DISPUTE_PANEL_EVALUATE_AUTO_APPLIED).toBe(false);
    expect(buildDisputePanelEvaluateMoneySafetyFields()).toEqual({ auto_applied: false });
  });

  it("lists the money side-effects panel evaluate must never invoke alone", () => {
    expect(DISPUTE_PANEL_EVALUATE_FORBIDDEN_MONEY_SIDE_EFFECTS).toEqual([
      "finalizeDisputeResolution",
      "executeRefund",
      "refundDeposit",
      "createRefundRecord",
      "createSettlementReleaseRecord",
      "updateCommerceOrderStatus",
    ]);
  });

  it("accepts advisory evaluations with auto_applied false", () => {
    expect(() =>
      assertDisputePanelEvaluateDoesNotMoveMoney({
        ready: true,
        auto_applied: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertDisputePanelEvaluateDoesNotMoveMoney({
        ready: false,
      }),
    ).not.toThrow();
  });

  it("rejects any attempt to mark panel evaluate as auto-applied money movement", () => {
    expect(() =>
      assertDisputePanelEvaluateDoesNotMoveMoney({
        ready: true,
        auto_applied: true,
      }),
    ).toThrow(/must not set auto_applied=true/);
  });
});
