import { describe, expect, it } from "vitest";
import {
  assertDisputeAiAssessmentDoesNotMoveMoney,
  buildDisputeAiAssessmentMoneySafetyFields,
  DISPUTE_AI_ASSESSMENT_AUTO_APPLIED,
  DISPUTE_AI_ASSESSMENT_FORBIDDEN_MONEY_SIDE_EFFECTS,
} from "../lib/dispute-ai-assessment-money-guard.js";

describe("dispute-ai-assessment-money-guard (B5)", () => {
  it("keeps L1 AI assessment auto_applied permanently false", () => {
    expect(DISPUTE_AI_ASSESSMENT_AUTO_APPLIED).toBe(false);
    expect(buildDisputeAiAssessmentMoneySafetyFields()).toEqual({ auto_applied: false });
  });

  it("lists the money side-effects assessment must never invoke alone", () => {
    expect(DISPUTE_AI_ASSESSMENT_FORBIDDEN_MONEY_SIDE_EFFECTS).toEqual([
      "finalizeDisputeResolution",
      "executeRefund",
      "refundDeposit",
      "createRefundRecord",
      "createSettlementReleaseRecord",
      "updateCommerceOrderStatus",
    ]);
  });

  it("accepts completed advisory assessments with auto_applied false", () => {
    expect(() =>
      assertDisputeAiAssessmentDoesNotMoveMoney({
        status: "COMPLETED",
        auto_applied: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertDisputeAiAssessmentDoesNotMoveMoney({
        status: "COMPLETED",
      }),
    ).not.toThrow();
  });

  it("rejects any attempt to mark assessment as auto-applied money movement", () => {
    expect(() =>
      assertDisputeAiAssessmentDoesNotMoveMoney({
        status: "COMPLETED",
        auto_applied: true,
      }),
    ).toThrow(/must not set auto_applied=true/);
  });
});
