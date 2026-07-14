// biome-ignore-all lint/suspicious/noImplicitAnyLet: Guarded assignments retain domain result types.
/**
 * Admin routes (Step 58 Part A).
 *
 * All routes are gated behind `requireAdmin` (401 if no token, 403 if
 * non-admin). Surfaces the inbox aggregator, the tag-promotion job, and
 * per-category promotion rules CRUD. Every mutating endpoint writes an
 * `admin_action_log` row via writeAuditLog.
 */

import type { Database } from "@haggle/db";
import { DisputeService } from "@haggle/dispute-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin } from "../middleware/require-auth.js";
import { writeAuditLog } from "../services/admin-action-log.service.js";
import {
  getInboxDetail,
  getInboxSummary,
  listActiveDisputes,
  listFailedPayments,
  listPendingTags,
} from "../services/admin-inbox.service.js";
import {
  listDeadLetterDisputeModuleWebhookOutboxRecords,
  resetDisputeModuleWebhookOutboxRecordForReplay,
} from "../services/dispute-module-webhook.service.js";
import { getDisputeById, updateDisputeRecord } from "../services/dispute-record.service.js";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";
import {
  getCommerceOrderByOrderId,
  getPaymentIntentRowById,
  setPaymentIntentProviderContext,
} from "../services/payment-record.service.js";
import { buildProductionReconciliationReport } from "../services/production-reconciliation.service.js";
import {
  deletePromotionRule,
  getLastPromotionRun,
  getPromotionRule,
  listPromotionRules,
  upsertPromotionRule,
} from "../services/promotion-rule.service.js";
import { runPromotionJob } from "../services/tag-promotion.service.js";
import {
  approveSuggestion,
  mergeSuggestion,
  rejectSuggestion,
} from "../services/tag-suggestion.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";

// ─── Schemas ──────────────────────────────────────────────────────────

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const disputeListSchema = paginationSchema.extend({
  status: z.string().min(1).optional(),
});

const inboxTypeSchema = z.enum(["tag", "dispute", "payment"]);

const webhookReplayBodySchema = z.object({
  eventId: z.string().min(1).max(128),
  reason: z.string().min(1).max(500),
});

const promotionRuleBodySchema = z.object({
  candidateMinUse: z.number().int().min(0),
  emergingMinUse: z.number().int().min(0),
  candidateMinAgeDays: z.number().int().min(0),
  emergingMinAgeDays: z.number().int().min(0),
  suggestionAutoPromoteCount: z.number().int().min(0),
  enabled: z.boolean(),
});

const paymentStateSchema = z.enum([
  "pending",
  "authorized",
  "captured",
  "canceled",
  "refunded",
  "partially_refunded",
  "failed",
  "disputed",
  "expired",
]);

const shipmentStateSchema = z.enum([
  "label_pending",
  "label_created",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_exception",
  "return_in_transit",
  "returned",
]);

const disputeProductionStatusSchema = z.enum([
  "open",
  "under_review",
  "waiting_for_buyer",
  "waiting_for_seller",
  "resolved_buyer_favor",
  "resolved_seller_favor",
  "partial_refund",
  "closed",
]);

