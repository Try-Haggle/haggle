import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// negotiation_round_facts — append-only round-level process data
// Doc 31 §3.1: SessionMemoryStore.RoundFact 영속화
// Hash chain: fact_hash = sha256(canonical JSON + prev_fact_hash)
// ────────────────────────────────────────────────────────────────

export const negotiationRoundFacts = pgTable(
  "negotiation_round_facts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    roundNo: integer("round_no").notNull(),

    // Prices
    buyerOffer: numeric("buyer_offer", { precision: 18, scale: 0 }),
    sellerOffer: numeric("seller_offer", { precision: 18, scale: 0 }),
    gap: numeric("gap", { precision: 18, scale: 0 }),

    // Tactics
    buyerTactic: text("buyer_tactic"),
    sellerTactic: text("seller_tactic"),

    // Conditions
    conditionsChanged: jsonb("conditions_changed").$type<
      { term: string; old_value: unknown; new_value: unknown; who: string }[]
    >(),

    // Coaching
    coachingRecommendedPrice: numeric("coaching_recommended_price", { precision: 18, scale: 0 }),
    coachingRecommendedTactic: text("coaching_recommended_tactic"),
    coachingFollowed: boolean("coaching_followed"),

    // Human intervention
    humanIntervened: boolean("human_intervened").default(false),

    // Phase at this round
    phase: text("phase"),

    // Tamper-proof hash chain (Doc 31 §4)
    factHash: text("fact_hash").notNull(),
    prevFactHash: text("prev_fact_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("negotiation_round_facts_session_round_idx").on(table.sessionId, table.roundNo),
    index("negotiation_round_facts_session_idx").on(table.sessionId),
  ],
);

// ────────────────────────────────────────────────────────────────
// negotiation_verifications — verification/attestation records
// Doc 31 §3.2: IMEI, battery, carrier checks + signatures
// ────────────────────────────────────────────────────────────────

export const negotiationVerifications = pgTable(
  "negotiation_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    roundNo: integer("round_no").notNull(),

    term: text("term").notNull(),
    result: text("result", {
      enum: ["CLEAN", "BLACKLISTED", "VERIFIED", "FAILED"],
    }).notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    provider: text("provider"),
    costMinor: integer("cost_minor").default(0),

    // Legal evidence signatures
    attestationSignature: text("attestation_signature").notNull(),
    attestationPayloadHash: text("attestation_payload_hash").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_verifications_session_idx").on(table.sessionId),
    index("negotiation_verifications_term_result_idx").on(table.term, table.result),
  ],
);

// ────────────────────────────────────────────────────────────────
// negotiation_escalations — escalation history
// Doc 31 §3.3: EscalationRequest 영속화
// ────────────────────────────────────────────────────────────────

export const negotiationEscalations = pgTable(
  "negotiation_escalations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    roundNo: integer("round_no").notNull(),

    type: text("type", {
      enum: ["UNKNOWN_PROPOSAL", "STRATEGY_REVIEW", "HUMAN_APPROVAL_REQUIRED"],
    }).notNull(),
    context: text("context"),
    strategySnapshot: jsonb("strategy_snapshot").$type<Record<string, unknown>>(),
    recentRounds: jsonb("recent_rounds").$type<Record<string, unknown>[]>(),

    // Resolution
    resolution: text("resolution", {
      enum: ["APPROVED", "REJECTED", "MODIFIED", "TIMEOUT"],
    }),
    resolutionDetail: jsonb("resolution_detail").$type<Record<string, unknown>>(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_escalations_session_idx").on(table.sessionId),
  ],
);

// ────────────────────────────────────────────────────────────────
// negotiation_checkpoints — phase restore points
// Doc 31 §3.4: CheckpointStore 영속화
// ────────────────────────────────────────────────────────────────

export const negotiationCheckpoints = pgTable(
  "negotiation_checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),

    phase: text("phase").notNull(),
    version: integer("version").notNull(),
    roundAtCheckpoint: integer("round_at_checkpoint").notNull(),

    coreMemorySnapshot: jsonb("core_memory_snapshot").$type<Record<string, unknown>>().notNull(),
    conditionsState: jsonb("conditions_state").$type<Record<string, unknown>>(),
    memoHash: text("memo_hash"),

    // Revert tracking
    reverted: boolean("reverted").default(false),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertReason: text("revert_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_checkpoints_session_phase_idx").on(table.sessionId, table.phase),
  ],
);

// ────────────────────────────────────────────────────────────────
// llm_telemetry — LLM call records
// Doc 31 §3.5: 비용/지연/토큰 추적
// ────────────────────────────────────────────────────────────────

export const llmTelemetry = pgTable(
  "llm_telemetry",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id"),
    roundNo: integer("round_no"),

    stage: text("stage", {
      enum: ["UNDERSTAND", "CONTEXT", "DECIDE", "VALIDATE", "RESPOND", "MEMO_UPDATE"],
    }).notNull(),
    model: text("model").notNull(),

    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    costMinor: integer("cost_minor"),

    reasoningUsed: boolean("reasoning_used").default(false),
    error: text("error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("llm_telemetry_session_idx").on(table.sessionId),
    index("llm_telemetry_model_created_idx").on(table.model, table.createdAt),
    index("llm_telemetry_created_idx").on(table.createdAt),
  ],
);
