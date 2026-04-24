import {
  shipments,
  shipmentEvents,
  eq,
  type Database,
} from "@haggle/db";
import type { Shipment, ShipmentStatus, ShipmentEvent } from "@haggle/shipping-core";

type ShipmentType = "outbound" | "return";

interface CreateShipmentRecordOptions {
  shipmentType?: ShipmentType;
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

/** DB row with extra fields not on the domain Shipment type. */
export interface ShipmentRow extends Shipment {
  seller_id: string;
  buyer_id: string;
  shipment_type: string;
}

function mapShipment(row: typeof shipments.$inferSelect): ShipmentRow {
  return {
    id: row.id,
    order_id: row.orderId,
    seller_id: row.sellerId,
    buyer_id: row.buyerId,
    shipment_type: row.shipmentType,
    status: row.status as ShipmentStatus,
    carrier: row.carrier ?? "unknown",
    tracking_number: row.trackingNumber ?? undefined,
    delivered_at: toIso(row.deliveredAt),
    events: [],
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === "23505" || isUniqueViolation(cause);
}

async function findShipmentByOrderIdAndType(
  db: Database,
  orderId: string,
  shipmentType: ShipmentType,
): Promise<ShipmentRow | null> {
  const row = await db.query.shipments.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.orderId, orderId),
      ops.eq(fields.shipmentType, shipmentType),
    ),
  });
  return row ? mapShipment(row) : null;
}

export async function createShipmentRecord(
  db: Database,
  orderId: string,
  sellerId: string,
  buyerId: string,
  shipmentInputDueAt?: string,
  options: CreateShipmentRecordOptions = {},
): Promise<ShipmentRow> {
  const shipmentType = options.shipmentType ?? "outbound";

  if (shipmentType === "outbound") {
    const existing = await findShipmentByOrderIdAndType(db, orderId, shipmentType);
    if (existing) return existing;
  }

  try {
    const [row] = await db
      .insert(shipments)
      .values({
        orderId,
        sellerId,
        buyerId,
        shipmentType,
        status: "LABEL_PENDING",
        shipmentInputDueAt: shipmentInputDueAt ? new Date(shipmentInputDueAt) : undefined,
      })
      .returning();
    return mapShipment(row);
  } catch (error) {
    if (shipmentType === "outbound" && isUniqueViolation(error)) {
      const existing = await findShipmentByOrderIdAndType(db, orderId, shipmentType);
      if (existing) return existing;
    }
    throw error;
  }
}

export async function getShipmentById(db: Database, id: string): Promise<ShipmentRow | null> {
  const row = await db.query.shipments.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  if (!row) return null;

  const events = await db.query.shipmentEvents.findMany({
    where: (fields, ops) => ops.eq(fields.shipmentId, id),
    orderBy: (fields, { asc }) => [asc(fields.occurredAt)],
  });

  const shipment = mapShipment(row);
  shipment.events = events.map((e) => ({
    id: e.id,
    shipment_id: e.shipmentId,
    status: e.canonicalStatus as ShipmentStatus,
    occurred_at: e.occurredAt.toISOString(),
    carrier_raw_status: e.rawStatus ?? undefined,
  }));
  return shipment;
}

export async function getShipmentByOrderId(
  db: Database,
  orderId: string,
  shipmentType: ShipmentType = "outbound",
): Promise<ShipmentRow | null> {
  const row = await db.query.shipments.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.orderId, orderId),
      ops.eq(fields.shipmentType, shipmentType),
    ),
  });
  if (!row) return null;
  return getShipmentById(db, row.id);
}

export async function updateShipmentRecord(
  db: Database,
  shipment: Shipment,
): Promise<void> {
  await db
    .update(shipments)
    .set({
      status: shipment.status,
      carrier: shipment.carrier,
      trackingNumber: shipment.tracking_number,
      deliveredAt: shipment.delivered_at ? new Date(shipment.delivered_at) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(shipments.id, shipment.id));
}

export async function insertShipmentEvent(
  db: Database,
  event: ShipmentEvent,
): Promise<void> {
  await db.insert(shipmentEvents).values({
    shipmentId: event.shipment_id,
    eventType: event.status,
    rawStatus: event.carrier_raw_status,
    canonicalStatus: event.status,
    occurredAt: new Date(event.occurred_at),
  });
}