const productionReconciliationBodySchema = z.object({
  generatedAt: z.string().datetime().optional(),
  payments: z
    .object({
      local: z
        .array(
          z.object({
            payment_intent_id: z.string().min(1),
            order_id: z.string().min(1).optional(),
            state: paymentStateSchema,
            amount_minor: z.number().int().min(0),
            refunded_amount_minor: z.number().int().min(0).optional(),
            provider_reference: z.string().min(1).optional(),
          }),
        )
        .max(500)
        .default([]),
      provider: z
        .array(
          z.object({
            provider_reference: z.string().min(1),
            state: paymentStateSchema,
            amount_minor: z.number().int().min(0),
            refunded_amount_minor: z.number().int().min(0).optional(),
            local_payment_intent_id: z.string().min(1).optional(),
          }),
        )
        .max(500)
        .default([]),
    })
    .optional(),
  shipments: z
    .object({
      local: z
        .array(
          z.object({
            shipment_id: z.string().min(1),
            order_id: z.string().min(1),
            state: shipmentStateSchema,
            carrier: z.string().min(1).optional(),
            tracking_number: z.string().min(1).optional(),
            provider_shipment_id: z.string().min(1).optional(),
            provider_tracker_id: z.string().min(1).optional(),
            label_url: z.string().min(1).optional(),
            qr_code_url: z.string().min(1).optional(),
            order_status: z.string().min(1).optional(),
          }),
        )
        .max(500)
        .default([]),
      provider: z
        .array(
          z.object({
            provider_shipment_id: z.string().min(1).optional(),
            provider_tracker_id: z.string().min(1).optional(),
            tracking_number: z.string().min(1).optional(),
            state: shipmentStateSchema,
            carrier: z.string().min(1).optional(),
            label_purchased: z.boolean().optional(),
            label_url: z.string().min(1).optional(),
            qr_code_url: z.string().min(1).optional(),
            local_shipment_id: z.string().min(1).optional(),
          }),
        )
        .max(500)
        .default([]),
    })
    .optional(),
  disputes: z
    .object({
      local: z
        .array(
          z.object({
            dispute_id: z.string().min(1),
            order_id: z.string().min(1),
            status: disputeProductionStatusSchema,
            outcome: z
              .enum(["buyer_favor", "seller_favor", "partial_refund", "no_action"])
              .optional(),
            order_status: z.string().min(1).optional(),
            payment_state: z.string().min(1).optional(),
            refund_status: z.string().min(1).optional(),
            refund_amount_minor: z.number().int().min(0).optional(),
            expected_refund_amount_minor: z.number().int().min(0).optional(),
            settlement_release_status: z.string().min(1).optional(),
            return_shipment_status: z.string().min(1).optional(),
            finalized_at: z.string().datetime().optional(),
            finalization_attempts: z.number().int().min(0).optional(),
          }),
        )
        .max(500)
        .default([]),
    })
    .optional(),
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

  app.get("/admin/inbox/summary", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const summary = await getInboxSummary(db);
    return reply.send(summary);
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/admin/inbox/tags",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = paginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
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
  }>("/admin/inbox/disputes", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = disputeListSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }
    const items = await listActiveDisputes(db, {
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return reply.send({ items });
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/admin/inbox/payments",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = paginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
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
      const detail = await getInboxDetail(db, typeParse.data, request.params.id);
      if (!detail) {
        return reply.code(404).send({ error: "NOT_FOUND" });
      }
      return reply.send(detail);
    },
  );

  // ─── Jobs ──────────────────────────────────────────────────

  app.post("/admin/jobs/tag-promote", { preHandler: [requireAdmin] }, async (request, reply) => {
    // Audit logging is handled inside `runPromotionJob`, which inserts a
    // `promotion.run` row into admin_action_log with the full report as
    // payload. No route-level writeAuditLog call is needed here.
    const report = await runPromotionJob(db, getActorId(request));
    return reply.send({ report });
  });

  app.get(
    "/admin/jobs/tag-promote/last",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      const lastRun = await getLastPromotionRun(db);
      return reply.send({ lastRun });
    },
  );

  app.post(
    "/admin/reconciliation/report",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = productionReconciliationBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_RECONCILIATION_BODY", issues: parsed.error.issues });
      }

      const report = buildProductionReconciliationReport(parsed.data);
      await writeAuditLog(db, {
        actorId: getActorId(request),
        actionType: "reconciliation.report",
        targetType: "production_readiness",
        targetId: "report",
        payload: {
          generatedAt: report.generatedAt,
          reportOnly: report.reportOnly,
          summary: report.summary,
        },
      });
      return reply.send({ report });
    },
  );

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/admin/dispute-module-webhooks/dead-letter",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = paginationSchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
      }
      const items = await listDeadLetterDisputeModuleWebhookOutboxRecords(db, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      return reply.send({ items });
    },
  );

  // ─── Promotion rules CRUD ─────────────────────────────────

  app.get("/admin/promotion-rules", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const rules = await listPromotionRules(db);
    return reply.send({ rules });
  });

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
        return reply.code(400).send({ error: "INVALID_RULE_BODY", issues: parsed.error.issues });
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

  app.post("/admin/actions/tag-approve", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = tagApproveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }
    const actorId = getActorId(request);
    const result = await approveSuggestion(db, parsed.data.suggestionId, {
      reviewedBy: actorId,
      category: parsed.data.category ?? "uncategorized",
      initialStatus: parsed.data.initialStatus,
    });
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 409;
      return reply.code(code).send({ error: "TAG_APPROVE_FAILED", message: result.error });
    }
    await writeAuditLog(db, {
      actorId,
      actionType: "tag.approve",
      targetType: "tag_suggestion",
      targetId: parsed.data.suggestionId,
      payload: { result: result as unknown as Record<string, unknown> },
    });
    return reply.send({ result });
  });

  const tagRejectSchema = z.object({
    suggestionId: z.string().min(1),
    reason: z.string().optional(),
  });

  app.post("/admin/actions/tag-reject", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = tagRejectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
    }
    const actorId = getActorId(request);
    // Note: underlying `rejectSuggestion` does not accept a reason arg;
    // we record it in the audit-log payload instead.
    const result = await rejectSuggestion(db, parsed.data.suggestionId, actorId);
    if (!result.ok) {
      const code = /not found/i.test(result.error) ? 404 : 409;
      return reply.code(code).send({ error: "TAG_REJECT_FAILED", message: result.error });
    }
    await writeAuditLog(db, {
      actorId,
      actionType: "tag.reject",
      targetType: "tag_suggestion",
      targetId: parsed.data.suggestionId,
      payload: { reason: parsed.data.reason ?? null },
    });
    return reply.send({ result });
  });

  const tagMergeSchema = z.object({
    suggestionId: z.string().min(1),
    targetTagId: z.string().min(1),
  });

  app.post("/admin/actions/tag-merge", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = tagMergeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
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
      return reply.code(code).send({ error: "TAG_MERGE_FAILED", message: result.error });
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
  });

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
        return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
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
        return reply.code(409).send({ error: "DISPUTE_ALREADY_RESOLVED", status: dispute.status });
      }
      const currentTier =
        ((dispute.metadata as Record<string, unknown> | null)?.tier as number) ?? 1;
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
        return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
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
        return reply.code(409).send({ error: "DISPUTE_ALREADY_RESOLVED", status: dispute.status });
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
      if (!result.value) {
        return reply.code(409).send({
          error: "DISPUTE_RESOLVE_FAILED",
          message: "Resolution result missing",
        });
      }

      let finalization;
      try {
        finalization = await finalizeDisputeResolution(db, dispute, result.value, result.dispute);
      } catch (error) {
        return reply.code(500).send({
          error: "DISPUTE_FINALIZATION_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (result.trust_triggers.length > 0) {
        const order = await getCommerceOrderByOrderId(db, dispute.order_id);
        await applyTrustTriggers(db, {
          order_id: dispute.order_id,
          buyer_id: order?.buyerId ?? "",
          seller_id: order?.sellerId ?? "",
          triggers: result.trust_triggers,
        });
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
      return reply.send({ dispute: finalization.dispute });
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
        return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }
      const actorId = getActorId(request);
      const intent = await getPaymentIntentRowById(db, parsed.data.paymentIntentId);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (intent.status !== "FAILED") {
        return reply.code(409).send({
          error: "PAYMENT_INTENT_NOT_FAILED",
          status: intent.status,
        });
      }
      const existingContext = (intent.providerContext as Record<string, unknown> | null) ?? {};
      const mergedContext: Record<string, unknown> = {
        ...existingContext,
        manual_review: true,
        note: parsed.data.note,
        by: actorId,
        at: new Date().toISOString(),
      };
      await setPaymentIntentProviderContext(db, parsed.data.paymentIntentId, mergedContext);
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

  app.post(
    "/admin/actions/dispute-module-webhook-replay",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = webhookReplayBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_BODY", issues: parsed.error.issues });
      }

      const actorId = getActorId(request);
      const record = await resetDisputeModuleWebhookOutboxRecordForReplay(db, parsed.data.eventId);
      if (!record) {
        return reply.code(404).send({
          error: "WEBHOOK_OUTBOX_RECORD_NOT_REPLAYABLE",
          message:
            "No FAILED or DEAD_LETTER dispute module webhook outbox record matched this event id",
        });
      }

      await writeAuditLog(db, {
        actorId,
        actionType: "dispute_module_webhook.replay",
        targetType: "dispute_module_webhook_outbox",
        targetId: parsed.data.eventId,
        payload: {
          event_id: parsed.data.eventId,
          platform_id: record.platformId,
          dispute_id: record.disputeId,
          reason: parsed.data.reason,
        },
      });

      return reply.send({ record });
    },
  );
}
