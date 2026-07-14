import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const agentPaymentGrants = pgTable("agent_payment_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  buyerId: uuid("buyer_id").notNull(),
  agentId: text("agent_id").notNull(),
  listingId: uuid("listing_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  orderId: uuid("order_id"),
  settlementApprovalId: uuid("settlement_approval_id"),
  maxAmountMinor: numeric("max_amount_minor", { precision: 18, scale: 0 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  asset: text("asset").notNull().default("USDC"),
  network: text("network").notNull().default("base"),
  allowedRails: text("allowed_rails").array().notNull().default(["x402", "stripe"]),
  preferredRail: text("preferred_rail", { enum: ["x402", "stripe"] })
    .notNull()
    .default("x402"),
  terms: jsonb("terms").$type<Record<string, unknown>[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  nonce: text("nonce").notNull(),
  humanConfirmationRequired: boolean("human_confirmation_required").notNull().default(true),
  legalAcknowledgements: jsonb("legal_acknowledgements")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  approvalPolicyHash: text("approval_policy_hash").notNull(),
  status: text("status", { enum: ["ACTIVE", "USED", "REVOKED", "EXPIRED"] })
    .notNull()
    .default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentIntents = pgTable("payment_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  sellerId: uuid("seller_id").notNull(),
  buyerId: uuid("buyer_id").notNull(),
  selectedRail: text("selected_rail", { enum: ["x402", "stripe"] }).notNull(),
  allowedRails: text("allowed_rails").array().notNull().default(["x402", "stripe"]),
  buyerAuthorizationMode: text("buyer_authorization_mode", {
    enum: ["human_wallet", "agent_wallet"],
  })
    .notNull()
    .default("human_wallet"),
  currency: text("currency").notNull().default("USD"),
  amountMinor: numeric("amount_minor", { precision: 18, scale: 0 }).notNull(),
  status: text("status", {
    enum: [
      "CREATED",
      "QUOTED",
      "AUTHORIZED",
      "SETTLEMENT_PENDING",
      "SETTLED",
      "FAILED",
      "CANCELED",
    ],
  })
    .notNull()
    .default("CREATED"),
  canonicalStatus: text("canonical_status", {
    enum: [
      "pending",
      "authorized",
      "captured",
      "canceled",
      "refunded",
      "partially_refunded",
      "failed",
      "disputed",
      "expired",
    ],
  })
    .notNull()
    .default("pending"),
  agentPaymentGrantId: uuid("agent_payment_grant_id"),
  approvalPolicyHash: text("approval_policy_hash"),
  agreementHash: text("agreement_hash"),
  listingHash: text("listing_hash"),
  providerContext: jsonb("provider_context").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentDisclosures = pgTable("payment_disclosures", {
  id: uuid("id").defaultRandom().primaryKey(),
  agentPaymentGrantId: uuid("agent_payment_grant_id").notNull(),
  paymentIntentId: uuid("payment_intent_id"),
  rail: text("rail", { enum: ["x402", "stripe"] }).notNull(),
  version: text("version").notNull(),
  textHash: text("text_hash").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  status: text("status", { enum: ["PENDING", "SETTLED", "FAILED"] })
    .notNull()
    .default("PENDING"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentIntentId: uuid("payment_intent_id").notNull(),
  amountMinor: numeric("amount_minor", { precision: 18, scale: 0 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  reasonCode: text("reason_code").notNull(),
  status: text("status", { enum: ["REQUESTED", "PENDING", "COMPLETED", "FAILED"] })
    .notNull()
    .default("REQUESTED"),
  providerReference: text("provider_reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const paymentOperationIdempotency = pgTable(
  "payment_operation_idempotency",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    paymentIntentId: uuid("payment_intent_id"),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (table) => ({
    operationKeyUnique: uniqueIndex("payment_operation_idem_operation_key_unique").on(
      table.operation,
      table.idempotencyKey,
    ),
    inProgressIntentUnique: uniqueIndex("payment_operation_idem_in_progress_intent_unique")
      .on(table.paymentIntentId)
      .where(
        sql`payment_intent_id is not null and response_status = 409 and response_body->>'error' = 'PAYMENT_OPERATION_IN_PROGRESS'`,
      ),
    paymentIntentIdx: index("payment_operation_idem_payment_intent_idx").on(table.paymentIntentId),
    expiresAtIdx: index("payment_operation_idem_expires_at_idx").on(table.expiresAt),
  }),
);

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
