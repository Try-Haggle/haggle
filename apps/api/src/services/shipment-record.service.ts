import {
  shipments,
  shipmentEvents,
  shipmentOperationIdempotency,
  and,
  eq,
  isNull,
  sql,
  type Database,
} from "@haggle/db";
import { createHash, randomUUID } from "node:crypto";
import {
  resolveCarrierEventOrdering,
  type CarrierEventDisposition,
  type Shipment,
  type ShipmentStatus,
  type ShipmentEvent,
} from "@haggle/shipping-core";

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

function getStringMetadataValue(metadata: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapShipment(row: typeof shipments.$inferSelect): ShipmentRow {
  const metadata = row.metadata ?? undefined;
  const labelQrCodeUrl = getStringMetadataValue(metadata, "label_qr_code_url");

  return {
    id: row.id,
    order_id: row.orderId,
    seller_id: row.sellerId,
    buyer_id: row.buyerId,
    shipment_type: row.shipmentType,
    status: row.status as ShipmentStatus,
    carrier: row.carrier ?? "unknown",
    tracking_number: row.trackingNumber ?? undefined,
    label_url: row.labelUrl ?? undefined,
    label_qr_code_url: labelQrCodeUrl,
    label_qr_code_available: Boolean(labelQrCodeUrl),
    label_refund_status: row.labelRefundStatus,
    label_refund_requested_at: toIso(row.labelRefundRequestedAt),
    label_refund_updated_at: toIso(row.labelRefundUpdatedAt),
    metadata,
    delivered_at: toIso(row.deliveredAt),
    last_carrier_event_at: toIso(row.lastCarrierEventAt),
    last_carrier_event_key: row.lastCarrierEventKey ?? undefined,
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
    orderBy: (fields, { asc }) => [asc(fields.occurredAt), asc(fields.id)],
  });

  const shipment = mapShipment(row);
  shipment.events = events.map((e) => ({
    id: e.id,
    shipment_id: e.shipmentId,
    status: e.canonicalStatus as ShipmentStatus,
    occurred_at: e.occurredAt.toISOString(),
    carrier_raw_status: e.rawStatus ?? undefined,
    state_changed: typeof e.payload?.state_changed === "boolean" ? e.payload.state_changed : undefined,
    ordering_disposition: typeof e.payload?.ordering_disposition === "string" ? e.payload.ordering_disposition : undefined,
    provider_event_key: typeof e.payload?.provider_event_key === "string" ? e.payload.provider_event_key : undefined,
    message: typeof e.payload?.message === "string" ? e.payload.message : undefined,
    location: typeof e.payload?.location === "string" ? e.payload.location : undefined,
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

export async function getShipmentByTrackingNumber(
  db: Database,
  trackingNumber: string,
): Promise<ShipmentRow | null> {
  const row = await db.query.shipments.findFirst({
    where: (fields, ops) => ops.eq(fields.trackingNumber, trackingNumber),
  });
  return row ? getShipmentById(db, row.id) : null;
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
  const insertResult = db.insert(shipmentEvents).values({
    shipmentId: event.shipment_id,
    eventType: event.status,
    rawStatus: event.carrier_raw_status,
    canonicalStatus: event.status,
    payload: {
      state_changed: event.state_changed ?? null,
      ordering_disposition: event.ordering_disposition ?? null,
      provider_event_key: event.provider_event_key ?? null,
      message: event.message ?? null,
      location: event.location ?? null,
    },
    occurredAt: new Date(event.occurred_at),
  });
  if (
    insertResult
    && typeof insertResult === "object"
    && "onConflictDoNothing" in insertResult
    && typeof insertResult.onConflictDoNothing === "function"
  ) {
    await insertResult.onConflictDoNothing();
    return;
  }
  await insertResult;
}

function deterministicCarrierEventId(shipmentId: string, eventKey: string): string {
  const hex = createHash("sha256").update(`${shipmentId}:${eventKey}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface ApplyCarrierShipmentEventResult {
  shipment: ShipmentRow;
  event: ShipmentEvent;
  disposition: CarrierEventDisposition;
  stateChanged: boolean;
  effectsRequired: boolean;
}

export async function applyCarrierShipmentEvent(
  db: Database,
  input: {
    shipmentId: string;
    eventKey: string;
    incomingStatus: ShipmentStatus;
    occurredAt: Date;
    carrierRawStatus?: string;
    message?: string;
    location?: string;
    timestampSource: "carrier" | "received_at";
  },
): Promise<ApplyCarrierShipmentEventResult | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await db.query.shipments.findFirst({
      where: (fields, ops) => ops.eq(fields.id, input.shipmentId),
    });
    if (!row) return null;

    const decision = row.labelRefundStatus === "REFUNDED"
      ? {
          disposition: "label_refunded" as const,
          nextStatus: row.status as ShipmentStatus,
          advanceWatermark: false,
          stateChanged: false,
        }
      : resolveCarrierEventOrdering({
          currentStatus: row.status as ShipmentStatus,
          incomingStatus: input.incomingStatus,
          incomingOccurredAt: input.occurredAt,
          incomingEventKey: input.eventKey,
          lastCarrierEventAt: row.lastCarrierEventAt,
          lastCarrierEventKey: row.lastCarrierEventKey,
        });
    const event: ShipmentEvent = {
      id: deterministicCarrierEventId(input.shipmentId, input.eventKey),
      shipment_id: input.shipmentId,
      status: input.incomingStatus,
      occurred_at: input.occurredAt.toISOString(),
      carrier_raw_status: input.carrierRawStatus,
      message: input.message,
      location: input.location,
      state_changed: decision.stateChanged,
      ordering_disposition: decision.disposition,
      provider_event_key: input.eventKey,
    };

    if (decision.disposition === "replay_applied") {
      await insertShipmentEvent(db, event);
      const shipment = await getShipmentById(db, input.shipmentId);
      return shipment ? { shipment, event, disposition: decision.disposition, stateChanged: false, effectsRequired: true } : null;
    }

    if (!decision.advanceWatermark) {
      await insertShipmentEvent(db, event);
      const shipment = await getShipmentById(db, input.shipmentId);
      return shipment ? { shipment, event, disposition: decision.disposition, stateChanged: false, effectsRequired: false } : null;
    }

    const watermarkGuard = row.lastCarrierEventAt
      ? and(
          eq(shipments.lastCarrierEventAt, row.lastCarrierEventAt),
          row.lastCarrierEventKey
            ? eq(shipments.lastCarrierEventKey, row.lastCarrierEventKey)
            : isNull(shipments.lastCarrierEventKey),
        )
      : and(isNull(shipments.lastCarrierEventAt), isNull(shipments.lastCarrierEventKey));
    const updated = await db.update(shipments).set({
      status: decision.nextStatus,
      deliveredAt: decision.stateChanged && decision.nextStatus === "DELIVERED"
        ? input.occurredAt
        : row.deliveredAt,
      lastCarrierEventAt: input.occurredAt,
      lastCarrierEventKey: input.eventKey,
      metadata: {
        ...(row.metadata ?? {}),
        last_carrier_timestamp_source: input.timestampSource,
        last_carrier_event_disposition: decision.disposition,
      },
      updatedAt: new Date(),
    }).where(and(
      eq(shipments.id, input.shipmentId),
      eq(shipments.status, row.status),
      watermarkGuard,
    )).returning({ id: shipments.id });
    if (!updated.length) continue;

    await insertShipmentEvent(db, event);
    const shipment = await getShipmentById(db, input.shipmentId);
    return shipment ? {
      shipment,
      event,
      disposition: decision.disposition,
      stateChanged: decision.stateChanged,
      effectsRequired: decision.stateChanged,
    } : null;
  }
  throw new Error("SHIPMENT_CARRIER_EVENT_CONCURRENCY_RETRY_EXHAUSTED");
}

export type ShipmentLabelRefundStatus = "NONE" | "REQUESTING" | "SUBMITTED" | "REFUNDED" | "REJECTED" | "NOT_APPLICABLE" | "FAILED";

export type ShipmentLabelRefundClaim =
  | { outcome: "acquired"; shipmentId: string; claimId: string; attemptCount: number }
  | { outcome: "in_progress" | "already_submitted" | "already_refunded" | "not_applicable" | "invalid_status"; shipmentId: string };

export function normalizeProviderLabelRefundStatus(value: unknown): Exclude<ShipmentLabelRefundStatus, "NONE" | "REQUESTING" | "FAILED"> | null {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "submitted": return "SUBMITTED";
    case "refunded": return "REFUNDED";
    case "rejected": return "REJECTED";
    case "not_applicable": return "NOT_APPLICABLE";
    default: return null;
  }
}

export async function claimShipmentLabelRefund(db: Database, shipmentId: string): Promise<ShipmentLabelRefundClaim> {
  const claimId = randomUUID();
  const acquired = await db.execute(sql`
    UPDATE shipments
       SET label_refund_status = 'REQUESTING',
           label_refund_claim_id = ${claimId},
           label_refund_lease_expires_at = now() + interval '2 minutes',
           label_refund_attempt_count = label_refund_attempt_count + 1,
           label_refund_requested_at = coalesce(label_refund_requested_at, now()),
           label_refund_updated_at = now(),
           updated_at = now()
     WHERE id = ${shipmentId}
       AND status = 'LABEL_CREATED'
       AND (
         label_refund_status IN ('NONE', 'FAILED', 'REJECTED')
         OR (label_refund_status = 'REQUESTING' AND label_refund_lease_expires_at <= now())
       )
     RETURNING label_refund_claim_id AS "claimId", label_refund_attempt_count AS "attemptCount"
  `) as unknown as Array<{ claimId: string; attemptCount: number | string }>;
  if (acquired[0]) {
    return {
      outcome: "acquired",
      shipmentId,
      claimId: acquired[0].claimId,
      attemptCount: Number(acquired[0].attemptCount),
    };
  }
  const existing = await db.execute(sql`
    SELECT status, label_refund_status AS "refundStatus"
      FROM shipments
     WHERE id = ${shipmentId}
     LIMIT 1
  `) as unknown as Array<{ status: string; refundStatus: ShipmentLabelRefundStatus }>;
  const current = existing[0];
  if (!current || current.status !== "LABEL_CREATED") return { outcome: "invalid_status", shipmentId };
  if (current.refundStatus === "REQUESTING") return { outcome: "in_progress", shipmentId };
  if (current.refundStatus === "SUBMITTED") return { outcome: "already_submitted", shipmentId };
  if (current.refundStatus === "REFUNDED") return { outcome: "already_refunded", shipmentId };
  if (current.refundStatus === "NOT_APPLICABLE") return { outcome: "not_applicable", shipmentId };
  return { outcome: "invalid_status", shipmentId };
}

export async function completeShipmentLabelRefund(
  db: Database,
  claim: Extract<ShipmentLabelRefundClaim, { outcome: "acquired" }>,
  providerStatus: Exclude<ShipmentLabelRefundStatus, "NONE" | "REQUESTING" | "FAILED">,
  providerShipmentId: string,
): Promise<boolean> {
  const metadata = JSON.stringify({
    label_refund_provider: "easypost",
    label_refund_provider_shipment_id: providerShipmentId,
    label_refund_provider_status: providerStatus.toLowerCase(),
  });
  const rows = await db.execute(sql`
    UPDATE shipments
       SET label_refund_status = ${providerStatus},
           label_refund_claim_id = NULL,
           label_refund_lease_expires_at = NULL,
           label_refund_updated_at = now(),
           status = CASE WHEN ${providerStatus} = 'REFUNDED' THEN 'LABEL_PENDING' ELSE status END,
           tracking_number = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE tracking_number END,
           label_url = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE label_url END,
           selected_rate_id = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE selected_rate_id END,
           rate_minor = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE rate_minor END,
           label_created_at = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE label_created_at END,
           last_carrier_event_at = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE last_carrier_event_at END,
           last_carrier_event_key = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE last_carrier_event_key END,
           metadata = coalesce(metadata, '{}'::jsonb) || ${metadata}::jsonb,
           updated_at = now()
     WHERE id = ${claim.shipmentId}
       AND label_refund_status = 'REQUESTING'
       AND label_refund_claim_id = ${claim.claimId}
     RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length === 1;
}

export async function failShipmentLabelRefund(
  db: Database,
  claim: Extract<ShipmentLabelRefundClaim, { outcome: "acquired" }>,
): Promise<void> {
  await db.execute(sql`
    UPDATE shipments
       SET label_refund_status = 'FAILED',
           label_refund_claim_id = NULL,
           label_refund_lease_expires_at = NULL,
           label_refund_updated_at = now(),
           updated_at = now()
     WHERE id = ${claim.shipmentId}
       AND label_refund_status = 'REQUESTING'
       AND label_refund_claim_id = ${claim.claimId}
  `);
}

export async function syncSubmittedShipmentLabelRefund(
  db: Database,
  shipmentId: string,
  providerStatus: Exclude<ShipmentLabelRefundStatus, "NONE" | "REQUESTING" | "FAILED">,
  providerShipmentId: string,
): Promise<boolean> {
  const metadata = JSON.stringify({
    label_refund_provider: "easypost",
    label_refund_provider_shipment_id: providerShipmentId,
    label_refund_provider_status: providerStatus.toLowerCase(),
  });
  const rows = await db.execute(sql`
    UPDATE shipments
       SET label_refund_status = ${providerStatus},
           label_refund_updated_at = now(),
           status = CASE WHEN ${providerStatus} = 'REFUNDED' THEN 'LABEL_PENDING' ELSE status END,
           tracking_number = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE tracking_number END,
           label_url = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE label_url END,
           selected_rate_id = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE selected_rate_id END,
           rate_minor = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE rate_minor END,
           label_created_at = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE label_created_at END,
           last_carrier_event_at = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE last_carrier_event_at END,
           last_carrier_event_key = CASE WHEN ${providerStatus} = 'REFUNDED' THEN NULL ELSE last_carrier_event_key END,
           metadata = coalesce(metadata, '{}'::jsonb) || ${metadata}::jsonb,
           updated_at = now()
     WHERE id = ${shipmentId}
       AND label_refund_status IN ('SUBMITTED', 'REJECTED', 'NOT_APPLICABLE', 'REFUNDED')
     RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length === 1;
}

export async function getShipmentOperationIdempotencyRecord(
  db: Database,
  operation: string,
  idempotencyKey: string,
): Promise<typeof shipmentOperationIdempotency.$inferSelect | null> {
  const row = await db.query.shipmentOperationIdempotency.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.operation, operation),
      ops.eq(fields.idempotencyKey, idempotencyKey),
    ),
  });
  return row ?? null;
}

export async function createShipmentOperationInProgress(
  db: Database,
  input: {
    operation: string;
    idempotencyKey: string;
    shipmentId?: string | null;
    requestHash: string;
  },
): Promise<typeof shipmentOperationIdempotency.$inferSelect | null> {
  const [row] = await db
    .insert(shipmentOperationIdempotency)
    .values({
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      shipmentId: input.shipmentId ?? null,
      requestHash: input.requestHash,
      status: "IN_PROGRESS",
      lockedUntil: new Date(Date.now() + 2 * 60 * 1000),
    })
    .onConflictDoNothing({
      target: [shipmentOperationIdempotency.operation, shipmentOperationIdempotency.idempotencyKey],
    })
    .returning();
  return row ?? null;
}

export async function completeShipmentOperationIdempotency(
  db: Database,
  operation: string,
  idempotencyKey: string,
  input: {
    status: "SUCCEEDED" | "FAILED";
    responseStatus: number;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .update(shipmentOperationIdempotency)
    .set({
      status: input.status,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      updatedAt: new Date(),
    })
    .where(and(
      eq(shipmentOperationIdempotency.operation, operation),
      eq(shipmentOperationIdempotency.idempotencyKey, idempotencyKey),
    ));
}
