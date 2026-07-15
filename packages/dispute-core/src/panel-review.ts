import { computeDisputeCost, getReviewerCount } from "./dispute-cost.js";
import {
  type AggregationResult,
  type DisputeCostResult,
  REVIEWER_SHARE,
  type ReviewerVote,
} from "./types.js";
import { aggregateVotes } from "./vote-aggregation.js";

export type PanelReviewTier = 2 | 3;
export type PanelReviewOutcome = "buyer_favor" | "seller_favor" | "partial_refund";

export interface PanelReviewAssignment {
  reviewer_id: string;
  vote: number | null;
  weight: number;
}

export type PanelReviewReadinessIssue =
  | "INVALID_TIER"
  | "INVALID_AMOUNT"
  | "INVALID_ASSIGNMENT"
  | "INSUFFICIENT_ASSIGNMENTS"
  | "PENDING_VOTES";

export interface PanelReviewerReward {
  reviewer_id: string;
  reward_cents: number;
  in_majority: boolean;
}

export type PanelReviewEvaluation =
  | {
      ready: false;
      issues: PanelReviewReadinessIssue[];
      expected_reviewer_count: number | null;
      assigned_count: number;
      voted_count: number;
    }
  | {
      ready: true;
      tier: PanelReviewTier;
      cost: DisputeCostResult;
      expected_reviewer_count: number;
      assigned_count: number;
      voted_count: number;
      aggregation: AggregationResult;
      outcome: PanelReviewOutcome;
      refund_amount_minor: number;
      majority_count: number;
      total_reward_cents: number;
      rewards: PanelReviewerReward[];
    };

function normalizeAssignments(assignments: PanelReviewAssignment[]): ReviewerVote[] {
  return assignments
    .filter((assignment) => assignment.vote !== null)
    .map((assignment) => ({
      reviewer_id: assignment.reviewer_id,
      vote: assignment.vote ?? 0,
      weight: assignment.weight,
    }));
}

export function evaluatePanelReview(params: {
  dispute_id: string;
  tier: number;
  amount_cents: number;
  assignments: PanelReviewAssignment[];
}): PanelReviewEvaluation {
  const issues: PanelReviewReadinessIssue[] = [];
  if (params.tier !== 2 && params.tier !== 3) {
    issues.push("INVALID_TIER");
  }
  if (!Number.isFinite(params.amount_cents) || params.amount_cents <= 0) {
    issues.push("INVALID_AMOUNT");
  }

  const tier = params.tier === 2 || params.tier === 3 ? params.tier : null;
  const expectedReviewerCount =
    tier && params.amount_cents > 0 ? getReviewerCount(params.amount_cents, tier) : null;
  const assignedCount = params.assignments.length;
  const votedCount = params.assignments.filter((assignment) => assignment.vote !== null).length;
  const hasInvalidAssignment = params.assignments.some(
    (assignment) =>
      !Number.isFinite(assignment.weight) ||
      assignment.weight <= 0 ||
      (assignment.vote !== null &&
        (!Number.isInteger(assignment.vote) || assignment.vote < 0 || assignment.vote > 100)),
  );

  if (hasInvalidAssignment) {
    issues.push("INVALID_ASSIGNMENT");
  }
  if (expectedReviewerCount !== null && assignedCount < expectedReviewerCount) {
    issues.push("INSUFFICIENT_ASSIGNMENTS");
  }
  if (assignedCount !== votedCount) {
    issues.push("PENDING_VOTES");
  }

  if (issues.length > 0 || tier === null || expectedReviewerCount === null) {
    return {
      ready: false,
      issues,
      expected_reviewer_count: expectedReviewerCount,
      assigned_count: assignedCount,
      voted_count: votedCount,
    };
  }

  const votes = normalizeAssignments(params.assignments);
  const aggregation = aggregateVotes(votes, params.dispute_id);
  const cost = computeDisputeCost(params.amount_cents, tier);
  const buyerPct = aggregation.weighted_median / 100;
  const outcome: PanelReviewOutcome =
    aggregation.weighted_median < 50
      ? "seller_favor"
      : buyerPct >= 0.9
        ? "buyer_favor"
        : "partial_refund";
  const refundAmountMinor =
    outcome === "seller_favor"
      ? 0
      : outcome === "buyer_favor"
        ? params.amount_cents
        : Math.round(params.amount_cents * buyerPct);

  const medianSide = aggregation.weighted_median >= 50 ? "buyer" : "seller";
  const majorityIds = new Set(
    votes
      .filter((vote) => (medianSide === "buyer" ? vote.vote >= 50 : vote.vote < 50))
      .map((vote) => vote.reviewer_id),
  );
  const totalRewardCents = Math.round(cost.cost_cents * REVIEWER_SHARE);
  const majorityCount = majorityIds.size;
  const perReviewerReward = majorityCount > 0 ? Math.floor(totalRewardCents / majorityCount) : 0;

  return {
    ready: true,
    tier,
    cost,
    expected_reviewer_count: expectedReviewerCount,
    assigned_count: assignedCount,
    voted_count: votedCount,
    aggregation,
    outcome,
    refund_amount_minor: refundAmountMinor,
    majority_count: majorityCount,
    total_reward_cents: totalRewardCents,
    rewards: votes.map((vote) => {
      const inMajority = majorityIds.has(vote.reviewer_id);
      return {
        reviewer_id: vote.reviewer_id,
        reward_cents: inMajority ? perReviewerReward : 0,
        in_majority: inMajority,
      };
    }),
  };
}
