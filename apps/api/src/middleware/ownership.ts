import type { FastifyRequest, FastifyReply } from "fastify";
import type { Database } from "@haggle/db";
import {
  getCommerceOrderByOrderId,
} from "../services/payment-record.service.js";
import { getDisputeById } from "../services/dispute-record.service.js";
import { getShipmentById } from "../services/shipment-record.service.js";
import { getPaymentIntentById } from "../services/payment-record.service.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderOwnerOpts {
  role?: "buyer" | "seller";
}

interface ShipmentOwnerOpts {
  role?: "buyer" | "seller";
}

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FORBIDDEN_RESPONSE = {
  error: "FORBIDDEN",
  message: "You do not have access to this resource",
} as const;

function isAdmin(request: FastifyRequest): boolean {
  return request.user?.role === "admin";
}

function isOwner(
  userId: string,
  buyerId: string,
  sellerId: string,
  roleConstraint?: "buyer" | "seller",
): boolean {
  if (roleConstraint === "buyer") return userId === buyerId;
  if (roleConstraint === "seller") return userId === sellerId;
  return userId === buyerId || userId === sellerId;
}

// ---------------------------------------------------------------------------
// Factory: creates ownership middleware that captures a `db` reference
// ---------------------------------------------------------------------------

/**
 * Creates all ownership middleware functions bound to the given Database.
 *
 * Usage in route registration:
 *
 *   const { requireOrderOwner, requireDisputeParty, ... } = createOwnershipMiddleware(db);
 *   app.post("/orders/:orderId/confirm-delivery", { preHandler: [requireAuth, requireOrderOwner({ role: "buyer" })] }, ...)
 */
export function createOwnershipMiddleware(db: Database) {
  /**
   * Verifies the authenticated user is the buyer or seller of the order.
   * Reads orderId from route param `:orderId`.
   * On success: stores fetched order as `request.orderResource` for downstream reuse.
   * Admin always passes.
   */
  function requireOrderOwner(opts?: OrderOwnerOpts): PreHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (isAdmin(request)) return;

      const userId = request.user!.id;
      const { orderId } = request.params as { orderId: string };

      if (!orderId) {
        return reply.code(400).send({ error: "MISSING_ORDER_ID" });
      }

      const order = await getCommerceOrderByOrderId(db, orderId);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      if (!isOwner(userId, order.buyerId, order.sellerId, opts?.role)) {
        return reply.code(403).send(FORBIDDEN_RESPONSE);
      }

      // Attach order to request for downstream reuse
      (request as unknown as Record<string, unknown>).orderResource = order;
    };
  }

  /**
   * For dispute routes: looks up the dispute's order, then checks ownership.
   * Reads disputeId from `:id` param.
   * Admin always passes.
   */
  function requireDisputeParty(): PreHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (isAdmin(request)) return;

      const userId = request.user!.id;
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.code(400).send({ error: "MISSING_DISPUTE_ID" });
      }

      const dispute = await getDisputeById(db, id);
      if (!dispute) {
        return reply.code(404).send({ error: "DISPUTE_NOT_FOUND" });
      }

      const order = await getCommerceOrderByOrderId(db, dispute.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }

      if (!isOwner(userId, order.buyerId, order.sellerId)) {
        return reply.code(403).send(FORBIDDEN_RESPONSE);
      }

      (request as unknown as Record<string, unknown>).orderResource = order;
    };
  }

  /**
   * For payment routes: looks up the payment intent's order, then checks ownership.
   * Reads paymentId from `:id` param.
   * Admin always passes.
   */
  function requirePaymentOwner(): PreHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (isAdmin(request)) return;

      const userId = request.user!.id;
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.code(400).send({ error: "MISSING_PAYMENT_ID" });
      }

      const intent = await getPaymentIntentById(db, id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_NOT_FOUND" });
      }

      if (!isOwner(userId, intent.buyer_id, intent.seller_id)) {
        return reply.code(403).send(FORBIDDEN_RESPONSE);
      }

      (request as unknown as Record<string, unknown>).paymentResource = intent;
    };
  }

  /**
   * For shipment routes: looks up the shipment's order, then checks ownership.
   * Reads shipmentId from `:id` param.
   * Admin always passes.
   */
  function requireShipmentOwner(opts?: ShipmentOwnerOpts): PreHandler {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (isAdmin(request)) return;

      const userId = request.user!.id;
      const { id } = request.params as { id: string };

      if (!id) {
        return reply.code(400).send({ error: "MISSING_SHIPMENT_ID" });
      }

      const shipment = await getShipmentById(db, id);
      if (!shipment) {
        return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
      }

      if (!isOwner(userId, shipment.buyer_id, shipment.seller_id, opts?.role)) {
        return reply.code(403).send(FORBIDDEN_RESPONSE);
      }

      (request as unknown as Record<string, unknown>).shipmentResource = shipment;
    };
  }

  return {
    requireOrderOwner,
    requireDisputeParty,
    requirePaymentOwner,
    requireShipmentOwner,
  };
}
