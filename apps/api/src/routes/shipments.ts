import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@haggle/db";
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
import type { ShipmentStatus } from "@haggle/shipping-core";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import { updateCommerceOrderStatus } from "../services/payment-record.service.js";

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
  order_id: z.string(),
  seller_id: z.string(),
  buyer_id: z.string(),
  carrier: z.string().optional(),
  shipment_input_due_at: z.string().optional(),
});

const recordEventSchema = z.object({
  event_type: z.string(),
  raw_status: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

const webhookSchema = z.object({
  carrier: z.string(),
  payload: z.record(z.any()),
});

export function registerShipmentRoutes(app: FastifyInstance, db: Database) {
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

  async function persistAndRespond(
    result: { shipment: import("@haggle/shipping-core").Shipment; trust_triggers: import("@haggle/commerce-core").TrustTriggerEvent[] },
    reply: import("fastify").FastifyReply,
    db: Database,
    context: { buyer_id: string; seller_id: string },
    newEvent?: import("@haggle/shipping-core").ShipmentEvent,
  ) {
    await updateShipmentRecord(db, result.shipment);
    if (newEvent) {
      await insertShipmentEvent(db, newEvent);
    }

    // Sync order status with shipment status
    if (result.shipment.status === "IN_TRANSIT") {
      await updateCommerceOrderStatus(db, result.shipment.order_id, "FULFILLMENT_ACTIVE");
    } else if (result.shipment.status === "DELIVERED") {
      await updateCommerceOrderStatus(db, result.shipment.order_id, "DELIVERED");
    }

    // Auto-start buyer review when shipment is delivered
    await autoConfirmDeliveryIfNeeded(result.shipment);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.shipment.order_id,
        buyer_id: context.buyer_id,
        seller_id: context.seller_id,
        triggers: result.trust_triggers,
      });
    }
    return reply.send(result);
  }

  // POST /shipments — create shipment for an order
  app.post("/shipments", async (request, reply) => {
    const parsed = createShipmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_SHIPMENT_REQUEST", issues: parsed.error.issues });
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
  app.get("/shipments/:id", async (request, reply) => {
    const shipment = await getShipmentById(db, (request.params as { id: string }).id);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }
    return reply.send({ shipment });
  });

  // GET /shipments/by-order/:orderId
  app.get("/shipments/by-order/:orderId", async (request, reply) => {
    const shipment = await getShipmentByOrderId(db, (request.params as { orderId: string }).orderId);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }
    return reply.send({ shipment });
  });

  // POST /shipments/:id/label — create shipping label
  app.post("/shipments/:id/label", async (request, reply) => {
    const shipment = await getShipmentById(db, (request.params as { id: string }).id);
    if (!shipment) {
      return reply.code(404).send({ error: "SHIPMENT_NOT_FOUND" });
    }

    const carrier = shipment.carrier ?? "mock";
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

  // POST /shipments/:id/event — record a shipment event
  app.post("/shipments/:id/event", async (request, reply) => {
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
  app.post("/shipments/:id/track", async (request, reply) => {
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
      name: z.string(),
      street1: z.string(),
      street2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      country: z.string().default("US"),
    }),
    to_address: z.object({
      name: z.string(),
      street1: z.string(),
      street2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      country: z.string().default("US"),
    }),
    parcel: z.object({
      weight_oz: z.number().positive(),
      length_in: z.number().optional(),
      width_in: z.number().optional(),
      height_in: z.number().optional(),
    }),
  });

  app.post("/shipments/rates", async (request, reply) => {
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
        // Fall through to mock rates on EasyPost failure
        console.error("EasyPost rate fetch failed, falling back to mock rates:", error);
      }
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
    // Verify webhook signature if secret is configured
    if (easypostWebhookSecret) {
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
      await updateShipmentRecord(db, result.shipment);
      if (newEvent) {
        await insertShipmentEvent(db, newEvent);
      }
      if (result.trust_triggers.length > 0) {
        await applyTrustTriggers(db, {
          order_id: result.shipment.order_id,
          buyer_id: shipment.buyer_id,
          seller_id: shipment.seller_id,
          triggers: result.trust_triggers,
        });
      }
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
    const { carrier } = request.params as { carrier: string };
    return reply.send({
      accepted: true,
      carrier,
      received_at: new Date().toISOString(),
    });
  });
}
