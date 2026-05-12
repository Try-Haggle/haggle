import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const shipments = pgTable("shipments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  buyerId: uuid("buyer_id").notNull(),
  status: text("status", {
    enum: [
      "LABEL_PENDING",
      "LABEL_CREATED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "DELIVERY_EXCEPTION",
      "RETURN_IN_TRANSIT",
      "RETURNED",
    ],
  })
    .notNull()
    .default("LABEL_PENDING"),
  shipmentType: text("shipment_type").notNull().default("outbound"),
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  labelCreatedAt: timestamp("label_created_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  shipmentInputDueAt: timestamp("shipment_input_due_at", { withTimezone: true }),
  shippingFeeMinor: numeric("shipping_fee_minor", { precision: 18, scale: 0 }),
  currency: text("currency").notNull().default("USD"),
  declaredWeightOz: numeric("declared_weight_oz", { precision: 10, scale: 2 }),
  parcelLengthIn: numeric("parcel_length_in", { precision: 10, scale: 2 }),
  parcelWidthIn: numeric("parcel_width_in", { precision: 10, scale: 2 }),
  parcelHeightIn: numeric("parcel_height_in", { precision: 10, scale: 2 }),
  parcelWeightOz: numeric("parcel_weight_oz", { precision: 10, scale: 2 }),
  selectedRateId: text("selected_rate_id"),
  labelUrl: text("label_url"),
  rateMinor: numeric("rate_minor", { precision: 18, scale: 0 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentEvents = pgTable("shipment_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  shipmentId: uuid("shipment_id").notNull(),
  eventType: text("event_type").notNull(),
  rawStatus: text("raw_status"),
  canonicalStatus: text("canonical_status", {
    enum: [
      "LABEL_PENDING",
      "LABEL_CREATED",
      "IN_TRANSIT",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "DELIVERY_EXCEPTION",
      "RETURN_IN_TRANSIT",
      "RETURNED",
    ],
  }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentOperationIdempotency = pgTable(
  "shipment_operation_idempotency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    shipmentId: uuid("shipment_id"),
    requestHash: text("request_hash").notNull(),
    status: text("status", { enum: ["IN_PROGRESS", "SUCCEEDED", "FAILED"] }).notNull().default("IN_PROGRESS"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    lockedUntil: timestamp("locked_until", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '2 minutes'`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (table) => ({
    operationKeyUnique: uniqueIndex("shipment_operation_idem_operation_key_unique")
      .on(table.operation, table.idempotencyKey),
    shipmentIdx: index("shipment_operation_idem_shipment_idx").on(table.shipmentId),
    expiresAtIdx: index("shipment_operation_idem_expires_at_idx").on(table.expiresAt),
  }),
);
