import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import {
  reviewerAssignments,
  reviewerProfiles,
  disputeCases,
  commerceOrders,
  disputeEvidence as disputeEvidenceTable,
  eq,
  and,
  sql,
  isNull,
  inArray,
} from "@haggle/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth.js";
import {
  aggregateVotes,
  getReviewerCount,
  computeDisputeCost,
  REVIEWER_SHARE,
} from "@haggle/dispute-core";
import type { ReviewerVote, DisputeTier, DisputeResolution } from "@haggle/dispute-core";
import { getDisputeById } from "../services/dispute-record.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";

// ---------------------------------------------------------------------------
// Qualification test cases (hardcoded precedent cases for MVP)
// ---------------------------------------------------------------------------

const QUALIFICATION_CASES: Array<{ case_index: number; correct_vote: number; description: string }> = [
  { case_index: 0, correct_vote: 85, description: "Clear buyer favor: item not delivered, seller unresponsive" },
  { case_index: 1, correct_vote: 20, description: "Seller favor: buyer remorse, item as described" },
  { case_index: 2, correct_vote: 55, description: "Slight buyer lean: minor damage not in listing" },
  { case_index: 3, correct_vote: 90, description: "Strong buyer favor: counterfeit item with proof" },
  { case_index: 4, correct_vote: 10, description: "Strong seller favor: buyer damaged item after receipt" },
  { case_index: 5, correct_vote: 50, description: "True toss-up: conflicting evidence, no tracking" },
  { case_index: 6, correct_vote: 70, description: "Moderate buyer favor: shipping damage, unclear liability" },
  { case_index: 7, correct_vote: 30, description: "Moderate seller favor: item works but not as expected" },
  { case_index: 8, correct_vote: 75, description: "Buyer favor: wrong item shipped, seller acknowledges" },
  { case_index: 9, correct_vote: 40, description: "Slight seller lean: late delivery but within tolerance" },
];

const QUALIFY_MATCH_TOLERANCE = 15;
const QUALIFY_PASS_RATE = 0.70;
const QUALIFY_CONDITIONAL_RATE = 0.60;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const voteSchema = z.object({
  vote: z.number().int().min(0).max(100),
  reasoning: z.string().max(2000).optional(),
});

const qualifySchema = z.object({
  votes: z.array(
    z.object({
      case_index: z.number().int().min(0).max(9),
      vote: z.number().int().min(0).max(100),
    }),
  ).length(10),
});

const assignmentListQuerySchema = z.object({
  status: z.enum(["active", "voted", "decided", "all"]).default("all"),
});

// ---------------------------------------------------------------------------
// Service functions (can be called internally, not just via HTTP)
// ---------------------------------------------------------------------------

/**
 * Assign reviewers to a dispute. Called from escalation or admin endpoint.
 * Returns the number of assigned reviewers and their IDs.
 */
