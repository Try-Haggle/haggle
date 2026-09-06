import { describe, expect, it, vi } from "vitest";
import { DISPUTE_PANEL_EVALUATE_FORBIDDEN_MONEY_SIDE_EFFECTS } from "../lib/dispute-panel-evaluate-money-guard.js";
import {
  buildPanelReviewEvaluation,
  mapReviewerAssignmentsToPanelVotes,
} from "../services/dispute-panel-evaluate.service.js";

vi.mock("../services/dispute-record.service.js", () => ({
  getDisputeById: vi.fn(),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/payment-record.service.js", () => ({
  getCommerceOrderByOrderId: vi.fn(),
}));

import {
  evaluateDisputePanel,
  listReviewerAssignmentsForDispute,
} from "../services/dispute-panel-evaluate.service.js";
import { getDisputeById, updateDisputeRecord } from "../services/dispute-record.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";

const mockGetDisputeById = getDisputeById as ReturnType<typeof vi.fn>;
const mockUpdateDisputeRecord = updateDisputeRecord as ReturnType<typeof vi.fn>;
const mockGetCommerceOrderByOrderId = getCommerceOrderByOrderId as ReturnType<typeof vi.fn>;

describe("E2 panel evaluatePanelReview wiring goldens", () => {
  it("T2 insufficient assignments → not ready", () => {
    const result = buildPanelReviewEvaluation({
      dispute_id: "d1",
      tier: 2,
      amount_cents: 50_000,
      assignments: [
        { reviewerId: "r1", voteValue: 70, voteWeight: "1" },
        { reviewerId: "r2", voteValue: 72, voteWeight: "1" },
        { reviewerId: "r3", voteValue: 68, voteWeight: "1" },
      ],
    });
    expect(result).toMatchObject({
      ready: false,
      issues: ["INSUFFICIENT_ASSIGNMENTS"],
      expected_reviewer_count: 5,
      assigned_count: 3,
    });
  });

  it("T2 pending votes → not ready", () => {
    const result = buildPanelReviewEvaluation({
      dispute_id: "d1",
      tier: 2,
      amount_cents: 50_000,
      assignments: [
        { reviewerId: "r1", voteValue: 70, voteWeight: "1" },
        { reviewerId: "r2", voteValue: 72, voteWeight: "1" },
        { reviewerId: "r3", voteValue: null, voteWeight: "1" },
        { reviewerId: "r4", voteValue: 65, voteWeight: "1" },
        { reviewerId: "r5", voteValue: 68, voteWeight: "1" },
      ],
    });
    expect(result).toMatchObject({
      ready: false,
      issues: ["PENDING_VOTES"],
      assigned_count: 5,
      voted_count: 4,
    });
  });

  it("ready → outcome computation only", () => {
    const result = buildPanelReviewEvaluation({
      dispute_id: "d1",
      tier: 2,
      amount_cents: 50_000,
      assignments: [
        { reviewerId: "r1", voteValue: 70, voteWeight: "1" },
        { reviewerId: "r2", voteValue: 68, voteWeight: "1" },
        { reviewerId: "r3", voteValue: 72, voteWeight: "1" },
        { reviewerId: "r4", voteValue: 65, voteWeight: "1" },
        { reviewerId: "r5", voteValue: 20, voteWeight: "1" },
      ],
    });
    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.outcome).toBe("partial_refund");
    expect(result.refund_amount_minor).toBe(34_000);
    expect(
      mapReviewerAssignmentsToPanelVotes([
        { reviewerId: "r1", voteValue: 10, voteWeight: null },
      ])[0],
    ).toMatchObject({ weight: 0.63, vote: 10 });
  });

  it("evaluateDisputePanel persists judgment only — money path not called", async () => {
    mockGetDisputeById.mockResolvedValue({
      id: "some-id",
      order_id: "ord_1",
      status: "UNDER_REVIEW",
      evidence: [],
      metadata: { tier: 2 },
    });
    mockGetCommerceOrderByOrderId.mockResolvedValue({
      id: "ord_1",
      amountMinor: "50000",
    });

    const assignments = [
      { reviewerId: "r1", voteValue: 70, voteWeight: "1" },
      { reviewerId: "r2", voteValue: 68, voteWeight: "1" },
      { reviewerId: "r3", voteValue: 72, voteWeight: "1" },
      { reviewerId: "r4", voteValue: 65, voteWeight: "1" },
      { reviewerId: "r5", voteValue: 20, voteWeight: "1" },
    ];

    const result = await evaluateDisputePanel({} as never, "some-id", {
      persist: true,
      assignments,
    });
    expect(result.evaluation.ready).toBe(true);
    expect(result.auto_applied).toBe(false);
    expect(result.dispute_status).toBe("UNDER_REVIEW");
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "UNDER_REVIEW",
        metadata: expect.objectContaining({
          panel_review_evaluation: expect.objectContaining({
            ready: true,
            auto_applied: false,
            outcome: "partial_refund",
          }),
        }),
      }),
    );

    // Source-level invariant: forbidden money side-effect names remain listed.
    expect(DISPUTE_PANEL_EVALUATE_FORBIDDEN_MONEY_SIDE_EFFECTS).toEqual([
      "finalizeDisputeResolution",
      "executeRefund",
      "refundDeposit",
      "createRefundRecord",
      "createSettlementReleaseRecord",
      "updateCommerceOrderStatus",
    ]);
    expect(typeof listReviewerAssignmentsForDispute).toBe("function");
  });

  it("evaluateDisputePanel returns not-ready without changing status when votes pending", async () => {
    mockGetDisputeById.mockResolvedValue({
      id: "some-id",
      order_id: "ord_1",
      status: "UNDER_REVIEW",
      evidence: [],
      metadata: { tier: 2 },
    });
    mockGetCommerceOrderByOrderId.mockResolvedValue({
      id: "ord_1",
      amountMinor: "50000",
    });
    const assignments = [
      { reviewerId: "r1", voteValue: 70, voteWeight: "1" },
      { reviewerId: "r2", voteValue: null, voteWeight: "1" },
      { reviewerId: "r3", voteValue: 72, voteWeight: "1" },
      { reviewerId: "r4", voteValue: 65, voteWeight: "1" },
      { reviewerId: "r5", voteValue: 68, voteWeight: "1" },
    ];

    const result = await evaluateDisputePanel({} as never, "some-id", {
      persist: true,
      assignments,
    });
    expect(result.evaluation).toMatchObject({
      ready: false,
      issues: ["PENDING_VOTES"],
    });
    expect(result.auto_applied).toBe(false);
    expect(mockUpdateDisputeRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "UNDER_REVIEW" }),
    );
  });
});

it("reviewer tally path stays money-inert (no finalize import)", async () => {
  const fs = await import("node:fs/promises");
  const pathMod = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const reviewerSrc = await fs.readFile(
    pathMod.resolve(pathMod.dirname(fileURLToPath(import.meta.url)), "../routes/reviewer.ts"),
    "utf8",
  );
  expect(reviewerSrc).toMatch(/evaluateDisputePanel/);
  expect(reviewerSrc).not.toMatch(/from "\.\.\/services\/dispute-resolution-finalizer/);
  expect(reviewerSrc).not.toMatch(/await finalizeDisputeResolution\(/);
});
