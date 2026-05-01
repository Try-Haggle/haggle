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

export type ConversationSignalEvidence = {
  source: "message" | "round" | "system";
  sourceKey?: string;
  messageId?: string;
  start?: number;
  end?: number;
  textHash?: string;
  rawTextAvailable?: boolean;
};

export type ConversationRawEvidenceAccessPolicy = {
  allowedPurposes: Array<"debugging" | "audit">;
  reasonRequired: boolean;
  marketUseAllowed: boolean;
  memoryUseAllowed: boolean;
  tagUseAllowed: boolean;
};

export const conversationSignalSources = pgTable(
  "conversation_signal_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceKey: text("source_key").notNull(),
    sessionId: uuid("session_id").notNull(),
    roundId: uuid("round_id"),
    roundNo: integer("round_no"),
    listingId: uuid("listing_id"),
    userId: uuid("user_id"),
    rolePerspective: text("role_perspective", {
      enum: ["BUYER", "SELLER", "SYSTEM", "UNKNOWN"],
    })
      .notNull()
      .default("UNKNOWN"),
    sourceLabel: text("source_label", { enum: ["incoming", "outgoing", "system"] }).notNull(),
    rawText: text("raw_text").notNull(),
    rawTextHash: text("raw_text_hash").notNull(),
    rawAccessPolicy: jsonb("raw_access_policy")
      .$type<ConversationRawEvidenceAccessPolicy>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_signal_sources_source_key_idx").on(table.sourceKey),
    index("conversation_signal_sources_session_idx").on(table.sessionId, table.roundNo),
    index("conversation_signal_sources_round_idx").on(table.roundId),
    index("conversation_signal_sources_hash_idx").on(table.rawTextHash),
  ],
);

export const conversationMarketSignals = pgTable(
  "conversation_market_signals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    signalKey: text("signal_key").notNull(),
    sessionId: uuid("session_id"),
    roundId: uuid("round_id"),
    roundNo: integer("round_no"),
    listingId: uuid("listing_id"),
    userId: uuid("user_id"),
    rolePerspective: text("role_perspective", {
      enum: ["BUYER", "SELLER", "SYSTEM", "UNKNOWN"],
    })
      .notNull()
      .default("UNKNOWN"),
    signalType: text("signal_type", {
      enum: [
        "product_identity",
        "product_attribute",
        "condition_claim",
        "price_anchor",
        "price_resistance",
        "deal_blocker",
        "demand_intent",
        "term_preference",
        "trust_risk",
        "market_outcome",
        "tag_candidate",
        "term_candidate",
      ],
    }).notNull(),
    entityType: text("entity_type").notNull(),
    entityValue: text("entity_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    extractionMethod: text("extraction_method", {
      enum: ["deterministic", "model_assisted", "manual", "system"],
    }).notNull(),
    privacyClass: text("privacy_class", {
      enum: ["public_market", "user_preference", "safety", "private_context"],
    }).notNull(),
    marketUsefulness: text("market_usefulness", {
      enum: ["high", "medium", "low", "none"],
    }).notNull(),
    evidence: jsonb("evidence").$type<ConversationSignalEvidence>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_market_signals_signal_key_idx").on(table.signalKey),
    index("conversation_market_signals_session_idx").on(table.sessionId, table.roundNo),
    index("conversation_market_signals_listing_type_idx").on(table.listingId, table.signalType),
    index("conversation_market_signals_user_type_idx").on(table.userId, table.signalType),
    index("conversation_market_signals_normalized_idx").on(table.signalType, table.normalizedValue),
    index("conversation_market_signals_created_idx").on(table.createdAt),
  ],
);

export const userMemoryCards = pgTable(
  "user_memory_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    cardType: text("card_type", {
      enum: ["preference", "constraint", "pricing", "style", "trust", "interest"],
    }).notNull(),
    memoryKey: text("memory_key").notNull(),
    status: text("status", {
      enum: ["ACTIVE", "STALE", "SUPPRESSED", "EXPIRED"],
    })
      .notNull()
      .default("ACTIVE"),
    summary: text("summary").notNull(),
    memory: jsonb("memory").$type<Record<string, unknown>>().notNull(),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull().default([]),
    strength: numeric("strength", { precision: 5, scale: 4 }).notNull().default("0.5000"),
    version: integer("version").notNull().default(1),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_memory_cards_user_type_key_idx").on(table.userId, table.cardType, table.memoryKey),
    index("user_memory_cards_user_status_idx").on(table.userId, table.status),
    index("user_memory_cards_user_type_idx").on(table.userId, table.cardType),
    index("user_memory_cards_expires_idx").on(table.expiresAt),
  ],
);

export const userMemoryEvents = pgTable(
  "user_memory_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    cardId: uuid("card_id"),
    signalId: uuid("signal_id"),
    eventType: text("event_type", {
      enum: ["CREATED", "REINFORCED", "DECAYED", "SUPPRESSED", "EXPIRED", "USER_RESET", "SYSTEM_REVIEW"],
    }).notNull(),
    delta: jsonb("delta").$type<Record<string, unknown>>().notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_memory_events_user_created_idx").on(table.userId, table.createdAt),
    index("user_memory_events_card_idx").on(table.cardId),
    index("user_memory_events_signal_idx").on(table.signalId),
  ],
);

