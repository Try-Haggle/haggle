import { and, commerceOrders, type Database, desc, eq, or, sql } from "@haggle/db";
import { buyerConfirmReceipt, computeReleasePhase } from "@haggle/payment-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INPUT_LIMITS } from "../lib/input-limits.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  confirmBuyerAccess,
  FulfillmentConfirmError,
} from "../services/fulfillment-confirm.service.js";
import {
  FulfillmentProofError,
  submitSellerFulfillmentProof,
} from "../services/fulfillment-proof.service.js";
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import {
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const confirmDeliverySchema = z.object({
  confirmed: z.literal(true),
  notes: z.string().max(2000).optional(),
});

const submitFulfillmentProofSchema = z
  .object({
    kind: z.string().min(1).max(INPUT_LIMITS.shortTextChars),
    uri: z.string().min(1).max(INPUT_LIMITS.uriChars).optional(),
    sha256: z.string().min(1).max(INPUT_LIMITS.mediumTextChars).optional(),
    external_reference: z.string().min(1).max(INPUT_LIMITS.mediumTextChars).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.uri && !value.sha256 && !value.external_reference) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of uri, sha256, or external_reference is required",
        path: ["uri"],
      });
    }
  });

const confirmFulfillmentAccessSchema = z.object({
  confirmation: z.literal("access_received"),
  proof_id: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerOrderRoutes(app: FastifyInstance, db: Database) {
  const { requireOrderOwner } = createOwnershipMiddleware(db);

  // ---------------------------------------------------------------------------
  // GET /orders — list current user's orders
  // ---------------------------------------------------------------------------

  const listOrdersQuerySchema = z.object({
    role: z.enum(["buyer", "seller", "all"]).default("all"),
    status: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get("/orders", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = listOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_QUERY", issues: parsed.error.issues });
    }

    const userId = request.user!.id;
    const { role, status, limit, offset } = parsed.data;

    // Build WHERE condition based on role filter
    let roleCondition: ReturnType<typeof or>;
    if (role === "buyer") {
      roleCondition = eq(commerceOrders.buyerId, userId);
    } else if (role === "seller") {
      roleCondition = eq(commerceOrders.sellerId, userId);
    } else {
      roleCondition = or(eq(commerceOrders.buyerId, userId), eq(commerceOrders.sellerId, userId));
    }

    // Add optional status filter
    const whereCondition = status
      ? and(
          roleCondition,
          eq(commerceOrders.status, status as (typeof commerceOrders.status.enumValues)[number]),
        )
      : roleCondition;

    // Count total
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(commerceOrders)
      .where(whereCondition);
    const total = countRow?.count ?? 0;

    // Fetch orders
    const orders = await db
      .select()
      .from(commerceOrders)
      .where(whereCondition)
      .orderBy(desc(commerceOrders.createdAt))
      .limit(limit)
      .offset(offset);

    return reply.send({
      orders: orders.map((o) => ({
        id: o.id,
        settlement_approval_id: o.settlementApprovalId,
        listing_id: o.listingId,
        seller_id: o.sellerId,
        buyer_id: o.buyerId,
        status: o.status,
        currency: o.currency,
        amount_minor: Number(o.amountMinor),
        order_snapshot: o.orderSnapshot,
        created_at: o.createdAt.toISOString(),
        updated_at: o.updatedAt.toISOString(),
      })),
      total,
      limit,
      offset,
    });
  });

  // ---------------------------------------------------------------------------
  // GET /orders/:orderId — single order lookup for order/dispute detail screens
  // ---------------------------------------------------------------------------

  app.get<{ Params: { orderId: string } }>(
    "/orders/:orderId",
    { preHandler: [requireAuth, requireOrderOwner()] },
    async (request, reply) => {
      const order = await getCommerceOrderByOrderId(db, request.params.orderId);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      return reply.send({
        order: {
          id: order.id,
          settlement_approval_id: order.settlementApprovalId,
          listing_id: order.listingId,
          seller_id: order.sellerId,
          buyer_id: order.buyerId,
          status: order.status,
          currency: order.currency,
          amount_minor: Number(order.amountMinor),
          order_snapshot: order.orderSnapshot,
          created_at: order.createdAt.toISOString(),
          updated_at: order.updatedAt.toISOString(),
        },
      });
    },
  );

  /**
   * POST /orders/:orderId/confirm-delivery
   *
   * Buyer confirms they received the item and are satisfied.
   * This releases the escrowed product payment to the seller.
   *
   * Auth: buyer only (order.buyerId === user.id)
   * Idempotent: if already CLOSED, returns 200 with current state.
   */
  app.post<{ Params: { orderId: string } }>(
    "/orders/:orderId/confirm-delivery",
    { preHandler: [requireAuth, requireOrderOwner({ role: "buyer" })] },
    async (request, reply) => {
      const { orderId } = request.params;

      // --- Validate body ---
      const parsed = confirmDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: parsed.error.issues,
        });
      }

      // --- Load order (already verified by ownership middleware) ---
      const order = (request as unknown as Record<string, unknown>).orderResource as
        | { id: string; buyerId: string; sellerId: string; status: string }
        | undefined;
      if (!order) {
        // Fallback — should not happen if middleware ran
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      // --- Idempotent: already completed ---
      if (order.status === "CLOSED") {
        const release = await getSettlementReleaseByOrderId(db, orderId);
        return reply.send({
          order: { id: order.id, status: order.status },
          settlement_release: release
            ? { id: release.id, product_release_status: release.product_release_status }
            : null,
          already_confirmed: true,
        });
      }

      // --- Status guard ---
      if (order.status !== "DELIVERED") {
        return reply.code(400).send({
          error: "INVALID_ORDER_STATUS",
          message: `Order status must be DELIVERED to confirm delivery, got "${order.status}"`,
        });
      }

      // --- Load settlement release ---
      const release = await getSettlementReleaseByOrderId(db, orderId);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }

      // --- Release product payment ---
      // If the settlement release is already RELEASED, skip the transition
      let updatedRelease = release;
      if (release.product_release_status !== "RELEASED") {
        try {
          updatedRelease = buyerConfirmReceipt(release, new Date().toISOString());
        } catch (error) {
          return reply.code(400).send({
            error: "INVALID_STATE_TRANSITION",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        await updateSettlementReleaseRecord(db, updatedRelease);
      }

      // --- Update order status to CLOSED ---
      await updateCommerceOrderStatus(db, orderId, "CLOSED");

      return reply.send({
        order: { id: order.id, status: "CLOSED" },
        settlement_release: {
          id: updatedRelease.id,
          product_release_status: updatedRelease.product_release_status,
          product_released_at: updatedRelease.product_released_at,
          phase: computeReleasePhase(updatedRelease),
        },
        already_confirmed: false,
      });
    },
  );

  /**
   * POST /orders/:orderId/fulfillment/proofs
   *
   * Seller submits untrusted digital fulfillment evidence.
   * Updates fulfillment to PROOF_SUBMITTED / proof_status SUBMITTED.
   * Does NOT confirmFulfillment, start buyer review, or release funds (A5).
   *
   * Auth: seller only (order.sellerId === user.id)
   */
  app.post<{ Params: { orderId: string } }>(
    "/orders/:orderId/fulfillment/proofs",
    { preHandler: [requireAuth, requireOrderOwner({ role: "seller" })] },
    async (request, reply) => {
      const { orderId } = request.params;

      const parsed = submitFulfillmentProofSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: parsed.error.issues,
        });
      }

      // Capture settlement release snapshot before proof so callers/tests can
      // assert proof submit never mutates release / money movement.
      const releaseBefore = await getSettlementReleaseByOrderId(db, orderId);

      try {
        const result = await submitSellerFulfillmentProof(db, {
          order_id: orderId,
          submitted_by: request.user!.id,
          kind: parsed.data.kind,
          uri: parsed.data.uri,
          sha256: parsed.data.sha256,
          external_reference: parsed.data.external_reference,
          metadata: parsed.data.metadata,
        });

        const releaseAfter = await getSettlementReleaseByOrderId(db, orderId);

        return reply.code(201).send({
          proof: result.proof,
          fulfillment: {
            id: result.fulfillment.id,
            order_id: result.fulfillment.order_id,
            status: result.fulfillment.status,
            proof_status: result.fulfillment.proof_status,
            fulfilled_at: result.fulfillment.fulfilled_at ?? null,
            review_window_hours: result.fulfillment.review_window_hours,
          },
          settlement_release: releaseAfter
            ? {
                id: releaseAfter.id,
                product_release_status: releaseAfter.product_release_status,
                product_released_at: releaseAfter.product_released_at ?? null,
                phase: computeReleasePhase(releaseAfter),
              }
            : null,
          release_unchanged:
            (releaseBefore?.product_release_status ?? null) ===
              (releaseAfter?.product_release_status ?? null) &&
            (releaseBefore?.product_released_at ?? null) ===
              (releaseAfter?.product_released_at ?? null),
          buyer_review_started: false,
          auto_released: false,
        });
      } catch (error) {
        if (error instanceof FulfillmentProofError) {
          const status =
            error.code === "FULFILLMENT_NOT_FOUND"
              ? 404
              : error.code === "INVALID_FULFILLMENT_STATUS"
                ? 409
                : 400;
          return reply.code(status).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * POST /orders/:orderId/fulfillment/confirm
   *
   * Buyer confirms digital access received (A6).
   * Sets fulfilled_at / FULFILLED and starts buyer review via confirmFulfillment.
   * HARD GUARD: does NOT auto-release or set RELEASED / move money.
   *
   * Auth: buyer only (order.buyerId === user.id)
   */
  app.post<{ Params: { orderId: string } }>(
    "/orders/:orderId/fulfillment/confirm",
    { preHandler: [requireAuth, requireOrderOwner({ role: "buyer" })] },
    async (request, reply) => {
      const { orderId } = request.params;

      const parsed = confirmFulfillmentAccessSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_REQUEST",
          issues: parsed.error.issues,
        });
      }

      const releaseBefore = await getSettlementReleaseByOrderId(db, orderId);

      try {
        const result = await confirmBuyerAccess(db, {
          order_id: orderId,
          confirmation: parsed.data.confirmation,
          proof_id: parsed.data.proof_id,
        });

        const releaseAfter = result.settlement_release;
        const amountBefore = releaseBefore?.product_amount.amount_minor ?? null;
        const amountAfter = releaseAfter?.product_amount.amount_minor ?? null;
        const releasedAtBefore = releaseBefore?.product_released_at ?? null;
        const releasedAtAfter = releaseAfter?.product_released_at ?? null;

        return reply.send({
          fulfillment: {
            id: result.fulfillment.id,
            order_id: result.fulfillment.order_id,
            status: result.fulfillment.status,
            proof_status: result.fulfillment.proof_status,
            fulfilled_at: result.fulfillment.fulfilled_at ?? null,
            review_window_hours: result.fulfillment.review_window_hours,
          },
          settlement_release: releaseAfter
            ? {
                id: releaseAfter.id,
                product_release_status: releaseAfter.product_release_status,
                product_released_at: releaseAfter.product_released_at ?? null,
                delivery_confirmed_at: releaseAfter.delivery_confirmed_at ?? null,
                buyer_review_deadline: releaseAfter.buyer_review_deadline ?? null,
                phase: computeReleasePhase(releaseAfter),
              }
            : null,
          buyer_review_started: result.buyer_review_started,
          already_confirmed: result.already_confirmed,
          auto_released: false,
          // Money-move guard: product must not become RELEASED; amounts / released_at unchanged.
          release_not_auto_released:
            (releaseAfter?.product_release_status ?? null) !== "RELEASED" &&
            releasedAtBefore === releasedAtAfter &&
            amountBefore === amountAfter,
        });
      } catch (error) {
        if (error instanceof FulfillmentConfirmError) {
          const status =
            error.code === "FULFILLMENT_NOT_FOUND" || error.code === "PROOF_NOT_FOUND"
              ? 404
              : error.code === "INVALID_FULFILLMENT_STATUS" ||
                  error.code === "ORDER_IN_DISPUTE" ||
                  error.code === "INVALID_RELEASE_STATUS"
                ? 409
                : 400;
          return reply.code(status).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );
}
