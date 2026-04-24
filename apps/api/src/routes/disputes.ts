import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { disputeEvidence as disputeEvidenceTable, eq, and, sql } from "@haggle/db";
import { requireAuth, requireAdmin } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { DisputeService, validateEvidenceForReasonCode, REASON_CODE_REGISTRY, computeDisputeCost, createDepositRequirement } from "@haggle/dispute-core";
import type { DisputeCase, DisputeEvidence, DisputeReasonCode, DisputeTier } from "@haggle/dispute-core";
import {
  createDisputeRecord,
  getDisputeById,
  getDisputeByOrderId,
  updateDisputeRecord,
  addDisputeEvidenceRecord,
} from "../services/dispute-record.service.js";
import {
  createDisputeUploadUrl,
  disputeEvidenceExists,
  createDisputeViewUrl,
} from "../services/dispute-storage.service.js";
import {
  ALLOWED_EVIDENCE_TYPES,
  EVIDENCE_LIMITS,
  DISPUTE_VIEW_URL_TTL_SECONDS,
  isImageType,
  isVideoType,
  buildDisputeEvidencePath,
  validateDisputeStoragePath,
} from "../lib/dispute-storage-paths.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import { finalizeDisputeResolution } from "../services/dispute-resolution-finalizer.js";
import {
  getDepositByDisputeId,
  createDeposit,
  getPendingExpiredDeposits,
  updateDepositStatus,
  updateDepositMetadata,
} from "../services/dispute-deposit.service.js";
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import {
  initiateDepositCollection,
  confirmUsdcDeposit,
} from "../payments/deposit-collector.js";
import { isAddress } from "viem";
import { assignReviewersToDispute } from "./reviewer.js";
import { INPUT_LIMITS } from "../lib/input-limits.js";

const openDisputeSchema = z.object({
  order_id: z.string().max(INPUT_LIMITS.shortTextChars),
  reason_code: z.string().max(INPUT_LIMITS.shortTextChars),
  opened_by: z.enum(["buyer", "seller", "system"]),
  evidence: z
    .array(
      z.object({
        submitted_by: z.enum(["buyer", "seller", "system"]),
        type: z.enum(["text", "image", "video", "tracking_snapshot", "payment_proof", "other"]),
        uri: z.string().url().max(INPUT_LIMITS.uriChars).optional(),
        text: z.string().max(INPUT_LIMITS.longTextChars).optional(),
      }),
    )
    .max(10)
    .optional(),
});

const addEvidenceSchema = z.object({
  submitted_by: z.enum(["buyer", "seller", "system"]),
  type: z.enum(["text", "image", "video", "tracking_snapshot", "payment_proof", "other"]),
  uri: z.string().url().max(INPUT_LIMITS.uriChars).optional(),
  text: z.string().max(INPUT_LIMITS.longTextChars).optional(),
});

const uploadUrlSchema = z.object({
  filename: z.string().min(1).max(128),
  content_type: z.string().max(INPUT_LIMITS.shortTextChars),
  file_size_bytes: z.number().int().min(1),
});

const commitEvidenceSchema = z.object({
  storage_path: z.string().min(1).max(INPUT_LIMITS.uriChars),
  type: z.enum(["image", "video"]),
  description: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
});

const depositSchema = z.object({
  rail: z.enum(["usdc", "stripe", "mock"]).optional(),
  wallet_address: z.string().optional(),
});

const confirmUsdcSchema = z.object({
  wallet_address: z.string().min(1),
});

const escalateSchema = z.object({
  escalated_by: z.enum(["buyer", "seller", "system"]),
  reason: z.string().max(INPUT_LIMITS.disputeSummaryChars).optional(),
});

const resolveDisputeSchema = z.object({
  outcome: z.enum(["buyer_favor", "seller_favor", "partial_refund"]),
  summary: z.string().min(1).max(INPUT_LIMITS.disputeSummaryChars),
  refund_amount_minor: z.number().optional(),
});