export const evermemos = pgTable(
  "evermemos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    memoryClass: text("memory_class", {
      enum: ["core", "episodic", "semantic", "procedural", "resource", "knowledge_vault"],
    }).notNull(),
    status: text("status", {
      enum: ["ACTIVE", "ARCHIVED", "SUPPRESSED", "EXPIRED"],
    })
      .notNull()
      .default("ACTIVE"),
    title: text("title").notNull(),
    content: jsonb("content").$type<Record<string, unknown>>().notNull(),
    linkedEntityType: text("linked_entity_type"),
    linkedEntityId: text("linked_entity_id"),
    importance: numeric("importance", { precision: 5, scale: 4 }).notNull().default("0.5000"),
    retrievalKey: text("retrieval_key"),
    embeddingRef: text("embedding_ref"),
    lastRetrievedAt: timestamp("last_retrieved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evermemos_user_status_idx").on(table.userId, table.status),
    index("evermemos_user_class_idx").on(table.userId, table.memoryClass),
    index("evermemos_linked_entity_idx").on(table.linkedEntityType, table.linkedEntityId),
    index("evermemos_retrieval_key_idx").on(table.retrievalKey),
  ],
);

export const evermemoEvents = pgTable(
  "evermemo_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    evermemoId: uuid("evermemo_id"),
    userId: uuid("user_id").notNull(),
    eventType: text("event_type", {
      enum: ["CREATED", "UPDATED", "LINKED", "RETRIEVED", "REINFORCED", "ARCHIVED", "SUPPRESSED"],
    }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evermemo_events_user_created_idx").on(table.userId, table.createdAt),
    index("evermemo_events_evermemo_idx").on(table.evermemoId),
  ],
);

export const termIntelligenceTerms = pgTable(
  "term_intelligence_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedTerm: text("normalized_term").notNull(),
    displayLabel: text("display_label").notNull(),
    lifecycleStatus: text("lifecycle_status", {
      enum: ["OBSERVED", "CANDIDATE", "VERIFIED", "OFFICIAL", "DEPRECATED"],
    })
      .notNull()
      .default("OBSERVED"),
    termCategory: text("term_category"),
    valueType: text("value_type", {
      enum: ["number", "enum", "boolean", "text", "unknown"],
    })
      .notNull()
      .default("unknown"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    supportingSourceCount: integer("supporting_source_count").notNull().default(1),
    avgConfidence: numeric("avg_confidence", { precision: 5, scale: 4 }).notNull().default("0.5000"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("term_intelligence_terms_normalized_idx").on(table.normalizedTerm),
    index("term_intelligence_terms_status_idx").on(table.lifecycleStatus, table.lastSeenAt),
    index("term_intelligence_terms_category_idx").on(table.termCategory),
  ],
);

export const termIntelligenceEvidence = pgTable(
  "term_intelligence_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    normalizedTerm: text("normalized_term").notNull(),
    sourceKey: text("source_key").notNull(),
    sessionId: uuid("session_id").notNull(),
    roundNo: integer("round_no"),
    listingId: uuid("listing_id"),
    rolePerspective: text("role_perspective", {
      enum: ["BUYER", "SELLER", "SYSTEM", "UNKNOWN"],
    })
      .notNull()
      .default("UNKNOWN"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    evidence: jsonb("evidence").$type<ConversationSignalEvidence>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("term_intelligence_evidence_term_source_idx").on(table.normalizedTerm, table.sourceKey),
    index("term_intelligence_evidence_session_idx").on(table.sessionId, table.roundNo),
    index("term_intelligence_evidence_term_idx").on(table.normalizedTerm),
  ],
);

export const memoryEligibilitySnapshots = pgTable(
  "memory_eligibility_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    eligible: boolean("eligible").notNull().default(false),
    reason: text("reason", {
      enum: [
        "legendary_buddy_trade_threshold",
        "mythic_buddy_trade_threshold",
        "reviewer_trade_threshold",
        "subscription",
        "manual",
        "not_eligible",
      ],
    }).notNull(),
    buddyId: uuid("buddy_id"),
    buddyRarity: text("buddy_rarity"),
    monthlyTradeCount: integer("monthly_trade_count").notNull().default(0),
    reviewerParticipationCount: integer("reviewer_participation_count").notNull().default(0),
    subscriptionActive: boolean("subscription_active").notNull().default(false),
    sourcePayload: jsonb("source_payload").$type<Record<string, unknown>>(),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    index("memory_eligibility_snapshots_user_eval_idx").on(table.userId, table.evaluatedAt),
    index("memory_eligibility_snapshots_eligible_idx").on(table.eligible, table.evaluatedAt),
    index("memory_eligibility_snapshots_user_current_idx").on(table.userId, table.expiresAt),
  ],
);
