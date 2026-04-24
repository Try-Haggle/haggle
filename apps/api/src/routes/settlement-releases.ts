import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
import {
  createSettlementRelease,
  confirmDelivery,
  completeBuyerReview,
  buyerConfirmReceipt,
  applyApvAdjustment,
  completeBufferRelease,
  computeReleasePhase,
} from "@haggle/payment-core";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import {
  createSettlementReleaseRecord,
  getSettlementReleaseById,
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createReleaseSchema = z.object({
  payment_intent_id: z.string(),
  order_id: z.string(),
  product_amount_minor: z.number().int().nonnegative(),
  buffer_amount_minor: z.number().int().nonnegative(),
  currency: z.string().default("USDC"),
});

const confirmDeliverySchema = z.object({
  delivered_at: z.string().datetime({ offset: true }),
});

const applyAdjustmentSchema = z.object({
  adjustment_minor: z.number().int(),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerSettlementReleaseRoutes(app: FastifyInstance, db: Database) {
  const { requireOrderOwner } = createOwnershipMiddleware(db);

  // POST /settlement-releases — Create a new settlement release
  app.post("/settlement-releases", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = createReleaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }

    const { payment_intent_id, order_id, product_amount_minor, buffer_amount_minor, currency } =
      parsed.data;

    const release = createSettlementRelease({
      payment_intent_id,
      order_id,
      product_amount: { currency, amount_minor: product_amount_minor },
      buffer_amount: { currency, amount_minor: buffer_amount_minor },
    });

    const stored = await createSettlementReleaseRecord(db, release);
    return reply.code(201).send({
      release: stored,
      phase: computeReleasePhase(stored),
    });
  });

  // GET /settlement-releases/:id — Get release by ID
  app.get("/settlement-releases/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }
    if (request.user?.role !== "admin") {
      const order = await db.query.commerceOrders.findFirst({
        where: (fields, ops) => ops.eq(fields.id, release.order_id),
      });
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }
      const userId = request.user!.id;
      if (userId !== order.buyerId && userId !== order.sellerId) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }
    return reply.send({
      release,
      phase: computeReleasePhase(release),
    });
  });

  // GET /settlement-releases/by-order/:orderId — Get release by order ID
  app.get("/settlement-releases/by-order/:orderId", { preHandler: [requireAuth, requireOrderOwner()] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const release = await getSettlementReleaseByOrderId(db, orderId);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }
    return reply.send({
      release,
      phase: computeReleasePhase(release),
    });
  });

  // POST /settlement-releases/:id/confirm-delivery — Confirm delivery
  app.post("/settlement-releases/:id/confirm-delivery", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }

    const parsed = confirmDeliverySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }

    let updated;
    try {
      updated = confirmDelivery(release, parsed.data.delivered_at);
    } catch (error) {
      return reply.code(400).send({
        error: "INVALID_STATE_TRANSITION",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await updateSettlementReleaseRecord(db, updated);
    return reply.send({
      release: updated,
      phase: computeReleasePhase(updated),
    });
  });

  // POST /settlement-releases/:id/complete-buyer-review — Complete buyer review
  app.post("/settlement-releases/:id/complete-buyer-review", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }

    let updated;
    try {
      updated = completeBuyerReview(release, new Date().toISOString());
    } catch (error) {
      return reply.code(400).send({
        error: "INVALID_STATE_TRANSITION",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await updateSettlementReleaseRecord(db, updated);
    return reply.send({
      release: updated,
      phase: computeReleasePhase(updated),
    });
  });

  // POST /settlement-releases/:id/apply-adjustment — Apply APV weight adjustment
  app.post("/settlement-releases/:id/apply-adjustment", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }

    const parsed = applyAdjustmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }

    let updated;
    try {
      updated = applyApvAdjustment(release, parsed.data.adjustment_minor);
    } catch (error) {
      return reply.code(400).send({
        error: "INVALID_STATE_TRANSITION",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await updateSettlementReleaseRecord(db, updated);
    return reply.send({
      release: updated,
      phase: computeReleasePhase(updated),
    });
  });

  // POST /settlement-releases/:id/release-buffer — Release weight buffer
  app.post("/settlement-releases/:id/release-buffer", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }

    let updated;
    try {
      updated = completeBufferRelease(release, new Date().toISOString());
    } catch (error) {
      return reply.code(400).send({
        error: "INVALID_STATE_TRANSITION",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await updateSettlementReleaseRecord(db, updated);
    return reply.send({
      release: updated,
      phase: computeReleasePhase(updated),
    });
  });

  // -------------------------------------------------------------------------
  // Order-ID-based endpoints (buyer flow)
  // -------------------------------------------------------------------------
  // Note: GET by order ID already exists at /settlement-releases/by-order/:orderId
  // The POST endpoints below use /by-order/:orderId/<action> to avoid
  // route collision with the existing /settlement-releases/:id param routes.

  // POST /settlement-releases/by-order/:orderId/buyer-confirm — Buyer confirms receipt
  app.post(
    "/settlement-releases/by-order/:orderId/buyer-confirm",
    { preHandler: [requireAuth, requireOrderOwner({ role: "buyer" })] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const release = await getSettlementReleaseByOrderId(db, orderId);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }

      let updated;
      try {
        updated = buyerConfirmReceipt(release, new Date().toISOString());
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );

  // POST /settlement-releases/by-order/:orderId/complete-buffer — Complete buffer release
  app.post(
    "/settlement-releases/by-order/:orderId/complete-buffer",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const release = await getSettlementReleaseByOrderId(db, orderId);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }

      let updated;
      try {
        updated = completeBufferRelease(release, new Date().toISOString());
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );
}