const listDisputesQuerySchema = z.object({
  role: z.enum(["buyer", "seller", "all"]).default("all"),
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerDisputeRoutes(app: FastifyInstance, db: Database) {
  const disputeService = new DisputeService();
  const { requireDisputeParty } = createOwnershipMiddleware(db);

  // GET /disputes — list authenticated user's disputes
  app.get("/disputes", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = listDisputesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const { role, status, limit, offset } = parsed.data;
    const userId = request.user!.id;

    // Build raw SQL query joining dispute_cases → commerce_orders → settlement_approvals
    // to get item info and determine user role
    const statusFilter = status ? sql`AND dc.status = ${status}` : sql``;

    let roleFilter = sql``;
    if (role === "buyer") {
      roleFilter = sql`AND co.buyer_id = ${userId}`;
    } else if (role === "seller") {
      roleFilter = sql`AND co.seller_id = ${userId}`;
    }

    // Count total
    const countRaw = await db.execute(sql`
      SELECT COUNT(*)::text AS total
      FROM dispute_cases dc
      JOIN commerce_orders co ON co.id = dc.order_id
      WHERE (co.buyer_id = ${userId} OR co.seller_id = ${userId})
      ${statusFilter}
      ${roleFilter}
    `);
    const countRows = (countRaw as unknown as { rows?: Record<string, unknown>[] }).rows ?? [];
    const total = parseInt((countRows[0]?.total as string) ?? "0");

    // Needs-action ordering: WAITING states first, then OPEN, UNDER_REVIEW, then resolved/closed
    interface DisputeListRow {
      id: string;
      order_id: string;
      reason_code: string;
      status: string;
      opened_by: string;
      opened_at: string;
      metadata: Record<string, unknown> | null;
      resolution_summary: string | null;
      buyer_id: string;
      seller_id: string;
      amount_minor: string | null;
      order_snapshot: Record<string, unknown> | null;
      final_amount_minor: string | null;
      terms_snapshot: Record<string, unknown> | null;
      refund_amount_minor: string | null;
      resolution_outcome: string | null;
    }

    const rawResult = await db.execute(sql`
      SELECT
        dc.id,
        dc.order_id,
        dc.reason_code,
        dc.status,
        dc.opened_by,
        dc.opened_at::text AS opened_at,
        dc.metadata,
        dc.resolution_summary,
        co.buyer_id,
        co.seller_id,
        co.amount_minor,
        co.order_snapshot,
        sa.final_amount_minor,
        sa.terms_snapshot,
        dr.refund_amount_minor,
        dr.outcome AS resolution_outcome
      FROM dispute_cases dc
      JOIN commerce_orders co ON co.id = dc.order_id
      LEFT JOIN settlement_approvals sa ON sa.id = co.settlement_approval_id
      LEFT JOIN dispute_resolutions dr ON dr.dispute_id = dc.id
      WHERE (co.buyer_id = ${userId} OR co.seller_id = ${userId})
      ${statusFilter}
      ${roleFilter}
      ORDER BY
        CASE dc.status
          WHEN 'WAITING_FOR_BUYER' THEN 1
          WHEN 'WAITING_FOR_SELLER' THEN 2
          WHEN 'OPEN' THEN 3
          WHEN 'UNDER_REVIEW' THEN 4
          WHEN 'RESOLVED_BUYER_FAVOR' THEN 5
          WHEN 'RESOLVED_SELLER_FAVOR' THEN 5
          WHEN 'PARTIAL_REFUND' THEN 5
          WHEN 'CLOSED' THEN 6
          ELSE 5
        END,
        dc.created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `);
    const dataRows = (rawResult as unknown as { rows?: DisputeListRow[] }).rows ?? [];

    const disputes = dataRows.map((row) => {
      const isBuyer = row.buyer_id === userId;
      const userRole = isBuyer ? "buyer" : "seller";

      // Determine needs_action based on status and role
      let needsAction = false;
      if (row.status === "WAITING_FOR_BUYER" && isBuyer) needsAction = true;
      if (row.status === "WAITING_FOR_SELLER" && !isBuyer) needsAction = true;
      if (row.status === "OPEN" && row.opened_by !== userRole) needsAction = true;

      // Extract item title from terms_snapshot or order_snapshot
      const terms = row.terms_snapshot as Record<string, unknown> | null;
      const orderSnap = row.order_snapshot as Record<string, unknown> | null;
      const orderTerms = orderSnap?.terms as Record<string, unknown> | undefined;
      const itemTitle =
        (terms?.item_name as string | undefined) ??
        (orderTerms?.item_name as string | undefined) ??
        (orderTerms?.listing_id as string | undefined) ??
        null;

      const amountMinor = row.final_amount_minor
        ? parseInt(row.final_amount_minor)
        : row.amount_minor
          ? parseInt(row.amount_minor)
          : null;

      const tier = row.metadata ? (row.metadata as Record<string, unknown>).tier as number | null ?? null : null;

      return {
        id: row.id,
        order_id: row.order_id,
        reason_code: row.reason_code,
        status: row.status,
        tier,
        opened_by: row.opened_by,
        opened_at: row.opened_at,
        user_role: userRole as "buyer" | "seller",
        counterparty_name: null as string | null, // User names not available in current schema
        item_title: itemTitle,
        amount_minor: amountMinor,
        needs_action: needsAction,
        resolution_outcome: row.resolution_outcome ?? null,
        refund_amount_minor: row.refund_amount_minor ? parseInt(row.refund_amount_minor) : null,
      };
    });

    return reply.send({ disputes, total, limit, offset });
  });

  // POST /disputes — open a new dispute
  app.post("/disputes", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = openDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_DISPUTE_REQUEST", issues: parsed.error.issues });
    }

    // Verify requester is buyer or seller of the order — derive opened_by from role
    const order = await getCommerceOrderByOrderId(db, parsed.data.order_id);
    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    const userId = request.user!.id;
    let derivedOpenedBy: "buyer" | "seller" | "system";
    if (request.user?.role === "admin") {
      derivedOpenedBy = parsed.data.opened_by; // admin can specify
    } else if (userId === order.buyerId) {
      derivedOpenedBy = "buyer";
    } else if (userId === order.sellerId) {
      derivedOpenedBy = "seller";
    } else {
      return reply.code(403).send({ error: "FORBIDDEN", message: "You are not a party to this order" });
    }

    const reasonCode = parsed.data.reason_code as DisputeReasonCode;
    if (!(reasonCode in REASON_CODE_REGISTRY)) {
      return reply.code(400).send({ error: "INVALID_REASON_CODE", reason_code: parsed.data.reason_code });
    }

    const evidence = (parsed.data.evidence ?? []).map((e) => ({
      submitted_by: request.user?.role === "admin" ? e.submitted_by : derivedOpenedBy,
      type: e.type,
      uri: e.uri,
      text: e.text,
    }));

    const result = disputeService.openCase({
      order_id: parsed.data.order_id,
      reason_code: reasonCode,
      opened_by: derivedOpenedBy,
      initial_evidence: evidence,
    });

    await createDisputeRecord(db, result.dispute);

    // Transition order to IN_DISPUTE
    await updateCommerceOrderStatus(db, parsed.data.order_id, "IN_DISPUTE");

    return reply.code(201).send(result);
  });

  // POST /disputes/deposits/expire — admin/cron: forfeit expired deposits
  // Registered BEFORE /:id routes to avoid route collision
  app.post("/disputes/deposits/expire", { preHandler: [requireAdmin] }, async (_request, reply) => {
    const expired = await getPendingExpiredDeposits(db);
    let forfeited = 0;
    for (const deposit of expired) {
      await updateDepositStatus(db, deposit.id, "FORFEITED", { resolvedAt: new Date() });
      forfeited++;
    }
    return reply.send({ forfeited_count: forfeited });
  });

  // POST /disputes/:id/escalate — escalate T1→T2→T3 with auto deposit
  app.post<{ Params: { id: string } }>("/disputes/:id/escalate", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = escalateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_ESCALATE_REQUEST", issues: parsed.error.issues });
    }

    const dispute = await getDisputeById(db, id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    // Order already loaded by ownership middleware
    const order = (request as unknown as Record<string, unknown>).orderResource as
      { id: string; buyerId: string; sellerId: string; amountMinor?: unknown } | undefined
      ?? await getCommerceOrderByOrderId(db, dispute.order_id);

    // Determine current tier from metadata or default to T1
    const currentTier = (dispute.metadata as Record<string, unknown>)?.tier as number ?? 1;
    if (currentTier >= 3) {
      return reply.code(400).send({ error: "MAX_TIER_REACHED", message: "Cannot escalate beyond T3" });
    }

    const nextTier = (currentTier + 1) as DisputeTier;

    // Compute cost for next tier using dispute-core — use order amount as GMV basis
    const amountCents = order?.amountMinor
      ? parseInt(String(order.amountMinor))
      : 0;

    if (amountCents <= 0) {
      return reply.code(400).send({ error: "INVALID_DISPUTE_AMOUNT", message: "Order must have a positive amount for escalation" });
    }

    const cost = computeDisputeCost(amountCents, nextTier);

    // Update dispute metadata with new tier
    await updateDisputeRecord(db, {
      ...dispute,
      metadata: {
        ...(dispute.metadata as Record<string, unknown>),
        tier: nextTier,
        escalated_by: parsed.data.escalated_by,
        escalated_reason: parsed.data.reason ?? null,
      },
    });

    // For T2/T3: create deposit requirement (seller-only deposit)
    let deposit = null;
    if (nextTier >= 2) {
      const depositReq = createDepositRequirement(id, nextTier as 2 | 3, amountCents);
      deposit = await createDeposit(db, {
        disputeId: id,
        tier: nextTier,
        amountCents: depositReq.amount_cents,
        deadlineHours: depositReq.deadline_hours,
        deadlineAt: new Date(Date.now() + depositReq.deadline_hours * 60 * 60 * 1000),
      });
    }

    // Auto-assign reviewers for T2/T3 escalation
    let reviewerAssignment = null;
    if (nextTier >= 2 && order) {
      try {
        reviewerAssignment = await assignReviewersToDispute(
          db,
          id,
          nextTier,
          amountCents,
          order.buyerId,
          order.sellerId,
        );
      } catch (assignErr) {
        console.error(
          "[disputes] Auto-assign reviewers failed:",
          assignErr instanceof Error ? assignErr.message : String(assignErr),
        );
      }
    }

    return reply.send({
      dispute_id: id,
      previous_tier: currentTier,
      new_tier: nextTier,
      cost,
      deposit,
      reviewer_assignment: reviewerAssignment,
    });
  });

  // GET /disputes/:id
  app.get("/disputes/:id", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }
    return reply.send({ dispute });
  });

  // GET /disputes/by-order/:orderId
  app.get("/disputes/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const dispute = await getDisputeByOrderId(db, (request.params as { orderId: string }).orderId);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    // Ownership check: requireDisputeParty reads :id param which this route lacks.
    // Inline check instead — admin always passes.
    if (request.user?.role !== "admin") {
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }
      const userId = request.user!.id;
      if (userId !== order.buyerId && userId !== order.sellerId) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }

    return reply.send({ dispute });
  });

  // POST /disputes/:id/review — start review
  app.post("/disputes/:id/review", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.startReview(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REVIEW_START_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-buyer-evidence
  app.post("/disputes/:id/request-buyer-evidence", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.requestBuyerEvidence(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REQUEST_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/request-seller-evidence
  app.post("/disputes/:id/request-seller-evidence", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    try {
      const result = disputeService.requestSellerEvidence(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "REQUEST_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/evidence — add evidence
  app.post("/disputes/:id/evidence", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = addEvidenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_EVIDENCE", issues: parsed.error.issues });
    }

    try {
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as {
          id: string;
          buyerId: string;
          sellerId: string;
        } | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      let submittedBy: "buyer" | "seller" | "system";
      if (request.user?.role === "admin") {
        submittedBy = parsed.data.submitted_by;
      } else if (request.user!.id === order.buyerId) {
        submittedBy = "buyer";
      } else if (request.user!.id === order.sellerId) {
        submittedBy = "seller";
      } else {
        return reply.code(403).send({ error: "FORBIDDEN", message: "You are not a party to this order" });
      }

      const result = disputeService.addEvidence(dispute, {
        ...parsed.data,
        submitted_by: submittedBy,
      });
      await updateDisputeRecord(db, result.dispute);
      if (result.value) {
        await addDisputeEvidenceRecord(db, result.value);
      }

      // Validate evidence completeness
      const validation = validateEvidenceForReasonCode(
        dispute.reason_code as DisputeReasonCode,
        result.dispute.evidence,
      );

      return reply.send({ ...result, evidence_validation: validation });
    } catch (error) {
      return reply.code(400).send({
        error: "ADD_EVIDENCE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/resolve — resolve the dispute
  app.post("/disputes/:id/resolve", { preHandler: [requireAdmin] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }

    const parsed = resolveDisputeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RESOLUTION", issues: parsed.error.issues });
    }

    try {
      const result = disputeService.resolve(dispute, parsed.data);
      if (!result.value) {
        return reply.code(400).send({ error: "RESOLUTION_FAILED", message: "Resolution result missing" });
      }

      const finalization = await finalizeDisputeResolution(db, dispute, result.value, result.dispute);

      // Resolve buyer/seller from the commerce order
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);

      if (result.trust_triggers.length > 0) {
        await applyTrustTriggers(db, {
          order_id: dispute.order_id,
          buyer_id: order?.buyerId ?? "",
          seller_id: order?.sellerId ?? "",
          triggers: result.trust_triggers,
        });
      }

      return reply.send({
        ...result,
        dispute: finalization.dispute,
        auto_refund: finalization.auto_refund,
        deposit_refund: finalization.deposit_refund,
      });
    } catch (error) {
      return reply.code(400).send({
        error: "RESOLUTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/close — close the dispute
  app.post("/disputes/:id/close", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const dispute = await getDisputeById(db, (request.params as { id: string }).id);
    if (!dispute) {
      return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
    }
    if ((process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") && request.user?.role !== "admin") {
      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      const openerUserId = dispute.opened_by === "buyer" ? order?.buyerId : order?.sellerId;
      if (!openerUserId || request.user?.id !== openerUserId) {
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Only the party who opened the dispute can close it in production",
        });
      }
    }

    try {
      const result = disputeService.closeCase(dispute);
      await updateDisputeRecord(db, result.dispute);
      return reply.send(result);
    } catch (error) {
      return reply.code(400).send({
        error: "CLOSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/deposit — initiate deposit payment collection
  app.post<{ Params: { id: string } }>("/disputes/:id/deposit", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = depositSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_DEPOSIT_REQUEST", issues: parsed.error.issues });
    }

    // 1. Validate deposit exists and is PENDING
    const deposit = await getDepositByDisputeId(db, id);
    if (!deposit) {
      return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
    }

    if (deposit.status !== "PENDING") {
      return reply.code(400).send({ error: "DEPOSIT_ALREADY_PROCESSED", message: `Deposit status is ${deposit.status}` });
    }

    // 2. Validate caller is the seller (deposits are seller-only)
    const order = (request as unknown as Record<string, unknown>).orderResource as
      { id: string; buyerId: string; sellerId: string; amountMinor?: unknown } | undefined;
    const userId = request.user!.id;
    if (order && userId !== order.sellerId) {
      return reply.code(403).send({ error: "SELLER_ONLY", message: "Only the seller can post a deposit" });
    }

    // 3. Validate wallet address if provided (for USDC rail)
    if (parsed.data.wallet_address && !isAddress(parsed.data.wallet_address)) {
      return reply.code(400).send({ error: "INVALID_WALLET_ADDRESS", message: "wallet_address must be a valid Ethereum address" });
    }

    // 4. Amount is ALWAYS server-computed — never trust client
    const amountCents = deposit.amountCents;

    // 5. Initiate deposit collection
    try {
      const result = await initiateDepositCollection({
        deposit_id: deposit.id,
        dispute_id: id,
        amount_cents: amountCents,
        seller_wallet_address: parsed.data.wallet_address,
        seller_user_id: userId,
        rail: parsed.data.rail,
      });

      const rail = result.rail;

      if (rail === "mock") {
        // Mock: immediately mark as DEPOSITED
        const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
          depositedAt: new Date(),
          metadata: {
            ...(deposit.metadata ?? {}),
            rail,
            mock_tx_id: result.mock_tx_id,
          },
        });
        return reply.send({ deposit: updated, collection: result });
      }

      if (rail === "usdc") {
        // USDC: update metadata with approval instructions, status stays PENDING
        await updateDepositMetadata(db, deposit.id, {
          ...(deposit.metadata ?? {}),
          rail,
          wallet_address: parsed.data.wallet_address,
          usdc_approval: result.usdc_approval,
        });
        return reply.send({ deposit: { ...deposit, metadata: { ...(deposit.metadata ?? {}), rail } }, collection: result });
      }

      if (rail === "stripe") {
        // Stripe: update metadata with session info, status stays PENDING
        await updateDepositMetadata(db, deposit.id, {
          ...(deposit.metadata ?? {}),
          rail,
          stripe_payment_intent_id: result.stripe_payment_intent_id,
        });
        return reply.send({ deposit: { ...deposit, metadata: { ...(deposit.metadata ?? {}), rail } }, collection: result });
      }

      // Should not reach here
      return reply.send({ deposit, collection: result });
    } catch (error) {
      return reply.code(500).send({
        error: "DEPOSIT_COLLECTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /disputes/:id/deposit/confirm-usdc — confirm USDC deposit after seller approved spend
  app.post<{ Params: { id: string } }>("/disputes/:id/deposit/confirm-usdc", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const parsed = confirmUsdcSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONFIRM_REQUEST", issues: parsed.error.issues });
    }

    // 1. Validate wallet address
    if (!isAddress(parsed.data.wallet_address)) {
      return reply.code(400).send({ error: "INVALID_WALLET_ADDRESS", message: "wallet_address must be a valid Ethereum address" });
    }

    // 2. Validate deposit exists and is PENDING
    const deposit = await getDepositByDisputeId(db, id);
    if (!deposit) {
      return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
    }

    if (deposit.status !== "PENDING") {
      return reply.code(400).send({ error: "DEPOSIT_ALREADY_PROCESSED", message: `Deposit status is ${deposit.status}` });
    }

    // 3. Validate the deposit was initiated with USDC rail
    const depositMeta = deposit.metadata as Record<string, unknown> | null;
    if (depositMeta?.rail !== "usdc") {
      return reply.code(400).send({ error: "WRONG_RAIL", message: "This deposit was not initiated with USDC rail" });
    }

    // 4. Validate caller is the seller
    const order = (request as unknown as Record<string, unknown>).orderResource as
      { id: string; buyerId: string; sellerId: string; amountMinor?: unknown } | undefined;
    const userId = request.user!.id;
    if (order && userId !== order.sellerId) {
      return reply.code(403).send({ error: "SELLER_ONLY", message: "Only the seller can confirm a deposit" });
    }

    // 5. Amount is server-computed — use the stored deposit amount
    const amountCents = deposit.amountCents;

    try {
      // 6. Execute transferFrom via gas relayer (verifies allowance on-chain)
      const { tx_hash } = await confirmUsdcDeposit({
        deposit_id: deposit.id,
        seller_wallet_address: parsed.data.wallet_address,
        amount_cents: amountCents,
      });

      // 7. Mark deposit as DEPOSITED
      const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
        depositedAt: new Date(),
        metadata: {
          ...(depositMeta ?? {}),
          tx_hash,
          confirmed_at: new Date().toISOString(),
        },
      });

      return reply.send({ deposit: updated, tx_hash });
    } catch (error) {
      return reply.code(500).send({
        error: "USDC_DEPOSIT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // GET /disputes/:id/deposit — get deposit for a dispute
  app.get<{ Params: { id: string } }>("/disputes/:id/deposit", { preHandler: [requireAuth, requireDisputeParty()] }, async (request, reply) => {
    const { id } = request.params;
    const deposit = await getDepositByDisputeId(db, id);
    if (!deposit) {
      return reply.code(404).send({ error: "DEPOSIT_NOT_FOUND" });
    }
    return reply.send({ deposit });
  });

  // ---------------------------------------------------------------------------
  // Evidence file upload endpoints
  // ---------------------------------------------------------------------------

  /** States in which evidence submission is still accepted. */
  const EVIDENCE_ACCEPTING_STATES = new Set([
    "OPEN",
    "UNDER_REVIEW",
    "WAITING_FOR_BUYER",
    "WAITING_FOR_SELLER",
  ]);

  /**
   * Count existing evidence records for a dispute, grouped by media category.
   */
  async function countEvidenceByType(
    disputeId: string,
  ): Promise<{ imageCount: number; videoCount: number }> {
    const rows = await db
      .select({
        type: disputeEvidenceTable.type,
      })
      .from(disputeEvidenceTable)
      .where(eq(disputeEvidenceTable.disputeId, disputeId));

    let imageCount = 0;
    let videoCount = 0;
    for (const row of rows) {
      if (row.type === "image") imageCount++;
      if (row.type === "video") videoCount++;
    }
    return { imageCount, videoCount };
  }

  /**
   * Compute remaining upload limits for a dispute given its current evidence
   * and the associated order amount.
   */
  function computeRemainingLimits(
    imageCount: number,
    videoCount: number,
    orderAmountCents: number,
  ) {
    const isHighValue =
      orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
    const videoLimits = isHighValue
      ? EVIDENCE_LIMITS.video_high_value
      : EVIDENCE_LIMITS.video_standard;

    return {
      remaining_images: Math.max(0, EVIDENCE_LIMITS.image.maxCount - imageCount),
      remaining_videos: Math.max(0, videoLimits.maxCount - videoCount),
      max_video_size_bytes: videoLimits.maxSizeBytes,
      max_video_duration_sec: videoLimits.maxDurationSec,
    };
  }

  // POST /disputes/:id/evidence/upload-url — Get a presigned upload URL
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/upload-url",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = uploadUrlSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_UPLOAD_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const { filename, content_type, file_size_bytes } = parsed.data;

      // 1. Validate dispute exists and is in an evidence-accepting state
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }

      // 2. Validate content_type
      if (
        !(ALLOWED_EVIDENCE_TYPES as readonly string[]).includes(content_type)
      ) {
        return reply.code(400).send({
          error: "UNSUPPORTED_CONTENT_TYPE",
          message: `Allowed: ${ALLOWED_EVIDENCE_TYPES.join(", ")}`,
        });
      }

      // 3. Determine media category
      const isImage = isImageType(content_type);
      const isVideo = isVideoType(content_type);

      // 4. Get order amount for video tier determination
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as {
          id: string;
          buyerId: string;
          sellerId: string;
          amountMinor?: unknown;
        } | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

      const orderAmountCents = order?.amountMinor
        ? parseInt(String(order.amountMinor))
        : 0;

      // 5. Count existing evidence and check limits
      const { imageCount, videoCount } = await countEvidenceByType(id);
      const limits = computeRemainingLimits(
        imageCount,
        videoCount,
        orderAmountCents,
      );

      if (isImage) {
        if (limits.remaining_images <= 0) {
          return reply.code(400).send({
            error: "IMAGE_LIMIT_REACHED",
            message: `Maximum ${EVIDENCE_LIMITS.image.maxCount} images allowed`,
          });
        }
        if (file_size_bytes > EVIDENCE_LIMITS.image.maxSizeBytes) {
          return reply.code(400).send({
            error: "FILE_TOO_LARGE",
            message: `Image max size: ${EVIDENCE_LIMITS.image.maxSizeBytes} bytes`,
          });
        }
      }

      if (isVideo) {
        if (limits.remaining_videos <= 0) {
          const isHighValue =
            orderAmountCents >= EVIDENCE_LIMITS.high_value_threshold_cents;
          const maxCount = isHighValue
            ? EVIDENCE_LIMITS.video_high_value.maxCount
            : EVIDENCE_LIMITS.video_standard.maxCount;
          return reply.code(400).send({
            error: "VIDEO_LIMIT_REACHED",
            message: `Maximum ${maxCount} video(s) allowed for this transaction`,
          });
        }
        if (file_size_bytes > limits.max_video_size_bytes) {
          return reply.code(400).send({
            error: "FILE_TOO_LARGE",
            message: `Video max size: ${limits.max_video_size_bytes} bytes`,
          });
        }
      }

      // 6. Generate presigned upload URL
      const evidenceId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const objectPath = buildDisputeEvidencePath(
        id,
        `${evidenceId}_${filename}`,
      );
      const result = await createDisputeUploadUrl(objectPath);

      // Recompute limits after this upload (optimistic)
      const newLimits = computeRemainingLimits(
        imageCount + (isImage ? 1 : 0),
        videoCount + (isVideo ? 1 : 0),
        orderAmountCents,
      );

      return reply.send({
        upload_url: result.uploadUrl,
        storage_path: result.storagePath,
        token: result.token,
        expires_in: result.expiresIn,
        limits: newLimits,
      });
    },
  );

  // POST /disputes/:id/evidence/commit — Commit an uploaded file as evidence
  app.post<{ Params: { id: string } }>(
    "/disputes/:id/evidence/commit",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id } = request.params;

      const parsed = commitEvidenceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_COMMIT_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const { storage_path, type, description } = parsed.data;

      // 1. Validate dispute
      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }
      if (!EVIDENCE_ACCEPTING_STATES.has(dispute.status)) {
        return reply.code(400).send({
          error: "DISPUTE_NOT_ACCEPTING_EVIDENCE",
          message: `Dispute is in ${dispute.status} state`,
        });
      }

      // 2. Validate & normalize the storage path
      let normalizedPath: string;
      try {
        normalizedPath = validateDisputeStoragePath(id, storage_path);
      } catch (err) {
        return reply.code(400).send({
          error: "INVALID_STORAGE_PATH",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      // 3. Verify file exists in storage
      const exists = await disputeEvidenceExists(normalizedPath);
      if (!exists) {
        return reply.code(400).send({
          error: "FILE_NOT_FOUND",
          message: "File does not exist in storage. Upload it first.",
        });
      }

      // 4. Determine submitted_by from user's role on the order
      const order =
        ((request as unknown as Record<string, unknown>).orderResource as {
          id: string;
          buyerId: string;
          sellerId: string;
          amountMinor?: unknown;
        } | undefined) ?? (await getCommerceOrderByOrderId(db, dispute.order_id));

      const userId = request.user!.id;
      let submittedBy: "buyer" | "seller";
      if (userId === order?.buyerId) {
        submittedBy = "buyer";
      } else if (userId === order?.sellerId) {
        submittedBy = "seller";
      } else {
        // Admin submitting — default to system, but schema only allows buyer/seller
        // for file evidence. Admin case should not reach here due to middleware.
        return reply.code(403).send({
          error: "FORBIDDEN",
          message: "Cannot determine party role",
        });
      }

      // 5. Create evidence record
      const evidenceId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const evidence: DisputeEvidence = {
        id: evidenceId,
        dispute_id: id,
        submitted_by: submittedBy,
        type,
        uri: storage_path,
        text: description,
        created_at: new Date().toISOString(),
      };

      await addDisputeEvidenceRecord(db, evidence);

      // 6. Run evidence validation
      const allEvidence = [...dispute.evidence, evidence];
      const validation = validateEvidenceForReasonCode(
        dispute.reason_code as DisputeReasonCode,
        allEvidence,
      );

      // 7. Compute remaining limits
      const orderAmountCents = order?.amountMinor
        ? parseInt(String(order.amountMinor))
        : 0;
      const { imageCount, videoCount } = await countEvidenceByType(id);
      const limits = computeRemainingLimits(
        imageCount,
        videoCount,
        orderAmountCents,
      );

      return reply.code(201).send({
        evidence,
        evidence_validation: validation,
        limits,
      });
    },
  );

  // GET /disputes/:id/evidence/:evidenceId/view — Get a signed view URL
  app.get<{ Params: { id: string; evidenceId: string } }>(
    "/disputes/:id/evidence/:evidenceId/view",
    { preHandler: [requireAuth, requireDisputeParty()] },
    async (request, reply) => {
      const { id, evidenceId } = request.params;

      // Look up the evidence record
      const rows = await db
        .select()
        .from(disputeEvidenceTable)
        .where(
          and(
            eq(disputeEvidenceTable.id, evidenceId),
            eq(disputeEvidenceTable.disputeId, id),
          ),
        );

      if (rows.length === 0) {
        return reply.code(404).send({ error: "EVIDENCE_NOT_FOUND" });
      }

      const evidenceRow = rows[0];
      if (!evidenceRow.uri) {
        return reply.code(400).send({
          error: "NO_FILE_URI",
          message: "This evidence record has no associated file",
        });
      }

      // Strip bucket prefix if present to get the inner object path
      const BUCKET_PREFIX = "dispute-evidence/";
      const objectPath = evidenceRow.uri.startsWith(BUCKET_PREFIX)
        ? evidenceRow.uri.slice(BUCKET_PREFIX.length)
        : evidenceRow.uri;

      const viewUrl = await createDisputeViewUrl(objectPath);

      return reply.send({
        view_url: viewUrl,
        expires_in: DISPUTE_VIEW_URL_TTL_SECONDS,
      });
    },
  );
}
