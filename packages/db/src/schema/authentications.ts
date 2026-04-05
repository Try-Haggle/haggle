import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const authentications = pgTable("authentications", {
  id: uuid("id").defaultRandom().primaryKey(),
  listingId: uuid("listing_id").notNull(),
  orderId: uuid("order_id"),
  disputeId: uuid("dispute_id"),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  turnaround: text("turnaround", {
    enum: ["ultra_fast", "fast", "standard"],
  })
    .notNull()
    .default("standard"),
  status: text("status", {
    enum: [
      "REQUESTED",
      "SUBMITTED",
      "IN_PROGRESS",
      "PASSED",
      "FAILED",
      "INCONCLUSIVE",
      "CANCELLED",
    ],
  })
    .notNull()
    .default("REQUESTED"),
  verdict: text("verdict"),
  certificateUrl: text("certificate_url"),
  requestedBy: text("requested_by", { enum: ["buyer", "seller"] }).notNull(),
  costMinor: text("cost_minor").notNull(),
  caseId: text("case_id"),
  intentId: text("intent_id"),
  submissionUrl: text("submission_url"),
  publishPolicy: text("publish_policy", {
    enum: ["wait_for_auth", "publish_immediately"],
  })
    .notNull()
    .default("publish_immediately"),
  autoApplyResult: boolean("auto_apply_result").notNull().default(true),
  resultApplied: boolean("result_applied").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authenticationEvents = pgTable("authentication_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  authenticationId: uuid("authentication_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status", {
    enum: [
      "REQUESTED",
      "SUBMITTED",
      "IN_PROGRESS",
      "PASSED",
      "FAILED",
      "INCONCLUSIVE",
      "CANCELLED",
    ],
  }).notNull(),
  verdict: text("verdict"),
  certificateUrl: text("certificate_url"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
