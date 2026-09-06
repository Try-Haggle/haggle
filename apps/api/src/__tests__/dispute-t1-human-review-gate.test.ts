import { describe, expect, it } from "vitest";
import {
  assertT1AutoReleaseForbidden,
  buildApprovedT1HumanReview,
  buildPendingT1HumanReview,
  DISPUTE_T1_AUTO_RELEASE_ENABLED,
  DISPUTE_T1_HUMAN_REVIEW_APPROVED,
  DISPUTE_T1_HUMAN_REVIEW_PENDING,
  t1HumanApprovalBlocksMoneyMovement,
} from "../lib/dispute-t1-human-review-gate.js";

describe("dispute-t1-human-review-gate (E2b)", () => {
  it("keeps T1 auto-release forbidden/default-off", () => {
    expect(DISPUTE_T1_AUTO_RELEASE_ENABLED).toBe(false);
    expect(() => assertT1AutoReleaseForbidden()).not.toThrow();
  });

  it("blocks money when T1 assess is COMPLETED without human approval", () => {
    expect(
      t1HumanApprovalBlocksMoneyMovement({
        tier: 1,
        ai_resolution_assessor: {
          status: "COMPLETED",
          assessment_id: "a1",
          auto_applied: false,
        },
        t1_human_review: null,
      }),
    ).toBe(true);

    expect(
      t1HumanApprovalBlocksMoneyMovement({
        tier: 1,
        ai_resolution_assessor: {
          status: "COMPLETED",
          assessment_id: "a1",
        },
        t1_human_review: buildPendingT1HumanReview({ assessment_id: "a1" }),
      }),
    ).toBe(true);
  });

  it("allows money path after reviewer approval binds to the assessment", () => {
    const approved = buildApprovedT1HumanReview({
      previous: buildPendingT1HumanReview({ assessment_id: "a1" }),
      assessment_id: "a1",
      approved_by: "admin-1",
      notes: "Looks correct",
    });
    expect(approved.status).toBe(DISPUTE_T1_HUMAN_REVIEW_APPROVED);
    expect(
      t1HumanApprovalBlocksMoneyMovement({
        tier: 1,
        ai_resolution_assessor: {
          status: "COMPLETED",
          assessment_id: "a1",
          auto_applied: false,
        },
        t1_human_review: approved,
      }),
    ).toBe(false);
  });

  it("still blocks when approval is for a stale assessment id", () => {
    expect(
      t1HumanApprovalBlocksMoneyMovement({
        tier: 1,
        ai_resolution_assessor: {
          status: "COMPLETED",
          assessment_id: "a2",
        },
        t1_human_review: buildApprovedT1HumanReview({
          assessment_id: "a1",
          approved_by: "admin-1",
        }),
      }),
    ).toBe(true);
  });

  it("does not apply the T1 gate at tier 2/3 or without COMPLETED assess", () => {
    expect(
      t1HumanApprovalBlocksMoneyMovement({
        tier: 2,
        ai_resolution_assessor: { status: "COMPLETED", assessment_id: "a1" },
        t1_human_review: null,
      }),
    ).toBe(false);
    expect(
      t1HumanApprovalBlocksMoneyMovement({
        tier: 1,
        ai_resolution_assessor: { status: "FAILED" },
        t1_human_review: null,
      }),
    ).toBe(false);
    expect(DISPUTE_T1_HUMAN_REVIEW_PENDING).toBe("PENDING_APPROVAL");
  });
});
