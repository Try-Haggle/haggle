import { numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const settlementReleases = pgTable("settlement_releases", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentIntentId: uuid("payment_intent_id").notNull(),
  orderId: uuid("order_id").notNull(),

  // Phase 1: Product payment
  productAmountMinor: numeric("product_amount_minor", { precision: 18, scale: 0 }).notNull(),
  productCurrency: text("product_currency").notNull().default("USDC"),
  productReleaseStatus: text("product_release_status", {
    enum: ["PENDING_DELIVERY", "BUYER_REVIEW", "RELEASED"],
  }).notNull().default("PENDING_DELIVERY"),
  deliveryConfirmedAt: timestamp("delivery_confirmed_at", { withTimezone: true }),
  buyerReviewDeadline: timestamp("buyer_review_deadline", { withTimezone: true }),
  productReleasedAt: timestamp("product_released_at", { withTimezone: true }),

  // Phase 2: Weight buffer
  bufferAmountMinor: numeric("buffer_amount_minor", { precision: 18, scale: 0 }).notNull().default("0"),
  bufferCurrency: text("buffer_currency").notNull().default("USDC"),
  bufferReleaseStatus: text("buffer_release_status", {
    enum: ["HELD", "ADJUSTING", "RELEASED"],
  }).notNull().default("HELD"),
  bufferReleaseDeadline: timestamp("buffer_release_deadline", { withTimezone: true }),
  apvAdjustmentMinor: numeric("apv_adjustment_minor", { precision: 18, scale: 0 }).default("0"),
  bufferFinalAmountMinor: numeric("buffer_final_amount_minor", { precision: 18, scale: 0 }),
  bufferReleasedAt: timestamp("buffer_released_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
