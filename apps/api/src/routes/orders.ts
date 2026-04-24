import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { type Database, commerceOrders, eq, or, and, desc, sql } from "@haggle/db";
import { buyerConfirmReceipt, computeReleasePhase } from "@haggle/payment-core";
import { requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import {
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";
import {
  getCommerceOrderByOrderId,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const confirmDeliverySchema = z.object({
  confirmed: z.literal(true),
  notes: z.string().max(2000).optional(),
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
    let roleCondition;
    if (role === "buyer") {
      roleCondition = eq(commerceOrders.buyerId, userId);
    } else if (role === "seller") {
      roleCondition = eq(commerceOrders.sellerId, userId);
    } else {
      roleCondition = or(
        eq(commerceOrders.buyerId, userId),
        eq(commerceOrders.sellerId, userId),
      );
    }

    // Add optional status filter
    const whereCondition = status
      ? and(roleCondition, eq(commerceOrders.status, status as typeof commerceOrders.status.enumValues[number]))
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
        { id: string; buyerId: string; sellerId: string; status: string } | undefined;
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
}
