/**
 * First-party T2/T3 panel evaluate (CTO ticket E2).
 *
 * Loads assignment + votes, calls dispute-core `evaluatePanelReview`, and
 * returns judgment/outcome computation only. Does not refund, release, settle,
 * or call `finalizeDisputeResolution`.
 */

import type { Database } from "@haggle/db";
import { eq, reviewerAssignments } from "@haggle/db";
import type { DisputeCase } from "@haggle/dispute-core";
import {
  evaluatePanelReview,
  type PanelReviewAssignment,
  type PanelReviewEvaluation,
} from "@haggle/dispute-core";
import {
  assertDisputePanelEvaluateDoesNotMoveMoney,
  buildDisputePanelEvaluateMoneySafetyFields,
  DISPUTE_PANEL_EVALUATE_AUTO_APPLIED,
} from "../lib/dispute-panel-evaluate-money-guard.js";
import { getDisputeById, updateDisputeRecord } from "./dispute-record.service.js";
import { getCommerceOrderByOrderId } from "./payment-record.service.js";

export type DisputePanelAssignmentRow = {
  reviewerId: string;
  voteValue: number | null;
  voteWeight: string | null;
};

export type DisputePanelEvaluateResult = {
  dispute_id: string;
  dispute_status: DisputeCase["status"];
  tier: number;
  amount_cents: number;
  evaluation: PanelReviewEvaluation;
  auto_applied: typeof DISPUTE_PANEL_EVALUATE_AUTO_APPLIED;
  persisted: boolean;
};

export function mapReviewerAssignmentsToPanelVotes(
  rows: DisputePanelAssignmentRow[],
): PanelReviewAssignment[] {
  return rows.map((assignment) => ({
    reviewer_id: assignment.reviewerId,
    vote: assignment.voteValue,
    weight: assignment.voteWeight ? parseFloat(assignment.voteWeight) : 0.63,
  }));
}

export async function listReviewerAssignmentsForDispute(
  db: Database,
  disputeId: string,
): Promise<DisputePanelAssignmentRow[]> {
  const rows = await db
    .select({
      reviewerId: reviewerAssignments.reviewerId,
      voteValue: reviewerAssignments.voteValue,
      voteWeight: reviewerAssignments.voteWeight,
    })
    .from(reviewerAssignments)
    .where(eq(reviewerAssignments.disputeId, disputeId));
  return rows;
}

export function buildPanelReviewEvaluation(params: {
  dispute_id: string;
  tier: number;
  amount_cents: number;
  assignments: DisputePanelAssignmentRow[];
}): PanelReviewEvaluation {
  return evaluatePanelReview({
    dispute_id: params.dispute_id,
    tier: params.tier,
    amount_cents: params.amount_cents,
    assignments: mapReviewerAssignmentsToPanelVotes(params.assignments),
  });
}

function panelEvaluationMetadataPayload(
  evaluation: PanelReviewEvaluation,
  evaluatedAt: string,
): Record<string, unknown> {
  const moneySafety = buildDisputePanelEvaluateMoneySafetyFields();
  assertDisputePanelEvaluateDoesNotMoveMoney(moneySafety);

  if (!evaluation.ready) {
    return {
      status: "NOT_READY",
      ready: false,
      issues: evaluation.issues,
      expected_reviewer_count: evaluation.expected_reviewer_count,
      assigned_count: evaluation.assigned_count,
      voted_count: evaluation.voted_count,
      evaluated_at: evaluatedAt,
      ...moneySafety,
    };
  }

  return {
    status: "READY",
    ready: true,
    tier: evaluation.tier,
    outcome: evaluation.outcome,
    refund_amount_minor: evaluation.refund_amount_minor,
    expected_reviewer_count: evaluation.expected_reviewer_count,
    assigned_count: evaluation.assigned_count,
    voted_count: evaluation.voted_count,
    majority_count: evaluation.majority_count,
    total_reward_cents: evaluation.total_reward_cents,
    aggregation: evaluation.aggregation,
    cost: evaluation.cost,
    rewards: evaluation.rewards,
    evaluated_at: evaluatedAt,
    ...moneySafety,
  };
}

/**
 * Evaluate T2/T3 panel readiness and outcome. Persists advisory metadata only.
 * Never changes dispute status to a money-moving terminal resolution.
 */
export async function evaluateDisputePanel(
  db: Database,
  disputeId: string,
  options: { persist?: boolean; assignments?: DisputePanelAssignmentRow[] } = {},
): Promise<DisputePanelEvaluateResult> {
  const persist = options.persist !== false;

  const dispute = await getDisputeById(db, disputeId);
  if (!dispute) {
    throw new Error("DISPUTE_NOT_FOUND");
  }

  const order = await getCommerceOrderByOrderId(db, dispute.order_id);
  const amountCents = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;
  const tier = ((dispute.metadata as Record<string, unknown> | null)?.tier as number) ?? 2;
  const assignments =
    options.assignments ?? (await listReviewerAssignmentsForDispute(db, disputeId));

  const evaluation = buildPanelReviewEvaluation({
    dispute_id: disputeId,
    tier,
    amount_cents: amountCents,
    assignments,
  });

  const evaluatedAt = new Date().toISOString();
  const panelMeta = panelEvaluationMetadataPayload(evaluation, evaluatedAt);
  assertDisputePanelEvaluateDoesNotMoveMoney(panelMeta);

  let persisted = false;
  if (persist) {
    // Keep case status unchanged — judgment only; resolve/finalizer moves money.
    await updateDisputeRecord(db, {
      ...dispute,
      metadata: {
        ...((dispute.metadata as Record<string, unknown>) ?? {}),
        panel_review_evaluation: panelMeta,
      },
    });
    persisted = true;
  }

  return {
    dispute_id: disputeId,
    dispute_status: dispute.status,
    tier,
    amount_cents: amountCents,
    evaluation,
    auto_applied: DISPUTE_PANEL_EVALUATE_AUTO_APPLIED,
    persisted,
  };
}
