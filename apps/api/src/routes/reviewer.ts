import type { Database } from "@haggle/db";
import {
  and,
  disputeCases,
  disputeEvidence as disputeEvidenceTable,
  eq,
  isNull,
  reviewerAssignments,
  reviewerProfiles,
  sql,
} from "@haggle/db";
import type { DisputeTier } from "@haggle/dispute-core";
import { computeDisputeCost, getReviewerCount } from "@haggle/dispute-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  DISPUTE_VIEW_URL_TTL_SECONDS,
  validateDisputeStoragePath,
} from "../lib/dispute-storage-paths.js";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import { evaluateDisputePanel } from "../services/dispute-panel-evaluate.service.js";
import {
  getDisputeById,
  getDisputeEvidenceUploadByEvidenceId,
} from "../services/dispute-record.service.js";
import {
  REVIEW_CLOSED_STATUSES,
  reviewTier,
  withReviewRoundLock,
} from "../services/dispute-review-round.service.js";
import { createDisputeViewUrl } from "../services/dispute-storage.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";

// ---------------------------------------------------------------------------
// Qualification test cases (hardcoded precedent cases for MVP)
// ---------------------------------------------------------------------------

const QUALIFICATION_CASES: Array<{
  case_index: number;
  correct_vote: number;
  description: string;
}> = [
  {
    case_index: 0,
    correct_vote: 85,
    description: "Clear buyer favor: item not delivered, seller unresponsive",
  },
  {
    case_index: 1,
    correct_vote: 20,
    description: "Seller favor: buyer remorse, item as described",
  },
  {
    case_index: 2,
    correct_vote: 55,
    description: "Slight buyer lean: minor damage not in listing",
  },
  {
    case_index: 3,
    correct_vote: 90,
    description: "Strong buyer favor: counterfeit item with proof",
  },
  {
    case_index: 4,
    correct_vote: 10,
    description: "Strong seller favor: buyer damaged item after receipt",
  },
  {
    case_index: 5,
    correct_vote: 50,
    description: "True toss-up: conflicting evidence, no tracking",
  },
  {
    case_index: 6,
    correct_vote: 70,
    description: "Moderate buyer favor: shipping damage, unclear liability",
  },
  {
    case_index: 7,
    correct_vote: 30,
    description: "Moderate seller favor: item works but not as expected",
  },
  {
    case_index: 8,
    correct_vote: 75,
    description: "Buyer favor: wrong item shipped, seller acknowledges",
  },
  {
    case_index: 9,
    correct_vote: 40,
    description: "Slight seller lean: late delivery but within tolerance",
  },
];

const QUALIFY_MATCH_TOLERANCE = 15;
const QUALIFY_PASS_RATE = 0.7;
const QUALIFY_CONDITIONAL_RATE = 0.6;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const voteSchema = z.object({
  expected_tier: z.union([z.literal(2), z.literal(3)]),
  vote: z.number().int().min(0).max(100),
  reasoning: z.string().max(2000).optional(),
});

