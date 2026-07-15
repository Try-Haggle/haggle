import { describe, expect, it } from "vitest";
import { evaluatePanelReview, type PanelReviewAssignment } from "../panel-review.js";

function assignments(votes: Array<number | null>): PanelReviewAssignment[] {
  return votes.map((vote, index) => ({
    reviewer_id: `reviewer-${index + 1}`,
    vote,
    weight: 1,
  }));
}

describe("evaluatePanelReview", () => {
  it("rejects non-panel tiers", () => {
    const result = evaluatePanelReview({
      dispute_id: "dispute-1",
      tier: 1,
      amount_cents: 50_000,
      assignments: assignments([60, 62, 65, 63, 61]),
    });

    expect(result).toMatchObject({
      ready: false,
      issues: ["INVALID_TIER"],
    });
  });

  it("blocks tally when the full tier panel was not assigned", () => {
    const result = evaluatePanelReview({
      dispute_id: "dispute-1",
      tier: 2,
      amount_cents: 50_000,
      assignments: assignments([75, 70, 72]),
    });

    expect(result).toMatchObject({
      ready: false,
      expected_reviewer_count: 5,
      assigned_count: 3,
      voted_count: 3,
      issues: ["INSUFFICIENT_ASSIGNMENTS"],
    });
  });

  it("blocks tally while assigned reviewer votes are pending", () => {
    const result = evaluatePanelReview({
      dispute_id: "dispute-1",
      tier: 2,
      amount_cents: 50_000,
      assignments: assignments([75, 70, null, 72, 68]),
    });

    expect(result).toMatchObject({
      ready: false,
      expected_reviewer_count: 5,
      assigned_count: 5,
      voted_count: 4,
      issues: ["PENDING_VOTES"],
    });
  });

  it("rejects invalid vote and weight values before aggregation", () => {
    const result = evaluatePanelReview({
      dispute_id: "dispute-1",
      tier: 2,
      amount_cents: 50_000,
      assignments: [
        ...assignments([75, 70, 72, 68]),
        { reviewer_id: "bad-reviewer", vote: 101, weight: 0 },
      ],
    });

    expect(result).toMatchObject({
      ready: false,
      issues: ["INVALID_ASSIGNMENT"],
    });
  });

  it("returns a Tier 2 partial refund decision with majority rewards", () => {
    const result = evaluatePanelReview({
      dispute_id: "dispute-1",
      tier: 2,
      amount_cents: 50_000,
      assignments: assignments([70, 68, 72, 65, 20]),
    });

    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.outcome).toBe("partial_refund");
    expect(result.refund_amount_minor).toBe(34_000);
    expect(result.cost.cost_cents).toBe(1_200);
    expect(result.total_reward_cents).toBe(840);
    expect(result.majority_count).toBe(4);
    expect(result.rewards.filter((reward) => reward.in_majority)).toHaveLength(4);
    expect(result.rewards.find((reward) => reward.reviewer_id === "reviewer-5")?.reward_cents).toBe(
      0,
    );
  });

  it("requires the larger Tier 3 panel", () => {
    const result = evaluatePanelReview({
      dispute_id: "dispute-1",
      tier: 3,
      amount_cents: 50_000,
      assignments: assignments([95, 93, 94, 96, 91, 92, 90]),
    });

    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.expected_reviewer_count).toBe(7);
    expect(result.outcome).toBe("buyer_favor");
    expect(result.refund_amount_minor).toBe(50_000);
    expect(result.cost.cost_cents).toBe(3_000);
  });
});
