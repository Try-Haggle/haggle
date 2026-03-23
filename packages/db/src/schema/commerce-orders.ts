import { boolean, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const settlementApprovals = pgTable("settlement_approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  buyerId: uuid("buyer_id").notNull(),
  approvalState: text("approval_state", {
    enum: [
      "NEGOTIATING",
      "MUTUALLY_ACCEPTABLE",
      "HELD_BY_BUYER",
      "RESERVED_PENDING_APPROVAL",
      "AWAITING_SELLER_APPROVAL",
      "APPROVED",
      "DECLINED",
      "EXPIRED",
    ],
  })
    .notNull()
    .default("NEGOTIATING"),
  sellerApprovalMode: text("seller_approval_mode", {
    enum: ["AUTO_WITHIN_POLICY", "MANUAL_CONFIRMATION"],
  }).notNull(),
  selectedPaymentRail: text("selected_payment_rail", {
    enum: ["x402", "stripe"],
  }).notNull(),
  currency: text("currency").notNull().default("USD"),
  finalAmountMinor: numeric("final_amount_minor", { precision: 18, scale: 0 }).notNull(),
  holdKind: text("hold_kind", { enum: ["SOFT_HOLD", "SELLER_RESERVED"] }),
  heldSnapshotPriceMinor: numeric("held_snapshot_price_minor", { precision: 18, scale: 0 }),
  heldSnapshotUtility: numeric("held_snapshot_utility", { precision: 8, scale: 4 }),
  heldAt: timestamp("held_at", { withTimezone: true }),
  holdReason: text("hold_reason"),
  resumeRepriceRequired: boolean("resume_reprice_required").notNull().default(true),
  reservedUntil: timestamp("reserved_until", { withTimezone: true }),
  buyerApprovedAt: timestamp("buyer_approved_at", { withTimezone: true }),
  sellerApprovedAt: timestamp("seller_approved_at", { withTimezone: true }),
  shipmentInputDueAt: timestamp("shipment_input_due_at", { withTimezone: true }),
  termsSnapshot: jsonb("terms_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commerceOrders = pgTable("commerce_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  settlementApprovalId: uuid("settlement_approval_id").notNull(),
  listingId: uuid("listing_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  buyerId: uuid("buyer_id").notNull(),
  status: text("status", {
    enum: [
      "APPROVED",
      "PAYMENT_PENDING",
      "PAID",
      "FULFILLMENT_PENDING",
      "FULFILLMENT_ACTIVE",
      "DELIVERED",
      "IN_DISPUTE",
      "REFUNDED",
      "CLOSED",
      "CANCELED",
    ],
  })
    .notNull()
    .default("APPROVED"),
  currency: text("currency").notNull().default("USD"),
  amountMinor: numeric("amount_minor", { precision: 18, scale: 0 }).notNull(),
  orderSnapshot: jsonb("order_snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
