/**
 * Demo E2E routes — quick-start helpers for testing the full
 * negotiation → payment → shipping → dispute flow.
 *
 * These routes create mock data so the frontend can exercise
 * the real API endpoints without needing a full negotiation session.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import { commerceOrders, settlementApprovals } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import {
  getCommerceOrderByOrderId,
  getPaymentIntentByOrderId,
} from "../services/payment-record.service.js";
import { getShipmentByOrderId } from "../services/shipment-record.service.js";
import { getDisputeByOrderId } from "../services/dispute-record.service.js";

const createDemoOrderSchema = z.object({
  amount_minor: z.number().int().positive().default(45000),
  currency: z.string().default("USD"),
  item_title: z.string().default("iPhone 14 Pro 128GB Space Black"),
});

function canAccessOrder(
  user: { id: string; role?: string } | undefined,
  order: { buyerId: string; sellerId: string },
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return user.id === order.buyerId || user.id === order.sellerId;
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function registerDemoE2ERoutes(app: FastifyInstance, db: Database) {
  /**
   * POST /demo/e2e/create-order
   * Creates a mock settlement approval + commerce order so the user
   * can immediately start the payment → shipping → dispute flow.
   */
  app.post("/demo/e2e/create-order", { preHandler: [requireAuth] }, async (request, reply) => {
    if (isProductionRuntime() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DEMO_E2E_DISABLED",
        message: "Demo order creation is disabled in production",
      });
    }

    const parsed = createDemoOrderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }

    const userId = request.user!.id;
    const now = new Date();
    const { amount_minor, currency, item_title } = parsed.data;

    // Generate deterministic demo seller ID (UUID v4 format from user ID)
    const demoSellerId = crypto.randomUUID();
    const demoListingId = crypto.randomUUID();

    // Create settlement approval
    const [approval] = await db
      .insert(settlementApprovals)
      .values({
        approvalState: "APPROVED",
        listingId: demoListingId,
        sellerId: demoSellerId,
        buyerId: userId,
        finalAmountMinor: String(amount_minor),
        currency,
        selectedPaymentRail: "x402",
        sellerApprovalMode: "AUTO_WITHIN_POLICY",
        termsSnapshot: {
          listing_id: demoListingId,
          seller_id: demoSellerId,
          buyer_id: userId,
          final_amount_minor: amount_minor,
          currency,
          selected_payment_rail: "x402",
          item_title,
        },
        buyerApprovedAt: now,
        sellerApprovedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create commerce order
    const [order] = await db
      .insert(commerceOrders)
      .values({
        settlementApprovalId: approval.id,
        listingId: demoListingId,
        sellerId: demoSellerId,
        buyerId: userId,
        status: "PAYMENT_PENDING",
        currency,
        amountMinor: String(amount_minor),
        orderSnapshot: {
          settlement_approval_id: approval.id,
          item_title,
          terms: {
            listing_id: demoListingId,
            seller_id: demoSellerId,
            buyer_id: userId,
            final_amount_minor: amount_minor,
            currency,
            selected_payment_rail: "x402",
          },
        },
      })
      .returning();

    return reply.code(201).send({
      order: {
        id: order.id,
        status: order.status,
        amountMinor: parseInt(String(order.amountMinor)),
        currency: order.currency,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        createdAt: order.createdAt.toISOString(),
        item_title,
      },
      settlement_approval_id: approval.id,
    });
  });

  /**
   * GET /demo/e2e/order/:orderId
   * Aggregated view: order + payment + shipment + dispute in one call.
   */
  app.get("/demo/e2e/order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };

    const [order, payment, shipment, dispute] = await Promise.all([
      getCommerceOrderByOrderId(db, orderId),
      getPaymentIntentByOrderId(db, orderId),
      getShipmentByOrderId(db, orderId),
      getDisputeByOrderId(db, orderId),
    ]);

    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    if (!canAccessOrder(request.user, order)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
    }

    return reply.send({
      order: {
        id: order.id,
        status: order.status,
        amountMinor: parseInt(String(order.amountMinor)),
        currency: order.currency,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        createdAt: order.createdAt.toISOString(),
        item_title: (order.orderSnapshot as Record<string, unknown>)?.item_title ?? null,
      },
      payment,
      shipment,
      dispute,
    });
  });

  /**
   * GET /commerce/orders/:id — single order lookup (used by order detail page).
   */
  app.get("/commerce/orders/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await getCommerceOrderByOrderId(db, id);
    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    if (!canAccessOrder(request.user, order)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
    }
    return reply.send({
      order: {
        id: order.id,
        status: order.status,
        amountMinor: parseInt(String(order.amountMinor)),
        currency: order.currency,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        createdAt: order.createdAt.toISOString(),
        item_title: (order.orderSnapshot as Record<string, unknown>)?.item_title ?? null,
      },
    });
  });

  /**
   * GET /payments/by-order/:orderId — find payment intent for an order.
   */
  app.get("/payments/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const order = await getCommerceOrderByOrderId(db, orderId);
    if (!order) {
      return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    }
    if (!canAccessOrder(request.user, order)) {
      return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
    }

    const payment = await getPaymentIntentByOrderId(db, orderId);
    if (!payment) {
      return reply.code(404).send({ error: "PAYMENT_NOT_FOUND" });
    }
    return reply.send({ payment });
  });
}
