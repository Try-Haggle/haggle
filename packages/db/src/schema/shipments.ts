import { jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  labelCreatedAt: timestamp("label_created_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  shipmentInputDueAt: timestamp("shipment_input_due_at", { withTimezone: true }),
  shippingFeeMinor: numeric("shipping_fee_minor", { precision: 18, scale: 0 }),
  currency: text("currency").default("USD"),
  declaredWeightOz: numeric("declared_weight_oz", { precision: 10, scale: 2 }),
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