export async function assignReviewersToDispute(
  db: Database,
  disputeId: string,
  disputeTier: DisputeTier,
  amountCents: number,
  buyerId: string,
  sellerId: string,
): Promise<{ assigned: number; reviewers: string[] }> {
  if (disputeTier === 1) {
    return { assigned: 0, reviewers: [] };
  }

  const reviewerCount = getReviewerCount(amountCents, disputeTier as 2 | 3);

  // Query qualified reviewers who have available slots, excluding dispute parties
  const excludeIds = [buyerId, sellerId];
  const candidates = await db
    .select({
      userId: reviewerProfiles.userId,
      voteWeight: reviewerProfiles.voteWeight,
    })
    .from(reviewerProfiles)
    .where(
      and(
        eq(reviewerProfiles.qualified, true),
        sql`${reviewerProfiles.activeSlots} < ${reviewerProfiles.maxSlots}`,
        sql`${reviewerProfiles.userId} NOT IN (${sql.join(
          excludeIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );

  if (candidates.length === 0) {
    return { assigned: 0, reviewers: [] };
  }

  // Simple random selection (weight-based ES later)
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(reviewerCount, shuffled.length));

  // Create assignment records and increment active_slots
  const assignedIds: string[] = [];

  for (const candidate of selected) {
    await db.insert(reviewerAssignments).values({
      disputeId,
      reviewerId: candidate.userId,
      voteWeight: candidate.voteWeight,
      slotCost: 1,
    });

    await db
      .update(reviewerProfiles)
      .set({
        activeSlots: sql`${reviewerProfiles.activeSlots} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(reviewerProfiles.userId, candidate.userId));

    assignedIds.push(candidate.userId);
  }

  // Update dispute status to UNDER_REVIEW
  await db
    .update(disputeCases)
    .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
    .where(eq(disputeCases.id, disputeId));

  return { assigned: assignedIds.length, reviewers: assignedIds };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerReviewerRoutes(app: FastifyInstance, db: Database) {
  // ─── POST /disputes/:id/assign-reviewers (admin/system) ─────────
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/assign-reviewers",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;

      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      const tier = ((dispute.metadata as Record<string, unknown>)?.tier as number) ?? 1;
      if (tier < 2) {
        return reply.code(400).send({ error: "TIER_TOO_LOW", message: "Reviewer assignment requires T2 or T3" });
      }

      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      const amountCents = parseInt(String(order.amountMinor));
      if (amountCents <= 0) {
        return reply.code(400).send({ error: "INVALID_AMOUNT" });
      }

      const result = await assignReviewersToDispute(
        db,
        id,
        tier as DisputeTier,
        amountCents,
        order.buyerId,
        order.sellerId,
      );

      return reply.send(result);
    },
  );

  // ─── GET /reviewer/profile (authenticated reviewer) ──────────────
  app.get("/reviewer/profile", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

    const profile = await db.query.reviewerProfiles.findFirst({
      where: (fields, ops) => ops.eq(fields.userId, userId),
    });

    if (!profile) {
      return reply.send({
        user_id: userId,
        ds_score: 0,
        ds_tier: "BRONZE",
        vote_weight: 0.63,
        cases_reviewed: 0,
        zone_hit_rate: null,
        participation_rate: null,
        avg_response_hours: null,
        active_slots: 0,
        max_slots: 3,
        qualified: false,
        qualified_at: null,
        qualify_score: null,
        total_earnings_cents: 0,
      });
    }

    return reply.send({
      user_id: profile.userId,
      ds_score: profile.dsScore,
      ds_tier: profile.dsTier,
      vote_weight: parseFloat(profile.voteWeight),
      cases_reviewed: profile.casesReviewed,
      zone_hit_rate: profile.zoneHitRate ? parseFloat(profile.zoneHitRate) : null,
      participation_rate: profile.participationRate ? parseFloat(profile.participationRate) : null,
      avg_response_hours: profile.avgResponseHours ? parseFloat(profile.avgResponseHours) : null,
      active_slots: profile.activeSlots,
      max_slots: profile.maxSlots,
      qualified: profile.qualified,
      qualified_at: profile.qualifiedAt?.toISOString() ?? null,
      qualify_score: profile.qualifyScore,
      total_earnings_cents: profile.totalEarningsCents,
    });
  });

  // ─── GET /reviewer/assignments (authenticated reviewer) ──────────
  app.get("/reviewer/assignments", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = assignmentListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const { status } = parsed.data;

    // Resolved statuses for the "decided" filter
    const resolvedStatuses = [
      "RESOLVED_BUYER_FAVOR",
      "RESOLVED_SELLER_FAVOR",
      "PARTIAL_REFUND",
      "CLOSED",
    ];

    let statusFilter = sql``;
    if (status === "active") {
      statusFilter = sql`AND ra.vote_value IS NULL AND dc.status NOT IN (${sql.join(
        resolvedStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})`;
    } else if (status === "voted") {
      statusFilter = sql`AND ra.vote_value IS NOT NULL AND dc.status NOT IN (${sql.join(
        resolvedStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})`;
    } else if (status === "decided") {
      statusFilter = sql`AND dc.status IN (${sql.join(
        resolvedStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})`;
    }

    interface AssignmentRow {
      assignment_id: string;
      dispute_id: string;
      vote_value: number | null;
      vote_weight: string | null;
      assigned_at: string;
      voted_at: string | null;
      reasoning: string | null;
      dispute_status: string;
      dispute_reason: string;
      dispute_opened_at: string;
      order_id: string;
      amount_minor: string | null;
      order_snapshot: Record<string, unknown> | null;
    }

    const rawResult = await db.execute(sql`
      SELECT
        ra.id AS assignment_id,
        ra.dispute_id,
        ra.vote_value,
        ra.vote_weight,
        ra.assigned_at::text AS assigned_at,
        ra.voted_at::text AS voted_at,
        ra.reasoning,
        dc.status AS dispute_status,
        dc.reason_code AS dispute_reason,
        dc.opened_at::text AS dispute_opened_at,
        dc.order_id,
        co.amount_minor,
        co.order_snapshot
      FROM reviewer_assignments ra
      JOIN dispute_cases dc ON dc.id = ra.dispute_id
      JOIN commerce_orders co ON co.id = dc.order_id
      WHERE ra.reviewer_id = ${userId}
      ${statusFilter}
      ORDER BY ra.assigned_at DESC
    `);

    const rows = (rawResult as unknown as { rows?: AssignmentRow[] }).rows ?? [];

    const assignments = rows.map((row) => ({
      assignment_id: row.assignment_id,
      dispute_id: row.dispute_id,
      vote_value: row.vote_value,
      vote_weight: row.vote_weight ? parseFloat(row.vote_weight) : null,
      assigned_at: row.assigned_at,
      voted_at: row.voted_at,
      reasoning: row.reasoning,
      dispute_status: row.dispute_status,
      dispute_reason: row.dispute_reason,
      dispute_opened_at: row.dispute_opened_at,
      order_id: row.order_id,
      amount_minor: row.amount_minor ? parseInt(row.amount_minor) : null,
      item_title: row.order_snapshot
        ? ((row.order_snapshot as Record<string, unknown>).terms as Record<string, unknown>)?.item_name ?? null
        : null,
    }));

    return reply.send({ assignments });
  });

  // ─── GET /reviewer/assignments/:disputeId (assigned reviewer) ────
  app.get<{ Params: { disputeId: string } }>(
    "/reviewer/assignments/:disputeId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { disputeId } = request.params;

      // Verify assignment exists for this reviewer
      const assignmentRows = await db
        .select()
        .from(reviewerAssignments)
        .where(
          and(
            eq(reviewerAssignments.disputeId, disputeId),
            eq(reviewerAssignments.reviewerId, userId),
          ),
        );

      if (assignmentRows.length === 0) {
        return reply.code(403).send({ error: "NOT_ASSIGNED", message: "You are not assigned to this dispute" });
      }

      const assignment = assignmentRows[0];

      // Get dispute details
      const dispute = await getDisputeById(db, disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      // Get order info
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);

      // Get evidence from BOTH sides (exclude private advocate conversations)
      const evidenceRows = await db
        .select()
        .from(disputeEvidenceTable)
        .where(eq(disputeEvidenceTable.disputeId, disputeId));

      const evidence = evidenceRows.map((e) => ({
        id: e.id,
        submitted_by: e.submittedBy,
        type: e.type,
        uri: e.uri,
        text: e.text,
        created_at: e.createdAt.toISOString(),
      }));

      // Compute voting deadline from dispute metadata
      const tier = ((dispute.metadata as Record<string, unknown>)?.tier as number) ?? 2;
      const amountCents = order?.amountMinor ? parseInt(String(order.amountMinor)) : 0;
      let votingDeadline: string | null = null;
      if (amountCents > 0) {
        const cost = computeDisputeCost(amountCents, tier as DisputeTier);
        const openedAt = new Date(dispute.opened_at);
        votingDeadline = new Date(
          openedAt.getTime() + cost.escalation_period_hours * 60 * 60 * 1000,
        ).toISOString();
      }

      // Get previous tier decision if T2 escalation from T1
      const prevTierDecision = (dispute.metadata as Record<string, unknown>)?.previous_tier_decision ?? null;

      const orderSnapshot = order?.orderSnapshot as Record<string, unknown> | null;
      const terms = orderSnapshot?.terms as Record<string, unknown> | undefined;

      return reply.send({
        dispute: {
          id: dispute.id,
          reason_code: dispute.reason_code,
          status: dispute.status,
          opened_at: dispute.opened_at,
          tier,
        },
        order: {
          id: order?.id ?? null,
          item_title: terms?.item_name ?? null,
          amount_minor: order?.amountMinor ? parseInt(String(order.amountMinor)) : null,
        },
        evidence,
        previous_tier_decision: prevTierDecision,
        my_vote: assignment.voteValue,
        my_reasoning: assignment.reasoning,
        voted_at: assignment.votedAt?.toISOString() ?? null,
        voting_deadline: votingDeadline,
      });
    },
  );

  // ─── POST /reviewer/assignments/:disputeId/vote ──────────────────
  app.post<{ Params: { disputeId: string } }>(
    "/reviewer/assignments/:disputeId/vote",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { disputeId } = request.params;

      const parsed = voteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_VOTE", issues: parsed.error.issues });
      }

      const { vote, reasoning } = parsed.data;

      // Verify assignment
      const assignmentRows = await db
        .select()
        .from(reviewerAssignments)
        .where(
          and(
            eq(reviewerAssignments.disputeId, disputeId),
            eq(reviewerAssignments.reviewerId, userId),
          ),
        );

      if (assignmentRows.length === 0) {
        return reply.code(403).send({ error: "NOT_ASSIGNED", message: "You are not assigned to this dispute" });
      }

      const assignment = assignmentRows[0];

      // No double voting
      if (assignment.voteValue !== null) {
        return reply.code(400).send({ error: "ALREADY_VOTED", message: "You have already voted on this dispute" });
      }

      // Verify dispute is still in voting phase
      const dispute = await getDisputeById(db, disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (dispute.status !== "UNDER_REVIEW") {
        return reply.code(400).send({
          error: "VOTING_CLOSED",
          message: `Dispute status is ${dispute.status}, voting requires UNDER_REVIEW`,
        });
      }

      // Save vote
      await db
        .update(reviewerAssignments)
        .set({
          voteValue: vote,
          votedAt: new Date(),
          reasoning: reasoning ?? null,
        })
        .where(eq(reviewerAssignments.id, assignment.id));

      // Check if ALL reviewers have voted
      const allAssignments = await db
        .select({
          id: reviewerAssignments.id,
          voteValue: reviewerAssignments.voteValue,
        })
        .from(reviewerAssignments)
        .where(eq(reviewerAssignments.disputeId, disputeId));

      const allVoted = allAssignments.every(
        (a) => a.id === assignment.id ? true : a.voteValue !== null,
      );

      // Auto-tally if all voted
      if (allVoted) {
        try {
          await tallyDisputeVotes(db, disputeId);
        } catch (err) {
          console.error("[reviewer] Auto-tally failed:", err instanceof Error ? err.message : String(err));
        }
      }

      return reply.send({
        assignment: {
          id: assignment.id,
          dispute_id: disputeId,
          vote_value: vote,
          voted_at: new Date().toISOString(),
          reasoning: reasoning ?? null,
        },
        all_voted: allVoted,
      });
    },
  );

  // ─── POST /disputes/:id/tally (admin/system) ────────────────────
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/tally",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await tallyDisputeVotes(db, id);
        return reply.send(result);
      } catch (err) {
        return reply.code(400).send({
          error: "TALLY_FAILED",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // ─── POST /reviewer/qualify (authenticated user) ─────────────────
  app.post("/reviewer/qualify", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

    const parsed = qualifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUALIFY_REQUEST", issues: parsed.error.issues });
    }

    const { votes } = parsed.data;

    // Ensure all 10 case indices are present
    const seenIndices = new Set(votes.map((v) => v.case_index));
    if (seenIndices.size !== 10) {
      return reply.code(400).send({ error: "INCOMPLETE_VOTES", message: "Must provide votes for all 10 test cases" });
    }

    // Compare against correct answers
    const caseResults: Array<{
      case_index: number;
      your_vote: number;
      correct_vote: number;
      difference: number;
      match: boolean;
    }> = [];

    let matches = 0;
    for (const v of votes) {
      const correctCase = QUALIFICATION_CASES.find((c) => c.case_index === v.case_index);
      if (!correctCase) continue;

      const diff = Math.abs(v.vote - correctCase.correct_vote);
      const isMatch = diff <= QUALIFY_MATCH_TOLERANCE;
      if (isMatch) matches++;

      caseResults.push({
        case_index: v.case_index,
        your_vote: v.vote,
        correct_vote: correctCase.correct_vote,
        difference: diff,
        match: isMatch,
      });
    }

    const matchRate = matches / 10;
    let qualifyResult: "pass" | "conditional" | "fail";
    if (matchRate >= QUALIFY_PASS_RATE) {
      qualifyResult = "pass";
    } else if (matchRate >= QUALIFY_CONDITIONAL_RATE) {
      qualifyResult = "conditional";
    } else {
      qualifyResult = "fail";
    }

    // Create or update reviewer_profile
    const existingProfile = await db.query.reviewerProfiles.findFirst({
      where: (fields, ops) => ops.eq(fields.userId, userId),
    });

    if (existingProfile) {
      await db
        .update(reviewerProfiles)
        .set({
          qualified: qualifyResult === "pass",
          qualifiedAt: qualifyResult === "pass" ? new Date() : existingProfile.qualifiedAt,
          qualifyScore: Math.round(matchRate * 100),
          updatedAt: new Date(),
        })
        .where(eq(reviewerProfiles.userId, userId));
    } else {
      await db.insert(reviewerProfiles).values({
        userId,
        dsScore: 0,
        dsTier: "BRONZE",
        voteWeight: "0.63",
        qualified: qualifyResult === "pass",
        qualifiedAt: qualifyResult === "pass" ? new Date() : undefined,
        qualifyScore: Math.round(matchRate * 100),
      });
    }

    return reply.send({
      match_rate: matchRate,
      matches,
      total: 10,
      result: qualifyResult,
      case_results: caseResults,
    });
  });
}

