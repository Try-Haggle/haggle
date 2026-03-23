import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const trustPenaltyRecords = pgTable("trust_penalty_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  actorRole: text("actor_role", { enum: ["buyer", "seller"] }).notNull(),
  reason: text("reason", {
    enum: [
      "BUYER_APPROVED_BUT_NOT_PAID",
      "SELLER_APPROVED_BUT_NOT_FULFILLED",
      "SHIPMENT_INFO_SLA_MISSED",
      "DISPUTE_LOSS",
    ],
  }).notNull(),
  penaltyScore: numeric("penalty_score", { precision: 8, scale: 4 }).notNull(),
  onchainReference: text("onchain_reference"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const settlementReliabilitySnapshots = pgTable("settlement_reliability_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").notNull(),
  actorRole: text("actor_role", { enum: ["buyer", "seller"] }).notNull(),
  successfulSettlements: integer("successful_settlements").notNull().default(0),
  approvalDefaults: integer("approval_defaults").notNull().default(0),
  shipmentSlaMisses: integer("shipment_sla_misses").notNull().default(0),
  disputeWins: integer("dispute_wins").notNull().default(0),
  disputeLosses: integer("dispute_losses").notNull().default(0),
  settlementReliability: numeric("settlement_reliability", { precision: 8, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const onchainTrustProfiles = pgTable("onchain_trust_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: uuid("actor_id").notNull(),
  walletAddress: text("wallet_address"),
  anchoredAt: timestamp("anchored_at", { withTimezone: true }),
  reputationScore: numeric("reputation_score", { precision: 8, scale: 4 }).notNull(),
  settlementReliability: numeric("settlement_reliability", { precision: 8, scale: 4 }).notNull(),
  successfulSettlements: integer("successful_settlements").notNull().default(0),
  approvalDefaults: integer("approval_defaults").notNull().default(0),
  shipmentSlaMisses: integer("shipment_sla_misses").notNull().default(0),
  disputeWins: integer("dispute_wins").notNull().default(0),
  disputeLosses: integer("dispute_losses").notNull().default(0),
  onchainReference: text("onchain_reference"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expertiseBadges = pgTable("expertise_badges", {
  id: uuid("id").defaultRandom().primaryKey(),
  trustProfileId: uuid("trust_profile_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  domain: text("domain", {
    enum: ["electronics", "luxury", "fashion", "collectibles", "automotive", "general"],
  }).notNull(),
  score: numeric("score", { precision: 8, scale: 4 }).notNull(),
  successfulOrders: integer("successful_orders").notNull().default(0),
  disputeWins: integer("dispute_wins").notNull().default(0),
  disputeLosses: integer("dispute_losses").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
