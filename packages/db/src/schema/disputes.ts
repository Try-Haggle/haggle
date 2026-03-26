import { jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const disputeCases = pgTable("dispute_cases", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  reasonCode: text("reason_code").notNull(),
  status: text("status", {
    enum: [
      "OPEN",
      "UNDER_REVIEW",
      "WAITING_FOR_BUYER",
      "WAITING_FOR_SELLER",
      "RESOLVED_BUYER_FAVOR",
      "RESOLVED_SELLER_FAVOR",
      "PARTIAL_REFUND",
      "CLOSED",
    ],
  })
    .notNull()
    .default("OPEN"),
  openedBy: text("opened_by", { enum: ["buyer", "seller", "system"] }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolutionSummary: text("resolution_summary"),
  refundAmountMinor: numeric("refund_amount_minor", { precision: 18, scale: 0 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputeEvidence = pgTable("dispute_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").notNull(),
  submittedBy: text("submitted_by", { enum: ["buyer", "seller", "system"] }).notNull(),
  type: text("type", { enum: ["text", "image", "tracking_snapshot", "payment_proof", "other"] }).notNull(),
  uri: text("uri"),
  text: text("text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const disputeResolutions = pgTable("dispute_resolutions", {
  id: uuid("id").defaultRandom().primaryKey(),
  disputeId: uuid("dispute_id").notNull(),
  outcome: text("outcome", {
    enum: ["buyer_favor", "seller_favor", "partial_refund", "no_action"],
  }).notNull(),
  summary: text("summary").notNull(),
  refundAmountMinor: numeric("refund_amount_minor", { precision: 18, scale: 0 }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
