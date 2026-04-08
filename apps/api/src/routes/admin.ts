/**
 * Admin routes (Step 58 Part A).
 *
 * All routes are gated behind `requireAdmin` (401 if no token, 403 if
 * non-admin). Surfaces the inbox aggregator, the tag-promotion job, and
 * per-category promotion rules CRUD. Every mutating endpoint writes an
 * `admin_action_log` row via writeAuditLog.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { requireAdmin } from "../middleware/require-auth.js";
import {
  getInboxDetail,
  getInboxSummary,
  listActiveDisputes,
  listFailedPayments,
  listPendingTags,
} from "../services/admin-inbox.service.js";
import { runPromotionJob } from "../services/tag-promotion.service.js";
import { writeAuditLog } from "../services/admin-action-log.service.js";
import {
  deletePromotionRule,
  getLastPromotionRun,
  getPromotionRule,
  listPromotionRules,
  upsertPromotionRule,
} from "../services/promotion-rule.service.js";
import {
  approveSuggestion,
  rejectSuggestion,
  mergeSuggestion,
} from "../services/tag-suggestion.service.js";
import {
  getDisputeById,
  updateDisputeRecord,
  createDisputeResolutionRecord,
} from "../services/dispute-record.service.js";
import {
  getPaymentIntentRowById,
  setPaymentIntentProviderContext,
} from "../services/payment-record.service.js";
import { DisputeService } from "@haggle/dispute-core";

// ─── Schemas ──────────────────────────────────────────────────────────

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const disputeListSchema = paginationSchema.extend({
  status: z.string().min(1).optional(),
});

const inboxTypeSchema = z.enum(["tag", "dispute", "payment"]);

const promotionRuleBodySchema = z.object({
  candidateMinUse: z.number().int().min(0),
  emergingMinUse: z.number().int().min(0),
  candidateMinAgeDays: z.number().int().min(0),
  emergingMinAgeDays: z.number().int().min(0),
  suggestionAutoPromoteCount: z.number().int().min(0),
  enabled: z.boolean(),
});

// ─── Helpers ──────────────────────────────────────────────────────────

// `requireAdmin` preHandler guarantees `request.user` is set before any
// route handler runs, so `user.id` is non-null here. `admin_action_log.actor_id`
// is a NOT NULL uuid column — a string fallback like "admin" would fail the
// insert at the DB level, so we intentionally do not provide one.
function getActorId(request: { user?: { id: string } }): string {
  const id = request.user?.id;
  if (!id) {
    // Defense-in-depth: should be unreachable behind `requireAdmin`.
    throw new Error("getActorId called without authenticated user");
  }
  return id;
}

// ─── Route registration ───────────────────────────────────────────────

export function registerAdminRoutes(app: FastifyInstance, db: Database) {
  // ─── Inbox ─────────────────────────────────────────────────

  app.get(
    "/admin/inbox/summary",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const summary = await getInboxSummary(db);
      return reply.send(summary);
    },
  );

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/admin/inbox/tags",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = paginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_QUERY", issues: parsed.error.issues });
      }
      const items = await listPendingTags(db, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.send({ items });
    },
  );

  app.get<{
    Querystring: { status?: string; limit?: string; offset?: string };
  }>(
    "/admin/inbox/disputes",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = disputeListSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_QUERY", issues: parsed.error.issues });
      }
      const items = await listActiveDisputes(db, {
        status: parsed.data.status,
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.send({ items });
    },
  );

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/admin/inbox/payments",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = paginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_QUERY", issues: parsed.error.issues });
      }
      const items = await listFailedPayments(db, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.send({ items });
    },
  );

  app.get<{ Params: { type: string; id: string } }>(
    "/admin/inbox/:type/:id",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const typeParse = inboxTypeSchema.safeParse(request.params.type);
      if (!typeParse.success) {
        return reply.code(400).send({ error: "INVALID_INBOX_TYPE" });
      }
      const detail = await getInboxDetail(
        db,
        typeParse.data,
        request.params.id,
      );
      if (!detail) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      return reply.send(detail);
    },
  );

  // ─── Jobs ──────────────────────────────────────────────────

  app.post(
    "/admin/jobs/tag-promote",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      // Audit logging is handled inside `runPromotionJob`, which inserts a
      // `promotion.run` row into admin_action_log with the full report as
      // payload. No route-level writeAuditLog call is needed here.
      const report = await runPromotionJob(db, getActorId(request));
      return reply.send({ report });
    },
  );

  app.get(
    "/admin/jobs/tag-promote/last",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const lastRun = await getLastPromotionRun(db);
      return reply.send({ lastRun });
    },
  );

  // ─── Promotion rules CRUD ─────────────────────────────────

  app.get(
    "/admin/promotion-rules",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const rules = await listPromotionRules(db);
      return reply.send({ rules });
    },
  );

  app.get<{ Params: { category: string } }>(
    "/admin/promotion-rules/:category",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const rule = await getPromotionRule(db, request.params.category);
      if (!rule) {
        return reply.code(404).send({ error: "RULE_NOT_FOUND" });
      }
      return reply.send({ rule });
    },
  );

  app.put<{ Params: { category: string } }>(
    "/admin/promotion-rules/:category",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = promotionRuleBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_RULE_BODY", issues: parsed.error.issues });
      }
      const { category } = request.params;
      const before = await getPromotionRule(db, category);
      const after = await upsertPromotionRule(db, category, parsed.data);

      await writeAuditLog(db, {
        actorId: getActorId(request),
        actionType: "rule.update",
        targetType: "tag_promotion_rule",
        targetId: category,
        payload: {
          before: before as Record<string, unknown> | null,
          after: after as Record<string, unknown> | null,
        },
      });

      return reply.send({ rule: after });
    },
  );

  app.delete<{ Params: { category: string } }>(
    "/admin/promotion-rules/:category",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { category } = request.params;
      if (category === "default") {
        return reply.code(400).send({ error: "CANNOT_DELETE_DEFAULT_RULE" });
      }
      const existing = await getPromotionRule(db, category);
      if (!existing) {
        return reply.code(404).send({ error: "RULE_NOT_FOUND" });
      }
      await deletePromotionRule(db, category);
      await writeAuditLog(db, {
        actorId: getActorId(request),
        actionType: "rule.delete",
        targetType: "tag_promotion_rule",
        targetId: category,
        payload: { before: existing as unknown as Record<string, unknown> },
      });
      return reply.send({ deleted: true });
    },
  );

  // ─── Mutation actions (Step 58 Part B) ────────────────────

  const tagApproveSchema = z.object({
    suggestionId: z.string().min(1),
    category: z.string().min(1).optional(),
    initialStatus: z.enum(["CANDIDATE", "EMERGING", "OFFICIAL"]).optional(),
  });

  app.post(
    "/admin/actions/tag-approve",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = tagApproveSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      const result = await approveSuggestion(db, parsed.data.suggestionId, {
        reviewedBy: actorId,
        category: parsed.data.category ?? "uncategorized",
        initialStatus: parsed.data.initialStatus,
      });
      if (!result.ok) {
        const code = /not found/i.test(result.error) ? 404 : 409;
        return reply
          .code(code)
          .send({ error: "TAG_APPROVE_FAILED", message: result.error });
      }
      await writeAuditLog(db, {
        actorId,
        actionType: "tag.approve",
        targetType: "tag_suggestion",
        targetId: parsed.data.suggestionId,
        payload: { result: result as unknown as Record<string, unknown> },
      });
      return reply.send({ result });
    },
  );

  const tagRejectSchema = z.object({
    suggestionId: z.string().min(1),
    reason: z.string().optional(),
  });

  app.post(
    "/admin/actions/tag-reject",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = tagRejectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      // Note: underlying `rejectSuggestion` does not accept a reason arg;
      // we record it in the audit-log payload instead.
      const result = await rejectSuggestion(
        db,
        parsed.data.suggestionId,
        actorId,
      );
      if (!result.ok) {
        const code = /not found/i.test(result.error) ? 404 : 409;
        return reply
          .code(code)
          .send({ error: "TAG_REJECT_FAILED", message: result.error });
      }
      await writeAuditLog(db, {
        actorId,
        actionType: "tag.reject",
        targetType: "tag_suggestion",
        targetId: parsed.data.suggestionId,
        payload: { reason: parsed.data.reason ?? null },
      });
      return reply.send({ result });
    },
  );

  const tagMergeSchema = z.object({
    suggestionId: z.string().min(1),
    targetTagId: z.string().min(1),
  });

  app.post(
    "/admin/actions/tag-merge",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = tagMergeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      const result = await mergeSuggestion(
        db,
        parsed.data.suggestionId,
        parsed.data.targetTagId,
        actorId,
      );
      if (!result.ok) {
        const code = /not found/i.test(result.error) ? 404 : 409;
        return reply
          .code(code)
          .send({ error: "TAG_MERGE_FAILED", message: result.error });
      }
      await writeAuditLog(db, {
        actorId,
        actionType: "tag.merge",
        targetType: "tag_suggestion",
        targetId: parsed.data.suggestionId,
        payload: {
          targetTagId: parsed.data.targetTagId,
          result: result as unknown as Record<string, unknown>,
        },
      });
      return reply.send({ result });
    },
  );

  const disputeEscalateSchema = z.object({
    disputeId: z.string().min(1),
    toTier: z.number().int().min(2).max(3),
    reason: z.string().optional(),
  });

  app.post(
    "/admin/actions/dispute-escalate",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = disputeEscalateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      const dispute = await getDisputeById(db, parsed.data.disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      // Guard: already resolved/closed cases cannot be escalated.
      if (
        dispute.status === "RESOLVED_BUYER_FAVOR" ||
        dispute.status === "RESOLVED_SELLER_FAVOR" ||
        dispute.status === "PARTIAL_REFUND" ||
        dispute.status === "CLOSED"
      ) {
        return reply
          .code(409)
          .send({ error: "DISPUTE_ALREADY_RESOLVED", status: dispute.status });
      }
      const currentTier =
        ((dispute.metadata as Record<string, unknown> | null)?.tier as number) ??
        1;
      if (parsed.data.toTier <= currentTier) {
        return reply.code(409).send({
          error: "DISPUTE_TIER_NOT_ADVANCING",
          current_tier: currentTier,
          requested_tier: parsed.data.toTier,
        });
      }
      await updateDisputeRecord(db, {
        ...dispute,
        metadata: {
          ...((dispute.metadata as Record<string, unknown> | null) ?? {}),
          tier: parsed.data.toTier,
          escalated_reason: parsed.data.reason ?? null,
          escalated_by_actor: actorId,
          escalated_at: new Date().toISOString(),
        },
      });
      await writeAuditLog(db, {
        actorId,
        actionType: "dispute.escalate",
        targetType: "dispute_case",
        targetId: parsed.data.disputeId,
        payload: {
          from_tier: currentTier,
          to_tier: parsed.data.toTier,
          reason: parsed.data.reason ?? null,
        },
      });
      return reply.send({
        disputeId: parsed.data.disputeId,
        previousTier: currentTier,
        newTier: parsed.data.toTier,
      });
    },
  );

  const disputeResolveSchema = z.object({
    disputeId: z.string().min(1),
    outcome: z.enum(["buyer_favor", "seller_favor", "partial_refund"]),
    summary: z.string().min(1).optional(),
    refundAmountMinor: z.number().int().min(0).optional(),
  });

  app.post(
    "/admin/actions/dispute-resolve",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = disputeResolveSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      const dispute = await getDisputeById(db, parsed.data.disputeId);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (
        dispute.status === "RESOLVED_BUYER_FAVOR" ||
        dispute.status === "RESOLVED_SELLER_FAVOR" ||
        dispute.status === "PARTIAL_REFUND" ||
        dispute.status === "CLOSED"
      ) {
        return reply
          .code(409)
          .send({ error: "DISPUTE_ALREADY_RESOLVED", status: dispute.status });
      }
      const disputeService = new DisputeService();
      let result;
      try {
        result = disputeService.resolve(dispute, {
          outcome: parsed.data.outcome,
          summary: parsed.data.summary ?? `Admin resolution by ${actorId}`,
          refund_amount_minor: parsed.data.refundAmountMinor,
        });
      } catch (error) {
        return reply.code(409).send({
          error: "DISPUTE_RESOLVE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await updateDisputeRecord(db, result.dispute);
      if (result.value) {
        await createDisputeResolutionRecord(
          db,
          dispute.id,
          result.value,
        );
      }
      await writeAuditLog(db, {
        actorId,
        actionType: "dispute.resolve",
        targetType: "dispute_case",
        targetId: parsed.data.disputeId,
        payload: {
          outcome: parsed.data.outcome,
          refund_amount_minor: parsed.data.refundAmountMinor ?? null,
        },
      });
      return reply.send({ dispute: result.dispute });
    },
  );

  const paymentMarkReviewSchema = z.object({
    paymentIntentId: z.string().min(1),
    note: z.string().min(1),
  });

  app.post(
    "/admin/actions/payment-mark-review",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = paymentMarkReviewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      const intent = await getPaymentIntentRowById(
        db,
        parsed.data.paymentIntentId,
      );
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (intent.status !== "FAILED") {
        return reply.code(409).send({
          error: "PAYMENT_INTENT_NOT_FAILED",
          status: intent.status,
        });
      }
      const existingContext =
        (intent.providerContext as Record<string, unknown> | null) ?? {};
      const mergedContext: Record<string, unknown> = {
        ...existingContext,
        manual_review: true,
        note: parsed.data.note,
        by: actorId,
        at: new Date().toISOString(),
      };
      await setPaymentIntentProviderContext(
        db,
        parsed.data.paymentIntentId,
        mergedContext,
      );
      await writeAuditLog(db, {
        actorId,
        actionType: "payment.mark_review",
        targetType: "payment_intent",
        targetId: parsed.data.paymentIntentId,
        payload: {
          note: parsed.data.note,
        },
      });
      return reply.send({ paymentIntentId: parsed.data.paymentIntentId });
    },
  );
}
