import { integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const waitingIntents = pgTable("waiting_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  role: text("role", { enum: ["BUYER", "SELLER"] }).notNull(),
  category: text("category").notNull(),
  keywords: jsonb("keywords").$type<string[]>().notNull(),
  strategySnapshot: jsonb("strategy_snapshot").$type<Record<string, unknown>>().notNull(),
  minUtotal: numeric("min_u_total", { precision: 8, scale: 4 }).notNull().default("0.3"),
  maxActiveSessions: integer("max_active_sessions").notNull().default(5),
  status: text("status", { enum: ["ACTIVE", "MATCHED", "FULFILLED", "EXPIRED", "CANCELLED"] }).notNull().default("ACTIVE"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const intentMatches = pgTable("intent_matches", {
  id: uuid("id").defaultRandom().primaryKey(),
  intentId: uuid("intent_id").notNull(),
  counterpartyIntentId: uuid("counterparty_intent_id"),
  listingId: uuid("listing_id"),
  sessionId: uuid("session_id"),
  buyerUtotal: numeric("buyer_u_total", { precision: 8, scale: 4 }).notNull(),
  sellerUtotal: numeric("seller_u_total", { precision: 8, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