// ---------------------------------------------------------------------------
// Tally function (used by auto-tally and admin endpoint)
// ---------------------------------------------------------------------------

async function tallyDisputeVotes(
  db: Database,
  disputeId: string,
): Promise<{
  outcome: string;
  weighted_median: number;
  strength: string;
  rewards: Array<{ reviewer_id: string; reward_cents: number; in_majority: boolean }>;
}> {
  // Get dispute
  const dispute = await getDisputeById(db, disputeId);
  if (!dispute) {
    throw new Error("DISPUTE_NOT_FOUND");
  }

  // Fetch all assignments
  const assignments = await db
    .select()
    .from(reviewerAssignments)
    .where(eq(reviewerAssignments.disputeId, disputeId));

  // Filter to voted ones
  const votedAssignments = assignments.filter((a) => a.voteValue !== null);
  if (votedAssignments.length === 0) {
    throw new Error("NO_VOTES_CAST");
  }

  // Build ReviewerVote array
  const votes: ReviewerVote[] = votedAssignments.map((a) => ({
    reviewer_id: a.reviewerId,
    vote: a.voteValue!,
    weight: a.voteWeight ? parseFloat(a.voteWeight) : 0.63,
  }));

  // Aggregate votes using dispute-core
  const aggregation = aggregateVotes(votes, disputeId);

  // Determine outcome based on weighted median
  const order = await getCommerceOrderByOrderId(db, dispute.order_id);
  const amountCents = order?.amountMinor ? parseInt(String(order.amountMinor)) : 0;
  const tier = ((dispute.metadata as Record<string, unknown>)?.tier as number) ?? 2;
  const cost = computeDisputeCost(amountCents, tier as DisputeTier);

  let outcome: "buyer_favor" | "seller_favor" | "partial_refund";
  let refundAmountMinor: number | undefined;

  if (aggregation.weighted_median >= 50) {
    // Buyer favor or partial
    const buyerPct = aggregation.weighted_median / 100;
    if (buyerPct >= 0.90) {
      outcome = "buyer_favor";
      refundAmountMinor = amountCents;
    } else {
      outcome = "partial_refund";
      refundAmountMinor = Math.round(amountCents * buyerPct);
    }
  } else {
    outcome = "seller_favor";
    refundAmountMinor = 0;
  }

  // Compute majority: voters on the same side as the median result
  const medianSide = aggregation.weighted_median >= 50 ? "buyer" : "seller";
  const majorityIds = new Set(
    votes
      .filter((v) => (medianSide === "buyer" ? v.vote >= 50 : v.vote < 50))
      .map((v) => v.reviewer_id),
  );

  // Reward: 70% of dispute cost split among majority voters
  const totalRewardCents = Math.round(cost.cost_cents * REVIEWER_SHARE);
  const majorityCount = majorityIds.size;
  const perReviewerReward = majorityCount > 0 ? Math.floor(totalRewardCents / majorityCount) : 0;

  const rewards: Array<{ reviewer_id: string; reward_cents: number; in_majority: boolean }> = [];

  for (const a of votedAssignments) {
    const inMajority = majorityIds.has(a.reviewerId);
    const reward = inMajority ? perReviewerReward : 0;
    rewards.push({
      reviewer_id: a.reviewerId,
      reward_cents: reward,
      in_majority: inMajority,
    });
  }

  const unvotedAssignments = assignments.filter((a) => a.voteValue === null);

  // Resolve dispute using the same money-movement finalizer as admin resolution.
  const resolveStatus =
    outcome === "buyer_favor"
      ? "RESOLVED_BUYER_FAVOR"
      : outcome === "seller_favor"
        ? "RESOLVED_SELLER_FAVOR"
        : "PARTIAL_REFUND";

  const resolution: DisputeResolution = {
    outcome,
    summary: `DS Panel vote: weighted median ${aggregation.weighted_median}, strength ${aggregation.strength}, method ${aggregation.method}`,
    refund_amount_minor: refundAmountMinor,
    resolved_at: new Date().toISOString(),
  };

  await finalizeDisputeResolution(db, dispute, resolution, {
    ...dispute,
    status: resolveStatus as typeof dispute.status,
    resolution,
    metadata: {
      ...(dispute.metadata as Record<string, unknown> ?? {}),
      tally_result: {
        weighted_median: aggregation.weighted_median,
        strength: aggregation.strength,
        method: aggregation.method,
        outcome,
        voter_count: votedAssignments.length,
        majority_count: majorityCount,
        total_reward_cents: totalRewardCents,
      },
    },
  });

  // Reviewer accounting is applied only after resolution side effects succeed.
  for (const a of votedAssignments) {
    const reward = rewards.find((r) => r.reviewer_id === a.reviewerId)?.reward_cents ?? 0;
    if (reward > 0) {
      await db
        .update(reviewerProfiles)
        .set({
          totalEarningsCents: sql`${reviewerProfiles.totalEarningsCents} + ${reward}`,
          activeSlots: sql`GREATEST(${reviewerProfiles.activeSlots} - 1, 0)`,
          casesReviewed: sql`${reviewerProfiles.casesReviewed} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(reviewerProfiles.userId, a.reviewerId));
    } else {
      await db
        .update(reviewerProfiles)
        .set({
          activeSlots: sql`GREATEST(${reviewerProfiles.activeSlots} - 1, 0)`,
          casesReviewed: sql`${reviewerProfiles.casesReviewed} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(reviewerProfiles.userId, a.reviewerId));
    }
  }

  // Also decrement active_slots for unvoted assignments after finalization.
  for (const a of unvotedAssignments) {
    await db
      .update(reviewerProfiles)
      .set({
        activeSlots: sql`GREATEST(${reviewerProfiles.activeSlots} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(reviewerProfiles.userId, a.reviewerId));
  }

  return {
    outcome,
    weighted_median: aggregation.weighted_median,
    strength: aggregation.strength,
    rewards,
  };
}
