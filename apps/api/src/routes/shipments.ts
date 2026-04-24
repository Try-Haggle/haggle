import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  type Database,
  eq as eqOp,
  and as andOp,
  orderAddresses,
  shipments as shipmentsTable,
  userSavedAddresses,
} from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import {
  ShippingService,
  MockCarrierAdapter,
  EasyPostCarrierAdapter,
  verifyEasyPostWebhook,
  parseEasyPostWebhookPayload,
  parseEasyPostInvoicePayload,
  transitionShipmentStatus,
  computeWeightBuffer,
} from "@haggle/shipping-core";
import { applyApvAdjustment, confirmDelivery } from "@haggle/payment-core";
import {
  createShipmentRecord,
  getShipmentById,
  getShipmentByOrderId,
  updateShipmentRecord,
  insertShipmentEvent,
} from "../services/shipment-record.service.js";
import {
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";
import {
  createDisputeRecord,
  getDisputeByOrderId,
} from "../services/dispute-record.service.js";
import type { ShipmentStatus } from "@haggle/shipping-core";
import { createId } from "@haggle/dispute-core";
import type { DisputeCase } from "@haggle/dispute-core";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import { updateCommerceOrderStatus, getCommerceOrderByOrderId } from "../services/payment-record.service.js";
import { INPUT_LIMITS, boundedJson } from "../lib/input-limits.js";

type ShipmentEventType = Parameters<typeof transitionShipmentStatus>[1];

/** Map a canonical ShipmentStatus to the event that would cause a transition to it. */
function statusToEventType(status: ShipmentStatus): ShipmentEventType | null {
  const map: Partial<Record<ShipmentStatus, ShipmentEventType>> = {
    LABEL_CREATED: "label_create",
    IN_TRANSIT: "ship",
    OUT_FOR_DELIVERY: "out_for_delivery",
    DELIVERED: "deliver",
    DELIVERY_EXCEPTION: "exception",
    RETURN_IN_TRANSIT: "return_ship",
    RETURNED: "return_complete",
  };
  return map[status] ?? null;
}

const createShipmentSchema = z.object({
  order_id: z.string().max(INPUT_LIMITS.shortTextChars),
  seller_id: z.string().max(INPUT_LIMITS.shortTextChars),
  buyer_id: z.string().max(INPUT_LIMITS.shortTextChars),
  carrier: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  shipment_input_due_at: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
});

const recordEventSchema = z.object({
  event_type: z.string().max(INPUT_LIMITS.shortTextChars),
  raw_status: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  payload: boundedJson(z.record(z.any()), INPUT_LIMITS.jsonPayloadBytes, "shipment event payload").optional(),
});

const webhookSchema = z.object({
  carrier: z.string().max(INPUT_LIMITS.shortTextChars),
  payload: boundedJson(z.record(z.any()), INPUT_LIMITS.jsonPayloadBytes, "carrier webhook payload"),
});

function requiresRealShippingProvider(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function realShippingUnavailable(error?: unknown) {
  return {
    error: "REAL_SHIPPING_PROVIDER_UNAVAILABLE",
    message: error instanceof Error
      ? error.message
      : "EasyPost is required for shipping in production",
  };
}

export function registerShipmentRoutes(app: FastifyInstance, db: Database) {
  const { requireShipmentOwner } = createOwnershipMiddleware(db);
  const easypostApiKey = process.env.EASYPOST_API_KEY;
  const easypostWebhookSecret = process.env.EASYPOST_WEBHOOK_SECRET;

  // Build carriers map
  const carriers: Record<string, import("@haggle/shipping-core").CarrierProvider> = {
    mock: new MockCarrierAdapter(),
  };

  if (easypostApiKey) {
    const easypost = new EasyPostCarrierAdapter({
      api_key: easypostApiKey,
      is_test: easypostApiKey.startsWith("EZTEST"),
    });
    carriers.easypost = easypost;
    carriers.usps = easypost;
    carriers.ups = easypost;
    carriers.fedex = easypost;
    carriers.dhl = easypost;
  }

  const shippingService = new ShippingService(carriers);

  /**
   * When shipment reaches DELIVERED, auto-start the buyer review period.
   * This gives the buyer 3 days to inspect the item before product payment is released.
   */
  async function autoConfirmDeliveryIfNeeded(
    shipment: import("@haggle/shipping-core").Shipment,
  ) {
    if (shipment.status !== "DELIVERED") return;
    try {
      const release = await getSettlementReleaseByOrderId(db, shipment.order_id);
      if (!release || release.product_release_status !== "PENDING_DELIVERY") return;
      const updated = confirmDelivery(release, shipment.delivered_at ?? new Date().toISOString());
      await updateSettlementReleaseRecord(db, updated);
    } catch {
      // Non-critical: don't fail the shipment update
    }
  }

  /**
   * Auto-create a dispute when the shipment SLA is violated.
   * Non-blocking: failures are silently caught so the shipment update always succeeds.
   */
  async function autoCreateDisputeOnSlaViolation(
    shipment: import("@haggle/shipping-core").Shipment,
    db: Database,
  ) {
    try {
      // Only check SLA for shipments still pending label — the SLA tracks whether
      // the seller provided shipment info within the allowed window.
      if (shipment.status !== "LABEL_PENDING") return;

      // Query the raw DB row for the shipment_input_due_at deadline.
      const row = await db.query.shipments.findFirst({
        where: (fields, ops) => ops.eq(fields.id, shipment.id),
      });
      if (!row?.shipmentInputDueAt) return;

      const dueMs = new Date(row.shipmentInputDueAt).getTime();
      const now = new Date().toISOString();

      // Simple check: if now is past the due date, SLA is violated
      if (new Date(now).getTime() <= dueMs) return;

      // Check if a dispute already exists for this order
      const existing = await getDisputeByOrderId(db, shipment.order_id);
      if (existing) return;

      // Create system-initiated dispute
      const dispute: DisputeCase = {
        id: createId("dsp"),
        order_id: shipment.order_id,
        reason_code: "SHIPMENT_SLA_MISSED",
        status: "OPEN",
        opened_by: "system",
        opened_at: now,
        evidence: [],
      };

      await createDisputeRecord(db, dispute);
      await updateCommerceOrderStatus(db, shipment.order_id, "IN_DISPUTE");
    } catch {
      // Non-critical: don't fail the shipment update
    }
  }

  async function persistShipmentUpdate(
    result: { shipment: import("@haggle/shipping-core").Shipment; trust_triggers: import("@haggle/commerce-core").TrustTriggerEvent[] },
    db: Database,
    context: { buyer_id: string; seller_id: string },
    newEvent?: import("@haggle/shipping-core").ShipmentEvent,
  ) {
    await updateShipmentRecord(db, result.shipment);
    if (newEvent) {
      await insertShipmentEvent(db, newEvent);
    }

    // Sync order status with shipment status
    if (result.shipment.status === "LABEL_CREATED" || result.shipment.status === "IN_TRANSIT") {
      await updateCommerceOrderStatus(db, result.shipment.order_id, "FULFILLMENT_ACTIVE");
    } else if (result.shipment.status === "DELIVERED") {
      await updateCommerceOrderStatus(db, result.shipment.order_id, "DELIVERED");
    }

    // Auto-start buyer review when shipment is delivered
    await autoConfirmDeliveryIfNeeded(result.shipment);
    // Auto-create dispute if SLA is violated and no dispute exists yet
    await autoCreateDisputeOnSlaViolation(result.shipment, db);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.shipment.order_id,
        buyer_id: context.buyer_id,
        seller_id: context.seller_id,
        triggers: result.trust_triggers,
      });
    }
  }

  async function persistAndRespond(
    result: { shipment: import("@haggle/shipping-core").Shipment; trust_triggers: import("@haggle/commerce-core").TrustTriggerEvent[] },
    reply: import("fastify").FastifyReply,
    db: Database,
    context: { buyer_id: string; seller_id: string },
    newEvent?: import("@haggle/shipping-core").ShipmentEvent,
  ) {
    await persistShipmentUpdate(result, db, context, newEvent);
    return reply.send(result);
  }

  // POST /shipments — create shipment for an order
  app.post("/shipments", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_SHIPMENT_REQUEST", issues: parsed.error.issues });
    }

    // Verify requester is the seller of the referenced order
    if (request.user?.role !== "admin") {
      const order = await getCommerceOrderByOrderId(db, parsed.data.order_id);
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }
      if (request.user!.id !== order.sellerId) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "Only the seller can create a shipment" });
      }
    }

    const existingShipment = await getShipmentByOrderId(db, parsed.data.order_id, "outbound");
    if (existingShipment) {
      return reply.send({ shipment: existingShipment, idempotent: true });
    }

    const shipment = await createShipmentRecord(
      db,
      parsed.data.order_id,
      parsed.data.seller_id,
      parsed.data.buyer_id,
      parsed.data.shipment_input_due_at,
    );

    return reply.code(201).send({ shipment });
  });

  // GET /shipments/:id
  app.get("/shipments/:id", { preHandler: [requireAuth, requireShipmentOwner()] }, async (request, reply) => {
    const shipment = await getShipmentById(db, (request.params as { id: string }).id);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }
    return reply.send({ shipment });
  });

  // GET /shipments/by-order/:orderId
  app.get("/shipments/by-order/:orderId", { preHandler: [requireAuth] }, async (request, reply) => {
    const shipment = await getShipmentByOrderId(db, (request.params as { orderId: string }).orderId);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }
    if (request.user?.role !== "admin") {
      const userId = request.user!.id;
      if (userId !== shipment.buyer_id && userId !== shipment.seller_id) {
        return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }
    return reply.send({ shipment });
  });

  // POST /shipments/:id/label — create shipping label (seller only)
  app.post("/shipments/:id/label", { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] }, async (request, reply) => {
    const shipment = await getShipmentById(db, (request.params as { id: string }).id);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }

    const carrier = shipment.carrier ?? (requiresRealShippingProvider() ? "easypost" : "mock");
    if (requiresRealShippingProvider() && !easypostApiKey) {
      return reply.code(503).send(realShippingUnavailable());
    }
    try {
      const result = await shippingService.createLabel({ ...shipment, carrier });
      await persistAndRespond(result, reply, db, { buyer_id: shipment.buyer_id, seller_id: shipment.seller_id });
    } catch (error) {
      return reply.code(400).send({
        error: "LABEL_CREATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /shipments/:id/prepare — seller provides from-address + parcel, gets rate quotes
  const prepareSchema = z.object({
    from_address_id: z.string().uuid().optional(),
    from_address: z.object({
      name: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street1: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
      city: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      state: z.string().min(2).max(32),
      zip: z.string().min(3).max(16),
      country: z.string().max(2).default("US"),
      phone: z.string().max(32).optional(),
    }).optional(),
    parcel: z.object({
      length_in: z.number().positive(),
      width_in: z.number().positive(),
      height_in: z.number().positive(),
      weight_oz: z.number().positive(),
    }),
  }).refine(
    (data) => (data.from_address_id != null) !== (data.from_address != null),
    { message: "Provide exactly one of from_address_id or from_address" },
  );

  app.post("/shipments/:id/prepare", { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] }, async (request, reply) => {
    const shipmentId = (request.params as { id: string }).id;
    const shipment = await getShipmentById(db, shipmentId);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }

    if (shipment.status !== "LABEL_PENDING") {
      return reply.code(400).send({ error: "INVALID_STATUS", message: "Shipment must be in LABEL_PENDING status" });
    }

    const parsed = prepareSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_PREPARE_REQUEST", issues: parsed.error.issues });
    }

    const { from_address_id, from_address: rawFromAddress, parcel } = parsed.data;

    // Resolve from_address
    let fromAddress: { name: string; street1: string; street2?: string; city: string; state: string; zip: string; country: string; phone?: string };
    if (from_address_id) {
      const savedAddr = await db.query.userSavedAddresses.findFirst({
        where: (fields, ops) => ops.and(
          ops.eq(fields.id, from_address_id),
          ops.eq(fields.userId, request.user!.id),
        ),
      });
      if (!savedAddr) {
        return reply.code(404).send({ error: "ADDRESS_NOT_FOUND", message: "Saved address not found or does not belong to you" });
      }
      fromAddress = {
        name: savedAddr.name,
        street1: savedAddr.street1,
        street2: savedAddr.street2 ?? undefined,
        city: savedAddr.city,
        state: savedAddr.state,
        zip: savedAddr.zip,
        country: savedAddr.country,
        phone: savedAddr.phone ?? undefined,
      };
    } else {
      fromAddress = rawFromAddress!;
    }

    // Save seller's from_address to order_addresses
    // Upsert: delete existing seller address for this order, then insert
    await db.delete(orderAddresses).where(
      andOp(
        eqOp(orderAddresses.orderId, shipment.order_id),
        eqOp(orderAddresses.role, "seller"),
      ),
    );
    await db.insert(orderAddresses).values({
      orderId: shipment.order_id,
      role: "seller",
      name: fromAddress.name,
      street1: fromAddress.street1,
      street2: fromAddress.street2,
      city: fromAddress.city,
      state: fromAddress.state,
      zip: fromAddress.zip,
      country: fromAddress.country,
      phone: fromAddress.phone,
    });

    // Look up buyer's address
    const buyerAddr = await db.query.orderAddresses.findFirst({
      where: (fields, ops) => ops.and(
        ops.eq(fields.orderId, shipment.order_id),
        ops.eq(fields.role, "buyer"),
      ),
    });
    if (!buyerAddr) {
      return reply.code(400).send({ error: "BUYER_ADDRESS_MISSING", message: "Buyer has not provided shipping address" });
    }

    const toAddress = {
      name: buyerAddr.name,
      street1: buyerAddr.street1,
      street2: buyerAddr.street2 ?? undefined,
      city: buyerAddr.city,
      state: buyerAddr.state,
      zip: buyerAddr.zip,
      country: buyerAddr.country,
      phone: buyerAddr.phone ?? undefined,
    };

    // Update shipment with parcel dimensions
    await db.update(shipmentsTable).set({
      parcelLengthIn: String(parcel.length_in),
      parcelWidthIn: String(parcel.width_in),
      parcelHeightIn: String(parcel.height_in),
      parcelWeightOz: String(parcel.weight_oz),
      declaredWeightOz: String(parcel.weight_oz),
      updatedAt: new Date(),
    }).where(eqOp(shipmentsTable.id, shipmentId));

    // Get rate quotes — reuse the same logic as POST /shipments/rates
    const weightBuffer = computeWeightBuffer(parcel.weight_oz);

    if (easypostApiKey) {
      try {
        const EasyPost = (await import("@easypost/api")).default;
        const client = new EasyPost(easypostApiKey);
        const epShipment = await client.Shipment.create({
          from_address: {
            name: fromAddress.name,
            street1: fromAddress.street1,
            street2: fromAddress.street2,
            city: fromAddress.city,
            state: fromAddress.state,
            zip: fromAddress.zip,
            country: fromAddress.country,
          },
          to_address: {
            name: toAddress.name,
            street1: toAddress.street1,
            street2: toAddress.street2,
            city: toAddress.city,
            state: toAddress.state,
            zip: toAddress.zip,
            country: toAddress.country,
          },
          parcel: {
            weight: parcel.weight_oz,
            length: parcel.length_in,
            width: parcel.width_in,
            height: parcel.height_in,
          },
        });

        const rates = (epShipment.rates ?? []).map((r: any) => ({
          id: r.id ?? undefined,
          carrier: r.carrier ?? "unknown",
          service: r.service ?? "unknown",
          rate: r.rate ?? "0",
          rate_minor: Math.round(parseFloat(r.rate ?? "0") * 100),
          est_delivery_days: r.est_delivery_days ?? null,
          easypost_shipment_id: epShipment.id,
        }));

        const updatedShipment = await getShipmentById(db, shipmentId);
        return reply.send({
          shipment: updatedShipment,
          rates,
          weight_buffer_minor: weightBuffer.buffer_amount_minor,
          source: "easypost",
        });
      } catch (error) {
        if (requiresRealShippingProvider()) {
          return reply.code(502).send(realShippingUnavailable(error));
        }
        console.error("EasyPost rate fetch failed in /prepare, falling back to mock rates:", error);
      }
    }

    if (requiresRealShippingProvider()) {
      return reply.code(503).send(realShippingUnavailable());
    }

    // Mock rates fallback
    const mockRates = [
      { id: "rate_mock_ground", carrier: "USPS", service: "GroundAdvantage", rate: "5.50", rate_minor: 550, est_delivery_days: 5 },
      { id: "rate_mock_priority", carrier: "USPS", service: "Priority", rate: "8.25", rate_minor: 825, est_delivery_days: 3 },
      { id: "rate_mock_express", carrier: "USPS", service: "Express", rate: "26.35", rate_minor: 2635, est_delivery_days: 1 },
      { id: "rate_mock_ups", carrier: "UPS", service: "Ground", rate: "9.50", rate_minor: 950, est_delivery_days: 5 },
      { id: "rate_mock_fedex", carrier: "FedEx", service: "Ground", rate: "9.75", rate_minor: 975, est_delivery_days: 5 },
    ];

    const updatedShipment = await getShipmentById(db, shipmentId);
    return reply.send({
      shipment: updatedShipment,
      rates: mockRates,
      weight_buffer_minor: weightBuffer.buffer_amount_minor,
      source: "mock",
    });
  });

  // POST /shipments/:id/purchase-label — seller selects a rate and purchases label
  const purchaseLabelSchema = z.object({
    rate_id: z.string().min(1, "rate_id is required").max(INPUT_LIMITS.mediumTextChars),
  });

  app.post("/shipments/:id/purchase-label", { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] }, async (request, reply) => {
    const shipmentId = (request.params as { id: string }).id;
    const shipment = await getShipmentById(db, shipmentId);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }

    if (shipment.status !== "LABEL_PENDING") {
      return reply.code(400).send({ error: "INVALID_STATUS", message: "Shipment must be in LABEL_PENDING status (label not yet created)" });
    }

    // Verify parcel dimensions exist (seller must run /prepare first)
    const shipmentRow = await db.query.shipments.findFirst({
      where: (fields, ops) => ops.eq(fields.id, shipmentId),
    });
    if (!shipmentRow?.parcelWeightOz) {
      return reply.code(400).send({ error: "PARCEL_NOT_SET", message: "Run POST /shipments/:id/prepare first to set parcel dimensions" });
    }

    const parsed = purchaseLabelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_PURCHASE_REQUEST", issues: parsed.error.issues });
    }

    const { rate_id } = parsed.data;

    // Store selected_rate_id
    await db.update(shipmentsTable).set({
      selectedRateId: rate_id,
      updatedAt: new Date(),
    }).where(eqOp(shipmentsTable.id, shipmentId));

    // If EasyPost is available and rate_id looks like an EasyPost rate, buy the label via EasyPost
    if (easypostApiKey && rate_id.startsWith("rate_") && !rate_id.startsWith("rate_mock_")) {
      try {
        const EasyPost = (await import("@easypost/api")).default;
        const client = new EasyPost(easypostApiKey);

        // Re-create the EasyPost shipment with the same addresses/parcel to buy the selected rate.
        // /prepare returns easypost_shipment_id per rate, but the spec only sends rate_id back.
        // Creating a new EP shipment with identical params is idempotent and gives us fresh rates.
        const sellerAddr = await db.query.orderAddresses.findFirst({
          where: (fields, ops) => ops.and(
            ops.eq(fields.orderId, shipment.order_id),
            ops.eq(fields.role, "seller"),
          ),
        });
        const buyerAddr = await db.query.orderAddresses.findFirst({
          where: (fields, ops) => ops.and(
            ops.eq(fields.orderId, shipment.order_id),
            ops.eq(fields.role, "buyer"),
          ),
        });

        if (!sellerAddr || !buyerAddr) {
          return reply.code(400).send({ error: "ADDRESSES_MISSING", message: "Seller or buyer address not found" });
        }

        const epShipment = await client.Shipment.create({
          from_address: {
            name: sellerAddr.name,
            street1: sellerAddr.street1,
            street2: sellerAddr.street2 ?? undefined,
            city: sellerAddr.city,
            state: sellerAddr.state,
            zip: sellerAddr.zip,
            country: sellerAddr.country,
            phone: sellerAddr.phone ?? undefined,
          },
          to_address: {
            name: buyerAddr.name,
            street1: buyerAddr.street1,
            street2: buyerAddr.street2 ?? undefined,
            city: buyerAddr.city,
            state: buyerAddr.state,
            zip: buyerAddr.zip,
            country: buyerAddr.country,
            phone: buyerAddr.phone ?? undefined,
          },
          parcel: {
            weight: parseFloat(shipmentRow.parcelWeightOz),
            length: shipmentRow.parcelLengthIn ? parseFloat(shipmentRow.parcelLengthIn) : undefined,
            width: shipmentRow.parcelWidthIn ? parseFloat(shipmentRow.parcelWidthIn) : undefined,
            height: shipmentRow.parcelHeightIn ? parseFloat(shipmentRow.parcelHeightIn) : undefined,
          },
        });

        // Find the matching rate by carrier+service from the rate_id, or just buy cheapest
        const matchingRate = epShipment.rates?.find((r: any) => r.id === rate_id);
        const rateToBuy = matchingRate ?? epShipment.lowestRate();

        const boughtShipment = await client.Shipment.buy(epShipment.id, rateToBuy);

        // Update shipment in DB
        await db.update(shipmentsTable).set({
          status: "LABEL_CREATED",
          carrier: rateToBuy.carrier ?? shipment.carrier,
          trackingNumber: boughtShipment.tracking_code ?? undefined,
          labelUrl: boughtShipment.postage_label?.label_url ?? undefined,
          rateMinor: String(Math.round(parseFloat(rateToBuy.rate ?? "0") * 100)),
          labelCreatedAt: new Date(),
          updatedAt: new Date(),
        }).where(eqOp(shipmentsTable.id, shipmentId));

        // Record shipment event for LABEL_CREATED
        await insertShipmentEvent(db, {
          id: `evt_${Date.now()}`,
          shipment_id: shipmentId,
          status: "LABEL_CREATED",
          occurred_at: new Date().toISOString(),
          carrier_raw_status: boughtShipment.status ?? "pre_transit",
          message: `Label purchased via EasyPost (${rateToBuy.carrier} ${rateToBuy.service})`,
        });

        await updateCommerceOrderStatus(db, shipment.order_id, "FULFILLMENT_ACTIVE");

        const finalShipment = await getShipmentById(db, shipmentId);
        return reply.send({
          shipment: finalShipment,
          label_url: boughtShipment.postage_label?.label_url ?? null,
          tracking_number: boughtShipment.tracking_code ?? null,
        });
      } catch (error) {
        return reply.code(400).send({
          error: "LABEL_PURCHASE_FAILED",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (requiresRealShippingProvider()) {
      return reply.code(503).send(realShippingUnavailable());
    }

    // Mock label purchase fallback
    const mockTrackingNumber = `MOCK${Date.now()}`;
    const mockLabelUrl = `https://mock-labels.example.com/${mockTrackingNumber}.pdf`;

    await db.update(shipmentsTable).set({
      status: "LABEL_CREATED",
      carrier: "mock",
      trackingNumber: mockTrackingNumber,
      labelUrl: mockLabelUrl,
      rateMinor: rate_id === "rate_mock_ground" ? "550"
        : rate_id === "rate_mock_priority" ? "825"
        : rate_id === "rate_mock_express" ? "2635"
        : rate_id === "rate_mock_ups" ? "950"
        : rate_id === "rate_mock_fedex" ? "975"
        : "550",
      labelCreatedAt: new Date(),
      updatedAt: new Date(),
    }).where(eqOp(shipmentsTable.id, shipmentId));

    // Record shipment event for LABEL_CREATED
    await insertShipmentEvent(db, {
      id: `evt_${Date.now()}`,
      shipment_id: shipmentId,
      status: "LABEL_CREATED",
      occurred_at: new Date().toISOString(),
      carrier_raw_status: "pre_transit",
      message: "Label purchased (mock)",
    });

    // Sync order status
    await updateCommerceOrderStatus(db, shipment.order_id, "FULFILLMENT_ACTIVE");

    const finalShipment = await getShipmentById(db, shipmentId);
    return reply.send({
      shipment: finalShipment,
      label_url: mockLabelUrl,
      tracking_number: mockTrackingNumber,
    });
  });

  // POST /shipments/:id/return-label — buyer creates return label after dispute buyer_favor
  app.post("/shipments/:id/return-label", { preHandler: [requireAuth, requireShipmentOwner({ role: "buyer" })] }, async (request, reply) => {
    const shipmentId = (request.params as { id: string }).id;
    const shipment = await getShipmentById(db, shipmentId);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }

    // Validate: dispute for this order exists and outcome is buyer_favor
    const dispute = await getDisputeByOrderId(db, shipment.order_id);
    if (!dispute) {
      return reply.code(400).send({ error: "NO_DISPUTE", message: "No dispute found for this order" });
    }

    // Check resolution outcome from dispute_resolutions table
    const resolutionRow = await db.query.disputeResolutions.findFirst({
      where: (fields, ops) => ops.eq(fields.disputeId, dispute.id),
      orderBy: (fields, { desc: descFn }) => [descFn(fields.createdAt)],
    });
    if (!resolutionRow || resolutionRow.outcome !== "buyer_favor") {
      return reply.code(400).send({
        error: "DISPUTE_NOT_BUYER_FAVOR",
        message: "Return label can only be created when dispute outcome is buyer_favor",
      });
    }

    // Look up addresses from order_addresses
    const buyerAddr = await db.query.orderAddresses.findFirst({
      where: (fields, ops) => ops.and(
        ops.eq(fields.orderId, shipment.order_id),
        ops.eq(fields.role, "buyer"),
      ),
    });
    const sellerAddr = await db.query.orderAddresses.findFirst({
      where: (fields, ops) => ops.and(
        ops.eq(fields.orderId, shipment.order_id),
        ops.eq(fields.role, "seller"),
      ),
    });

    if (!buyerAddr) {
      return reply.code(400).send({ error: "BUYER_ADDRESS_MISSING", message: "Buyer address not found" });
    }
    if (!sellerAddr) {
      return reply.code(400).send({ error: "SELLER_ADDRESS_MISSING", message: "Seller address not found" });
    }

    const existingReturnShipment = await getShipmentByOrderId(db, shipment.order_id, "return");
    if (existingReturnShipment && existingReturnShipment.status !== "LABEL_PENDING") {
      return reply.send({
        shipment: existingReturnShipment,
        label_url: null,
        tracking_number: existingReturnShipment.tracking_number ?? null,
        idempotent: true,
      });
    }

    // Create or reuse the return shipment record. Reusing a pending row lets a
    // failed label attempt retry without creating duplicate return shipments.
    const returnShipmentRow = existingReturnShipment ?? await createShipmentRecord(
      db,
      shipment.order_id,
      shipment.seller_id,
      shipment.buyer_id,
      undefined,
      { shipmentType: "return" },
    );

    // Attempt to create a return label via carrier
    const fromAddress = {
      name: buyerAddr.name,
      street1: buyerAddr.street1,
      street2: buyerAddr.street2 ?? undefined,
      city: buyerAddr.city,
      state: buyerAddr.state,
      zip: buyerAddr.zip,
      country: buyerAddr.country,
      phone: buyerAddr.phone ?? undefined,
    };
    const toAddress = {
      name: sellerAddr.name,
      street1: sellerAddr.street1,
      street2: sellerAddr.street2 ?? undefined,
      city: sellerAddr.city,
      state: sellerAddr.state,
      zip: sellerAddr.zip,
      country: sellerAddr.country,
      phone: sellerAddr.phone ?? undefined,
    };

    // Use parcel info from the original shipment if available
    const originalRow = await db.query.shipments.findFirst({
      where: (fields, ops) => ops.eq(fields.id, shipmentId),
    });

    let labelUrl: string | null = null;
    let trackingNumber: string | null = null;

    if (easypostApiKey && originalRow?.parcelWeightOz) {
      try {
        const EasyPost = (await import("@easypost/api")).default;
        const client = new EasyPost(easypostApiKey);
        const epShipment = await client.Shipment.create({
          from_address: {
            name: fromAddress.name,
            street1: fromAddress.street1,
            street2: fromAddress.street2,
            city: fromAddress.city,
            state: fromAddress.state,
            zip: fromAddress.zip,
            country: fromAddress.country,
          },
          to_address: {
            name: toAddress.name,
            street1: toAddress.street1,
            street2: toAddress.street2,
            city: toAddress.city,
            state: toAddress.state,
            zip: toAddress.zip,
            country: toAddress.country,
          },
          parcel: {
            weight: parseFloat(originalRow.parcelWeightOz),
            length: originalRow.parcelLengthIn ? parseFloat(originalRow.parcelLengthIn) : undefined,
            width: originalRow.parcelWidthIn ? parseFloat(originalRow.parcelWidthIn) : undefined,
            height: originalRow.parcelHeightIn ? parseFloat(originalRow.parcelHeightIn) : undefined,
          },
          is_return: true,
        });

        const lowestRate = epShipment.lowestRate();
        const boughtShipment = await client.Shipment.buy(epShipment.id, lowestRate);

        trackingNumber = boughtShipment.tracking_code ?? null;
        labelUrl = boughtShipment.postage_label?.label_url ?? null;

        await db.update(shipmentsTable).set({
          status: "LABEL_CREATED",
          carrier: lowestRate.carrier ?? "USPS",
          trackingNumber: trackingNumber ?? undefined,
          labelUrl: labelUrl ?? undefined,
          rateMinor: String(Math.round(parseFloat(lowestRate.rate ?? "0") * 100)),
          labelCreatedAt: new Date(),
          updatedAt: new Date(),
        }).where(eqOp(shipmentsTable.id, returnShipmentRow.id));
      } catch (error) {
        if (requiresRealShippingProvider()) {
          return reply.code(502).send(realShippingUnavailable(error));
        }
        console.error("EasyPost return label creation failed, falling back to mock:", error);
      }
    }

    // Mock fallback
    if (!trackingNumber) {
      if (requiresRealShippingProvider()) {
        return reply.code(503).send(realShippingUnavailable());
      }

      const mockTracking = `RET${Date.now()}`;
      const mockLabel = `https://mock-labels.example.com/${mockTracking}.pdf`;

      trackingNumber = mockTracking;
      labelUrl = mockLabel;

      await db.update(shipmentsTable).set({
        status: "LABEL_CREATED",
        carrier: "mock",
        trackingNumber: mockTracking,
        labelUrl: mockLabel,
        rateMinor: "550",
        labelCreatedAt: new Date(),
        updatedAt: new Date(),
      }).where(eqOp(shipmentsTable.id, returnShipmentRow.id));
    }

    // Record event
    await insertShipmentEvent(db, {
      id: `evt_${Date.now()}`,
      shipment_id: returnShipmentRow.id,
      status: "LABEL_CREATED",
      occurred_at: new Date().toISOString(),
      carrier_raw_status: "pre_transit",
      message: "Return label created",
    });

    const finalShipment = await getShipmentById(db, returnShipmentRow.id);
    return reply.code(201).send({
      shipment: finalShipment,
      label_url: labelUrl,
      tracking_number: trackingNumber,
    });
  });

  // POST /shipments/:id/event — record a shipment event (seller only)
  app.post("/shipments/:id/event", { preHandler: [requireAuth, requireShipmentOwner({ role: "seller" })] }, async (request, reply) => {
    if (requiresRealShippingProvider() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "MANUAL_SHIPMENT_EVENTS_DISABLED",
        message: "Carrier webhooks must drive shipment status in production",
      });
    }

    const shipment = await getShipmentById(db, (request.params as { id: string }).id);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }
    const parsed = recordEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_EVENT", issues: parsed.error.issues });
    }

    try {
      const result = shippingService.recordEvent(
        shipment,
        parsed.data.event_type as Parameters<typeof transitionShipmentStatus>[1],
        parsed.data.payload as Partial<Pick<import("@haggle/shipping-core").ShipmentEvent, "carrier_raw_status" | "message" | "location">> | undefined,
      );
      const newEvent = result.shipment.events[result.shipment.events.length - 1];
      await persistAndRespond(result, reply, db, { buyer_id: shipment.buyer_id, seller_id: shipment.seller_id }, newEvent);
    } catch (error) {
      return reply.code(400).send({
        error: "EVENT_RECORD_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /shipments/:id/track — poll carrier for tracking update
  app.post("/shipments/:id/track", { preHandler: [requireAuth, requireShipmentOwner()] }, async (request, reply) => {
    const shipment = await getShipmentById(db, (request.params as { id: string }).id);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }

    try {
      const result = await shippingService.trackShipment(shipment);
      await persistAndRespond(result, reply, db, { buyer_id: shipment.buyer_id, seller_id: shipment.seller_id });
    } catch (error) {
      return reply.code(400).send({
        error: "TRACKING_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // POST /shipments/rates — get shipping rate quotes
  const rateRequestSchema = z.object({
    from_address: z.object({
      name: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street1: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
      city: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      state: z.string().min(2).max(32),
      zip: z.string().min(3).max(16),
      country: z.string().max(2).default("US"),
    }),
    to_address: z.object({
      name: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street1: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      street2: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
      city: z.string().min(1).max(INPUT_LIMITS.mediumTextChars),
      state: z.string().min(2).max(32),
      zip: z.string().min(3).max(16),
      country: z.string().max(2).default("US"),
    }),
    parcel: z.object({
      weight_oz: z.number().positive(),
      length_in: z.number().optional(),
      width_in: z.number().optional(),
      height_in: z.number().optional(),
    }),
  });

  app.post("/shipments/rates", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = rateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RATE_REQUEST", issues: parsed.error.issues });
    }

    const { from_address, to_address, parcel } = parsed.data;

    // Weight buffer calculation
    const weightBuffer = computeWeightBuffer(parcel.weight_oz);

    // Try EasyPost rate shopping if available
    if (easypostApiKey) {
      try {
        const EasyPost = (await import("@easypost/api")).default;
        const client = new EasyPost(easypostApiKey);
        const epShipment = await client.Shipment.create({
          from_address: {
            name: from_address.name,
            street1: from_address.street1,
            street2: from_address.street2,
            city: from_address.city,
            state: from_address.state,
            zip: from_address.zip,
            country: from_address.country,
          },
          to_address: {
            name: to_address.name,
            street1: to_address.street1,
            street2: to_address.street2,
            city: to_address.city,
            state: to_address.state,
            zip: to_address.zip,
            country: to_address.country,
          },
          parcel: {
            weight: parcel.weight_oz,
            length: parcel.length_in,
            width: parcel.width_in,
            height: parcel.height_in,
          },
        });

        const rates = (epShipment.rates ?? []).map((r: any) => ({
          carrier: r.carrier ?? "unknown",
          service: r.service ?? "unknown",
          rate: r.rate ?? "0",
          rate_minor: Math.round(parseFloat(r.rate ?? "0") * 100),
          est_delivery_days: r.est_delivery_days ?? null,
        }));

        return reply.send({
          rates,
          weight_buffer_minor: weightBuffer.buffer_amount_minor,
          source: "easypost",
        });
      } catch (error) {
        if (requiresRealShippingProvider()) {
          return reply.code(502).send(realShippingUnavailable(error));
        }
        console.error("EasyPost rate fetch failed, falling back to mock rates:", error);
      }
    }

    if (requiresRealShippingProvider()) {
      return reply.code(503).send(realShippingUnavailable());
    }

    // Mock rates fallback
    const mockRates = [
      { carrier: "USPS", service: "GroundAdvantage", rate: "5.50", rate_minor: 550, est_delivery_days: 5 },
      { carrier: "USPS", service: "Priority", rate: "8.25", rate_minor: 825, est_delivery_days: 3 },
      { carrier: "USPS", service: "Express", rate: "26.35", rate_minor: 2635, est_delivery_days: 1 },
      { carrier: "UPS", service: "Ground", rate: "9.50", rate_minor: 950, est_delivery_days: 5 },
      { carrier: "FedEx", service: "Ground", rate: "9.75", rate_minor: 975, est_delivery_days: 5 },
    ];

    return reply.send({
      rates: mockRates,
      weight_buffer_minor: weightBuffer.buffer_amount_minor,
      source: "mock",
    });
  });

  // POST /shipments/webhooks/easypost — receive EasyPost tracking webhook
  app.post("/shipments/webhooks/easypost", {
    config: { rawBody: true },
  }, async (request, reply) => {
    // In production, reject webhooks if secret is not configured.
    if (!easypostWebhookSecret) {
      if (process.env.NODE_ENV === "production") {
        return reply.code(401).send({ error: "EASYPOST_WEBHOOK_SECRET_NOT_CONFIGURED" });
      }
      // In development/test, skip signature verification.
    } else {
      const rawBody = (request as unknown as { rawBody?: string | Buffer }).rawBody ?? JSON.stringify(request.body);
      const isValid = verifyEasyPostWebhook(
        rawBody,
        request.headers as Record<string, string>,
        easypostWebhookSecret,
      );
      if (!isValid) {
        return reply.code(401).send({ error: "INVALID_WEBHOOK_SIGNATURE" });
      }
    }

    // Check if this is a ShipmentInvoice (APV weight adjustment) event
    const invoice = parseEasyPostInvoicePayload(request.body);
    if (invoice) {
      try {
        // Look up shipment by tracking code
        const shipmentRow = await db.query.shipments.findFirst({
          where: (fields, ops) => ops.eq(fields.trackingNumber, invoice.tracking_code),
        });

        if (!shipmentRow) {
          console.warn(`APV invoice: shipment not found for tracking_code=${invoice.tracking_code}`);
          return reply.send({ accepted: true, skipped: true, reason: "shipment not found for invoice" });
        }

        // Look up settlement release by order
        const release = await getSettlementReleaseByOrderId(db, shipmentRow.orderId);
        if (!release) {
          console.warn(`APV invoice: no settlement release for order_id=${shipmentRow.orderId}`);
          return reply.send({ accepted: true, skipped: true, reason: "settlement release not found" });
        }

        // Apply APV adjustment only if there's a positive adjustment (underpaid)
        if (invoice.adjustment_minor > 0) {
          const updated = applyApvAdjustment(release, invoice.adjustment_minor);
          await updateSettlementReleaseRecord(db, updated);
        }

        return reply.send({ accepted: true, adjustment: invoice });
      } catch (error) {
        console.error("APV invoice processing error:", error);
        return reply.send({ accepted: true, error: "invoice processing failed" });
      }
    }

    const parsed = parseEasyPostWebhookPayload(request.body);
    if (!parsed) {
      return reply.send({ accepted: true, skipped: true, reason: "not a tracker event" });
    }

    // Look up shipment by tracking number
    // In production, we'd have an index on tracking_number
    const row = await db.query.shipments.findFirst({
      where: (fields, ops) => ops.eq(fields.trackingNumber, parsed.tracking_code),
    });

    if (!row) {
      return reply.send({ accepted: true, skipped: true, reason: "shipment not found" });
    }

    const shipment = await getShipmentById(db, row.id);
    if (!shipment) {
      return reply.send({ accepted: true, skipped: true, reason: "shipment not found" });
    }

    // Record the event via shipping service
    try {
      const eventType = statusToEventType(parsed.status);
      if (!eventType) {
        return reply.send({ accepted: true, no_change: true, reason: "no matching event type" });
      }
      const result = shippingService.recordEvent(
        shipment,
        eventType,
      );
      const newEvent = result.shipment.events[result.shipment.events.length - 1];
      await persistShipmentUpdate(result, db, { buyer_id: shipment.buyer_id, seller_id: shipment.seller_id }, newEvent);
      return reply.send({
        accepted: true,
        tracking_code: parsed.tracking_code,
        new_status: result.shipment.status,
      });
    } catch {
      // State transition may fail if already in that state — that's OK
      return reply.send({ accepted: true, no_change: true });
    }
  });

  // POST /shipments/webhooks/:carrier — generic carrier webhook (fallback)
  app.post("/shipments/webhooks/:carrier", async (request, reply) => {
    if (requiresRealShippingProvider()) {
      return reply.code(404).send({ error: "CARRIER_WEBHOOK_NOT_CONFIGURED" });
    }

    const { carrier } = request.params as { carrier: string };
    return reply.send({
      accepted: true,
      carrier,
      received_at: new Date().toISOString(),
    });
  });
}
