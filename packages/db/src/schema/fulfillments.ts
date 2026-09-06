import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { commerceOrders } from "./commerce-orders.js";

/**
 * Phase1 no-shipping fulfillment record.
 * Physical shipping continues to use `shipments`; digital/local/onchain/external
 * paths create a fulfillment row instead of a fake shipment.
 */
export const fulfillments = pgTable(
  "fulfillments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    paymentIntentId: uuid("payment_intent_id"),
    fulfillmentType: text("fulfillment_type", {
      enum: [
        "physical_shipping",
        "shipped",
        "local_pickup",
        "digital_delivery",
        "external_platform_transfer",
        "onchain_transfer",
      ],
    }).notNull(),
    status: text("status", {
      enum: [
        "AWAITING_SELLER_ACTION",
        "PROOF_SUBMITTED",
        "AWAITING_BUYER_CONFIRMATION",
        "FULFILLED",
        "DISPUTED",
        "CANCELED",
      ],
    })
      .notNull()
      .default("AWAITING_SELLER_ACTION"),
    proofRequired: boolean("proof_required").notNull().default(true),
    proofStatus: text("proof_status", {
      enum: ["PENDING", "SUBMITTED", "VERIFIED", "REJECTED", "NOT_REQUIRED"],
    })
      .notNull()
      .default("PENDING"),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    reviewWindowHours: integer("review_window_hours").notNull().default(24),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orderFk: foreignKey({
      name: "fulfillments_order_id_fkey",
      columns: [table.orderId],
      foreignColumns: [commerceOrders.id],
    }),
    orderUnique: uniqueIndex("uq_fulfillments_order_id").on(table.orderId),
    paymentIntentIdx: index("fulfillments_payment_intent_idx").on(table.paymentIntentId),
    typeIdx: index("fulfillments_type_idx").on(table.fulfillmentType),
  }),
);