const qualifySchema = z.object({
  votes: z
    .array(
      z.object({
        case_index: z.number().int().min(0).max(9),
        expected_tier: z.union([z.literal(2), z.literal(3)]),
        vote: z.number().int().min(0).max(100),
      }),
    )
    .length(10),
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

  if (![2, 3].includes(disputeTier) || !Number.isSafeInteger(amountCents) || amountCents <= 0)
    throw new Error("INVALID_PANEL_REQUEST");

  return withReviewRoundLock(db, disputeId, async (tx) => {
    const dispute = await getDisputeById(tx, disputeId);
    if (
      !dispute ||
      reviewTier(dispute) !== disputeTier ||
      REVIEW_CLOSED_STATUSES.includes(dispute.status)
    ) {
      throw new Error("REVIEW_TIER_CHANGED");
    }
    if (dispute.metadata?.review_phase !== "ACTIVE") {
      throw new Error("REVIEW_BONDS_NOT_CONFIRMED");
    }
    const existing = await tx
      .select()
      .from(reviewerAssignments)
      .where(eq(reviewerAssignments.disputeId, disputeId));
    const current = existing.filter((a) => a.tier === disputeTier);
    const reviewerCount = getReviewerCount(amountCents, disputeTier as 2 | 3);
    const needed = Math.max(0, reviewerCount - current.length);
    const excludeIds = [buyerId, sellerId, ...existing.map((a) => a.reviewerId)];
    // Lock candidates in a stable order across cases; no slot can be oversubscribed.
    const candidates =
      needed === 0
        ? []
        : await tx
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
            )
            .orderBy(reviewerProfiles.userId)
            .for("update", { skipLocked: true });
    const selected = [...candidates].sort(() => Math.random() - 0.5).slice(0, needed);
    for (const candidate of selected) {
      await tx.insert(reviewerAssignments).values({
        disputeId,
        reviewerId: candidate.userId,
        tier: disputeTier,
        voteWeight: candidate.voteWeight,
        slotCost: 1,
      });
      await tx
        .update(reviewerProfiles)
        .set({
          activeSlots: sql`${reviewerProfiles.activeSlots} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(reviewerProfiles.userId, candidate.userId));
    }
    await tx
      .update(disputeCases)
      .set({ status: "UNDER_REVIEW", updatedAt: new Date() })
      .where(eq(disputeCases.id, disputeId));
    const reviewers = [...current.map((a) => a.reviewerId), ...selected.map((c) => c.userId)];
    return { assigned: reviewers.length, reviewers };
  });
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
      if (tier !== 2 && tier !== 3) {
        return reply
          .code(400)
          .send({ error: "TIER_TOO_LOW", message: "Reviewer assignment requires T2 or T3" });
      }

      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      const amountCents = parseInt(String(order.amountMinor), 10);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
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
      statusFilter = sql`AND ra.tier = COALESCE((dc.metadata->>'tier')::int, 1) AND ra.vote_value IS NULL AND dc.status NOT IN (${sql.join(
        resolvedStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})`;
    } else if (status === "voted") {
      statusFilter = sql`AND ra.tier = COALESCE((dc.metadata->>'tier')::int, 1) AND ra.vote_value IS NOT NULL AND dc.status NOT IN (${sql.join(
        resolvedStatuses.map((s) => sql`${s}`),
        sql`, `,
      )})`;
    } else if (status === "decided") {
      statusFilter = sql`AND (ra.tier <> COALESCE((dc.metadata->>'tier')::int, 1) OR dc.status IN (${sql.join(
        resolvedStatuses.map((s) => sql`${s}`),
        sql`, `,
      )}))`;
    }

    interface AssignmentRow {
      assignment_id: string;
      tier: number;
      current_tier: number;
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
        ra.tier,
        COALESCE((dc.metadata->>'tier')::int, 1) AS current_tier,
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

    const rows = Array.isArray(rawResult)
      ? (rawResult as unknown as AssignmentRow[])
      : ((rawResult as unknown as { rows?: AssignmentRow[] }).rows ?? []);

    const assignments = rows.map((row) => ({
      assignment_id: row.assignment_id,
      tier: row.tier,
      status:
        resolvedStatuses.includes(row.dispute_status) || row.tier !== row.current_tier
          ? "decided"
          : row.vote_value === null
            ? "active"
            : "voted",
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
      amount_minor: row.amount_minor ? parseInt(row.amount_minor, 10) : null,
      item_title: row.order_snapshot
        ? (((row.order_snapshot as Record<string, unknown>).terms as Record<string, unknown>)
            ?.item_name ?? null)
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
        return reply
          .code(403)
          .send({ error: "NOT_ASSIGNED", message: "You are not assigned to this dispute" });
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
      const tier = assignment.tier;
      const amountCents = order?.amountMinor ? parseInt(String(order.amountMinor), 10) : 0;
      let votingDeadline: string | null = null;
      if (amountCents > 0) {
        const cost = computeDisputeCost(amountCents, tier as DisputeTier);
        const openedAt = assignment.assignedAt;
        votingDeadline = new Date(
          openedAt.getTime() + cost.escalation_period_hours * 60 * 60 * 1000,
        ).toISOString();
      }

      // Get previous tier decision if T2 escalation from T1
      const prevTierDecision =
        (dispute.metadata as Record<string, unknown>)?.previous_tier_decision ?? null;

      const orderSnapshot = order?.orderSnapshot as Record<string, unknown> | null;
      const terms = orderSnapshot?.terms as Record<string, unknown> | undefined;

      const evaluation = await evaluateDisputePanel(db, disputeId, { persist: false });
      return reply.send({
        assignment_id: assignment.id,
        assignment_tier: assignment.tier,
        current_tier: reviewTier(dispute),
        voting_open:
          assignment.tier === reviewTier(dispute) &&
          dispute.status === "UNDER_REVIEW" &&
          dispute.metadata?.review_phase === "ACTIVE",
        panel: evaluation.evaluation,
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
          amount_minor: order?.amountMinor ? parseInt(String(order.amountMinor), 10) : null,
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

  app.get<{ Params: { disputeId: string; evidenceId: string } }>(
    "/reviewer/assignments/:disputeId/evidence/:evidenceId/view",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { disputeId, evidenceId } = request.params;
      const assignments = await db
        .select()
        .from(reviewerAssignments)
        .where(
          and(
            eq(reviewerAssignments.disputeId, disputeId),
            eq(reviewerAssignments.reviewerId, request.user!.id),
          ),
        );
      if (!assignments.length) return reply.code(403).send({ error: "NOT_ASSIGNED" });
      const rows = await db
        .select()
        .from(disputeEvidenceTable)
        .where(
          and(
            eq(disputeEvidenceTable.disputeId, disputeId),
            eq(disputeEvidenceTable.id, evidenceId),
          ),
        );
      if (!rows[0]?.uri) return reply.code(404).send({ error: "EVIDENCE_NOT_FOUND" });
      const upload = await getDisputeEvidenceUploadByEvidenceId(db, disputeId, evidenceId);
      if (upload && upload.retentionStatus !== "ACTIVE")
        return reply.code(410).send({ error: "EVIDENCE_FILE_UNAVAILABLE" });
      let objectPath: string;
      try {
        objectPath = validateDisputeStoragePath(disputeId, rows[0].uri);
      } catch {
        return reply.code(400).send({ error: "INVALID_STORAGE_PATH" });
      }
      reply.header("Cache-Control", "no-store");
      return reply.send({
        view_url: await createDisputeViewUrl(objectPath),
        expires_in: DISPUTE_VIEW_URL_TTL_SECONDS,
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

      const result = await withReviewRoundLock(db, disputeId, async (db) => {
        const respond = (status: number, body: object) => ({ status, body });
        const dispute = await getDisputeById(db, disputeId);
        if (!dispute) return respond(404, { error: "DISPUTE_NOT_FOUND" });
        const tier = reviewTier(dispute);
        if (parsed.data.expected_tier !== tier)
          return respond(409, { error: "REVIEW_TIER_CHANGED" });
        if (dispute.metadata?.review_phase !== "ACTIVE")
          return respond(409, { error: "REVIEW_BONDS_NOT_CONFIRMED" });
        // Verify assignment
        const assignmentRows = await db
          .select()
          .from(reviewerAssignments)
          .where(
            and(
              eq(reviewerAssignments.disputeId, disputeId),
              eq(reviewerAssignments.reviewerId, userId),
              eq(reviewerAssignments.tier, tier),
            ),
          );

        if (assignmentRows.length === 0) {
          return respond(403, {
            error: "NOT_ASSIGNED",
            message: "You are not assigned to this dispute",
          });
        }

        const assignment = assignmentRows[0];

        // No double voting
        if (assignment.voteValue !== null) {
          return respond(400, {
            error: "ALREADY_VOTED",
            message: "You have already voted on this dispute",
          });
        }

        // Verify dispute is still in voting phase
        if (dispute.status !== "UNDER_REVIEW") {
          return respond(400, {
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
          .where(
            and(eq(reviewerAssignments.id, assignment.id), isNull(reviewerAssignments.voteValue)),
          );
        await db
          .update(reviewerProfiles)
          .set({
            activeSlots: sql`GREATEST(0, ${reviewerProfiles.activeSlots} - ${assignment.slotCost})`,
            updatedAt: new Date(),
          })
          .where(eq(reviewerProfiles.userId, userId));

        // Check if ALL reviewers have voted
        const allAssignments = await db
          .select({
            id: reviewerAssignments.id,
            voteValue: reviewerAssignments.voteValue,
          })
          .from(reviewerAssignments)
          .where(
            and(eq(reviewerAssignments.disputeId, disputeId), eq(reviewerAssignments.tier, tier)),
          );

        const allVoted = allAssignments.every((a) =>
          a.id === assignment.id ? true : a.voteValue !== null,
        );

        // Auto-evaluate panel judgment if all voted (money stays on resolve/finalizer — E2)
        if (allVoted) {
          await evaluateDisputePanel(db, disputeId, { persist: true });
        }

        return respond(200, {
          assignment: {
            id: assignment.id,
            dispute_id: disputeId,
            vote_value: vote,
            voted_at: new Date().toISOString(),
            reasoning: reasoning ?? null,
          },
          all_voted: allVoted,
        });
      });
      return reply.code(result.status).send(result.body);
    },
  );

  // ─── POST /disputes/:id/tally (admin/system) — judgment only (E2) ─
  // Alias of panel evaluate: assignment+votes → ready/outcome computation.
  // Money movement remains on POST /disputes/:id/resolve → finalizeDisputeResolution.
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/tally",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await evaluateDisputePanel(db, id, { persist: true });
        const { evaluation } = result;
        if (!evaluation.ready) {
          return reply.send({
            dispute_id: result.dispute_id,
            dispute_status: result.dispute_status,
            ready: false,
            issues: evaluation.issues,
            expected_reviewer_count: evaluation.expected_reviewer_count,
            assigned_count: evaluation.assigned_count,
            voted_count: evaluation.voted_count,
            auto_applied: result.auto_applied,
          });
        }
        return reply.send({
          dispute_id: result.dispute_id,
          dispute_status: result.dispute_status,
          ready: true,
          outcome: evaluation.outcome,
          weighted_median: evaluation.aggregation.weighted_median,
          strength: evaluation.aggregation.strength,
          refund_amount_minor: evaluation.refund_amount_minor,
          rewards: evaluation.rewards,
          auto_applied: result.auto_applied,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message === "DISPUTE_NOT_FOUND") {
          return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
        }
        return reply.code(400).send({
          error: "TALLY_FAILED",
          message,
        });
      }
    },
  );

  app.get("/reviewer/qualification-cases", { preHandler: [requireAuth] }, async (_request, reply) =>
    reply.send({
      cases: QUALIFICATION_CASES.map(({ case_index, description }) => ({
        case_index,
        description,
      })),
    }),
  );

  // ─── POST /reviewer/qualify (authenticated user) ─────────────────
  app.post("/reviewer/qualify", { preHandler: [requireAuth] }, async (request, reply) => {
    const userId = request.user!.id;

    const parsed = qualifySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_QUALIFY_REQUEST", issues: parsed.error.issues });
    }

    const { votes } = parsed.data;

    // Ensure all 10 case indices are present
    const seenIndices = new Set(votes.map((v) => v.case_index));
    if (seenIndices.size !== 10) {
      return reply
        .code(400)
        .send({ error: "INCOMPLETE_VOTES", message: "Must provide votes for all 10 test cases" });
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
