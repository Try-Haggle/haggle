import { randomUUID } from "node:crypto";
import { type Database, eq, shipmentEvents, shipments } from "@haggle/db";
import { applyCarrierShipmentEvent, getShipmentById } from "./shipment-record.service.js";

export async function runShipmentOrderingChaos(db: Database) {
  const shipmentId = randomUUID();
  const startedAt = Date.now();
  const at = (offsetMs: number) => new Date(startedAt + offsetMs);
  let report: Record<string, unknown> | undefined;
  let cleanup = { shipmentRows: 0, eventRows: 0, succeeded: false };

  const order = await db.query.commerceOrders.findFirst();
  if (!order) throw new Error("SHIPMENT_ORDERING_CHAOS_REQUIRES_EXISTING_ORDER");

  await db.insert(shipments).values({
    id: shipmentId,
    orderId: order.id,
    sellerId: order.sellerId,
    buyerId: order.buyerId,
    shipmentType: "ordering_chaos",
    carrier: "easypost",
    trackingNumber: `HAGGLE_ORDERING_${shipmentId}`,
    status: "LABEL_CREATED",
    createdAt: at(-5 * 60_000),
    updatedAt: at(-5 * 60_000),
  });

  try {
    const inTransit = await applyCarrierShipmentEvent(db, {
      shipmentId,
      eventKey: `${shipmentId}:in_transit`,
      incomingStatus: "IN_TRANSIT",
      occurredAt: at(-4 * 60_000),
      carrierRawStatus: "in_transit",
      message: "Fixture accepted by carrier",
      timestampSource: "carrier",
    });
    const [delivered, outForDelivery] = await Promise.all([
      applyCarrierShipmentEvent(db, {
        shipmentId,
        eventKey: `${shipmentId}:delivered`,
        incomingStatus: "DELIVERED",
        occurredAt: at(-2 * 60_000),
        carrierRawStatus: "delivered",
        message: "Fixture delivered",
        timestampSource: "carrier",
      }),
      applyCarrierShipmentEvent(db, {
        shipmentId,
        eventKey: `${shipmentId}:out_for_delivery`,
        incomingStatus: "OUT_FOR_DELIVERY",
        occurredAt: at(-3 * 60_000),
        carrierRawStatus: "out_for_delivery",
        message: "Fixture out for delivery",
        timestampSource: "carrier",
      }),
    ]);
    const stale = await applyCarrierShipmentEvent(db, {
      shipmentId,
      eventKey: `${shipmentId}:stale`,
      incomingStatus: "IN_TRANSIT",
      occurredAt: at(-3.5 * 60_000),
      carrierRawStatus: "in_transit",
      message: "Delayed fixture scan",
      timestampSource: "carrier",
    });
    const terminal = await applyCarrierShipmentEvent(db, {
      shipmentId,
      eventKey: `${shipmentId}:terminal_regression`,
      incomingStatus: "IN_TRANSIT",
      occurredAt: at(-1 * 60_000),
      carrierRawStatus: "in_transit",
      message: "Newer but invalid scan after delivery",
      timestampSource: "carrier",
    });
    const finalShipment = await getShipmentById(db, shipmentId);
    const dispositions = finalShipment?.events.map((event) => event.ordering_disposition) ?? [];
    const checks = {
      initial_transition_applied: inTransit?.disposition === "applied",
      concurrent_updates_end_delivered: finalShipment?.status === "DELIVERED",
      delivered_event_applied:
        delivered?.disposition === "applied" || delivered?.disposition === "replay_applied",
      older_scan_not_applied: stale?.disposition === "stale" || stale?.disposition === "terminal",
      terminal_regression_blocked: terminal?.disposition === "terminal",
      ignored_events_audited: dispositions.includes("stale") && dispositions.includes("terminal"),
      carrier_delivery_time_preserved:
        finalShipment?.delivered_at === at(-2 * 60_000).toISOString(),
    };
    report = {
      pass: Object.values(checks).every(Boolean),
      checks,
      finalStatus: finalShipment?.status ?? null,
      deliveredAt: finalShipment?.delivered_at ?? null,
      concurrent: {
        delivered: delivered?.disposition ?? null,
        outForDelivery: outForDelivery?.disposition ?? null,
      },
      ignored: {
        stale: stale?.disposition ?? null,
        terminal: terminal?.disposition ?? null,
      },
      eventCount: finalShipment?.events.length ?? 0,
      recordedAt: new Date().toISOString(),
    };
  } finally {
    const deletedEvents = await db
      .delete(shipmentEvents)
      .where(eq(shipmentEvents.shipmentId, shipmentId))
      .returning({ id: shipmentEvents.id });
    const deletedShipments = await db
      .delete(shipments)
      .where(eq(shipments.id, shipmentId))
      .returning({ id: shipments.id });
    cleanup = {
      shipmentRows: deletedShipments.length,
      eventRows: deletedEvents.length,
      succeeded: deletedShipments.length === 1,
    };
  }
  return { ...report, pass: report?.pass === true && cleanup.succeeded, cleanup };
}
