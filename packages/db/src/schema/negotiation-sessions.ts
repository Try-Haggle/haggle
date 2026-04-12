import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// negotiation_groups — 1:N orchestration container
// ────────────────────────────────────────────────────────────────

export const negotiationGroups = pgTable(
  "negotiation_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    topology: text("topology", { enum: ["1_BUYER_N_SELLERS", "N_BUYERS_1_SELLER"] }).notNull(),
    anchorUserId: uuid("anchor_user_id").notNull(),
    intentId: uuid("intent_id"),
    maxSessions: integer("max_sessions").notNull().default(10),
    status: text("status", { enum: ["ACTIVE", "RESOLVED", "EXPIRED", "CANCELLED"] })
      .notNull()
      .default("ACTIVE"),
    batna: numeric("batna", { precision: 18, scale: 0 }),
    bestSessionId: uuid("best_session_id"),
    version: integer("version").notNull().default(1),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_groups_anchor_status_idx").on(table.anchorUserId, table.status),
  ],
);

// ────────────────────────────────────────────────────────────────
// negotiation_sessions — individual negotiation session
// ────────────────────────────────────────────────────────────────

export const negotiationSessions = pgTable(
  "negotiation_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id"),
    intentId: uuid("intent_id"),
    listingId: uuid("listing_id").notNull(),
    strategyId: text("strategy_id").notNull(),
    role: text("role", { enum: ["BUYER", "SELLER"] }).notNull(),
    status: text("status", {
      enum: [
        "CREATED", "ACTIVE", "NEAR_DEAL", "STALLED",
        "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED", "WAITING",
      ],
    }).notNull().default("CREATED"),
    buyerId: uuid("buyer_id").notNull(),
    sellerId: uuid("seller_id").notNull(),
    counterpartyId: uuid("counterparty_id").notNull(),
    currentRound: integer("current_round").notNull().default(0),
    roundsNoConcession: integer("rounds_no_concession").notNull().default(0),
    lastOfferPriceMinor: numeric("last_offer_price_minor", { precision: 18, scale: 0 }),
    lastUtility: jsonb("last_utility").$type<{
      u_total: number;
      v_p: number;
      v_t: number;
      v_r: number;
      v_s: number;
    }>(),
    strategySnapshot: jsonb("strategy_snapshot").$type<Record<string, unknown>>().notNull(),
    version: integer("version").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // LLM negotiation engine columns (Step 57)
    phase: text("phase"),
    interventionMode: text("intervention_mode").default("FULL_AUTO"),
    buddyTone: jsonb("buddy_tone").$type<Record<string, unknown>>(),
    coachingSnapshot: jsonb("coaching_snapshot").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_sessions_group_status_idx").on(table.groupId, table.status),
    index("negotiation_sessions_buyer_status_idx").on(table.buyerId, table.status),
    index("negotiation_sessions_seller_status_idx").on(table.sellerId, table.status),
    index("negotiation_sessions_listing_idx").on(table.listingId),
  ],
);

// ────────────────────────────────────────────────────────────────
// negotiation_rounds — append-only round log
// ────────────────────────────────────────────────────────────────

export const negotiationRounds = pgTable(
  "negotiation_rounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    roundNo: integer("round_no").notNull(),
    senderRole: text("sender_role", { enum: ["BUYER", "SELLER"] }).notNull(),
    messageType: text("message_type", {
      enum: ["OFFER", "COUNTER", "ACCEPT", "REJECT", "ESCALATE"],
    }).notNull(),
    priceminor: numeric("price_minor", { precision: 18, scale: 0 }).notNull(),
    counterPriceMinor: numeric("counter_price_minor", { precision: 18, scale: 0 }),
    utility: jsonb("utility").$type<{
      u_total: number;
      v_p: number;
      v_t: number;
      v_r: number;
      v_s: number;
    }>(),
    decision: text("decision", {
      enum: ["ACCEPT", "COUNTER", "REJECT", "NEAR_DEAL", "ESCALATE"],
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key").notNull(),
    // LLM negotiation engine columns (Step 57)
    coaching: jsonb("coaching").$type<Record<string, unknown>>(),
    validation: jsonb("validation").$type<Record<string, unknown>>(),
    llmTokensUsed: integer("llm_tokens_used"),
    reasoningUsed: boolean("reasoning_used").default(false),
    message: text("message"),
    phaseAtRound: text("phase_at_round"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_rounds_session_round_idx").on(table.sessionId, table.roundNo),
    uniqueIndex("negotiation_rounds_idempotency_key_idx").on(table.idempotencyKey),
  ],
);
