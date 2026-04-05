import { boolean, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const paymentIntents = pgTable("payment_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  buyerId: uuid("buyer_id").notNull(),
  selectedRail: text("selected_rail", { enum: ["x402", "stripe"] }).notNull(),
  allowedRails: text("allowed_rails").array().notNull().default(["x402", "stripe"]),
  buyerAuthorizationMode: text("buyer_authorization_mode", {
    enum: ["human_wallet", "agent_wallet"],
  }).notNull().default("human_wallet"),
  currency: text("currency").notNull().default("USD"),
  amountMinor: numeric("amount_minor", { precision: 18, scale: 0 }).notNull(),
  status: text("status", {
    enum: ["CREATED", "QUOTED", "AUTHORIZED", "SETTLEMENT_PENDING", "SETTLED", "FAILED", "CANCELED"],
  })
    .notNull()
    .default("CREATED"),
  providerContext: jsonb("provider_context").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentAuthorizations = pgTable("payment_authorizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentIntentId: uuid("payment_intent_id").notNull(),
  rail: text("rail", { enum: ["x402", "stripe"] }).notNull(),
  providerReference: text("provider_reference").notNull(),
  authorizedAmountMinor: numeric("authorized_amount_minor", { precision: 18, scale: 0 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentSettlements = pgTable("payment_settlements", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentIntentId: uuid("payment_intent_id").notNull(),
  rail: text("rail", { enum: ["x402", "stripe"] }).notNull(),
  providerReference: text("provider_reference").notNull(),
  settledAmountMinor: numeric("settled_amount_minor", { precision: 18, scale: 0 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  status: text("status", { enum: ["PENDING", "SETTLED", "FAILED"] }).notNull().default("PENDING"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentIntentId: uuid("payment_intent_id").notNull(),
  amountMinor: numeric("amount_minor", { precision: 18, scale: 0 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  reasonCode: text("reason_code").notNull(),
  status: text("status", { enum: ["REQUESTED", "PENDING", "COMPLETED", "FAILED"] }).notNull().default("REQUESTED"),
  providerReference: text("provider_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentProviderCapabilities = pgTable("payment_provider_capabilities", {
  id: uuid("id").defaultRandom().primaryKey(),
  rail: text("rail", { enum: ["x402", "stripe"] }).notNull(),
  provider: text("provider").notNull(),
  supportsAuthorize: boolean("supports_authorize").notNull().default(true),
  supportsCapture: boolean("supports_capture").notNull().default(true),
  supportsRefund: boolean("supports_refund").notNull().default(true),
  preferred: boolean("preferred").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
