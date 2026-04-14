import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// market_microstructure — 시장 미시구조 데이터
// Doc 31 확장: 카테고리/SKU별 가격 분포, 스프레드, 거래량
// 해자 가치: 시장 메이커 수준의 가격 인텔리전스
// ────────────────────────────────────────────────────────────────

export const marketMicrostructure = pgTable(
  "market_microstructure",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    category: text("category").notNull(),
    subcategory: text("subcategory"),
    sku: text("sku"),

    // Snapshot period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    periodType: text("period_type", {
      enum: ["HOURLY", "DAILY", "WEEKLY"],
    }).notNull(),

    // Volume
    totalSessions: integer("total_sessions").notNull().default(0),
    dealCount: integer("deal_count").notNull().default(0),
    rejectCount: integer("reject_count").notNull().default(0),
    timeoutCount: integer("timeout_count").notNull().default(0),

    // Price signals
    avgAskMinor: numeric("avg_ask_minor", { precision: 18, scale: 0 }),
    avgBidMinor: numeric("avg_bid_minor", { precision: 18, scale: 0 }),
    avgDealMinor: numeric("avg_deal_minor", { precision: 18, scale: 0 }),
    medianDealMinor: numeric("median_deal_minor", { precision: 18, scale: 0 }),
    bidAskSpread: numeric("bid_ask_spread", { precision: 8, scale: 4 }),
    priceStddev: numeric("price_stddev", { precision: 18, scale: 0 }),

    // Negotiation characteristics
    avgRounds: numeric("avg_rounds", { precision: 5, scale: 1 }),
    avgDurationMinutes: numeric("avg_duration_minutes", { precision: 10, scale: 1 }),
    avgDiscountRate: numeric("avg_discount_rate", { precision: 5, scale: 4 }),

    // Pattern distribution (% of sessions)
    boulwareRatio: numeric("boulware_ratio", { precision: 5, scale: 4 }),
    linearRatio: numeric("linear_ratio", { precision: 5, scale: 4 }),
    concederRatio: numeric("conceder_ratio", { precision: 5, scale: 4 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("market_microstructure_period_idx").on(
      table.category, table.subcategory, table.sku, table.periodStart, table.periodType,
    ),
    index("market_microstructure_category_idx").on(table.category, table.periodType),
    index("market_microstructure_sku_idx").on(table.sku),
  ],
);

// ────────────────────────────────────────────────────────────────
// negotiation_graph — 협상 관계 그래프
// 해자 가치: 구매자-판매자 네트워크 맵, 재거래 패턴, 선호 분석
// ────────────────────────────────────────────────────────────────

export const negotiationGraph = pgTable(
  "negotiation_graph",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buyerId: uuid("buyer_id").notNull(),
    sellerId: uuid("seller_id").notNull(),
    category: text("category").notNull(),

    // Relationship metrics
    totalSessions: integer("total_sessions").notNull().default(1),
    dealCount: integer("deal_count").notNull().default(0),
    avgDiscountRate: numeric("avg_discount_rate", { precision: 5, scale: 4 }),
    avgRounds: numeric("avg_rounds", { precision: 5, scale: 1 }),

    // Behavioral patterns
    buyerPatternMode: text("buyer_pattern_mode", {
      enum: ["BOULWARE", "LINEAR", "CONCEDER"],
    }),
    sellerPatternMode: text("seller_pattern_mode", {
      enum: ["BOULWARE", "LINEAR", "CONCEDER"],
    }),

    // Trust signal
    lastDealAt: timestamp("last_deal_at", { withTimezone: true }),
    disputeCount: integer("dispute_count").notNull().default(0),

    firstInteractionAt: timestamp("first_interaction_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("negotiation_graph_pair_category_idx").on(
      table.buyerId, table.sellerId, table.category,
    ),
    index("negotiation_graph_buyer_idx").on(table.buyerId),
    index("negotiation_graph_seller_idx").on(table.sellerId),
  ],
);

// ────────────────────────────────────────────────────────────────
// tactic_effectiveness — 전술 효과 통계
// 해자 가치: "어떤 전술이 어떤 상황에서 효과적인가" 판례 DB
// ────────────────────────────────────────────────────────────────

export const tacticEffectiveness = pgTable(
  "tactic_effectiveness",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tactic: text("tactic").notNull(),
    category: text("category").notNull(),
    role: text("role", { enum: ["BUYER", "SELLER"] }).notNull(),

    // Context
    priceRangeLow: numeric("price_range_low", { precision: 18, scale: 0 }),
    priceRangeHigh: numeric("price_range_high", { precision: 18, scale: 0 }),
    opponentPattern: text("opponent_pattern", {
      enum: ["BOULWARE", "LINEAR", "CONCEDER", "UNKNOWN"],
    }),

    // Effectiveness metrics
    timesUsed: integer("times_used").notNull().default(0),
    timesSucceeded: integer("times_succeeded").notNull().default(0),
    avgConcessionGained: numeric("avg_concession_gained", { precision: 8, scale: 6 }),
    avgCounterDelay: numeric("avg_counter_delay", { precision: 5, scale: 1 }),

    // Outcome correlation
    dealRate: numeric("deal_rate", { precision: 5, scale: 4 }),
    avgDiscountWhenUsed: numeric("avg_discount_when_used", { precision: 5, scale: 4 }),

    // Period
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tactic_effectiveness_composite_idx").on(
      table.tactic, table.category, table.role, table.opponentPattern, table.periodStart,
    ),
    index("tactic_effectiveness_tactic_idx").on(table.tactic),
    index("tactic_effectiveness_category_idx").on(table.category),
  ],
);

// ────────────────────────────────────────────────────────────────
// price_discovery — 가격 발견 시그널
// 해자 가치: 실시간 시장 가격 형성 데이터 (Bloomberg Terminal 수준)
// ────────────────────────────────────────────────────────────────

export const priceDiscovery = pgTable(
  "price_discovery",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").notNull(),
    listingId: uuid("listing_id").notNull(),
    category: text("category").notNull(),
    sku: text("sku"),

    // Initial prices
    initialAskMinor: numeric("initial_ask_minor", { precision: 18, scale: 0 }).notNull(),
    initialBidMinor: numeric("initial_bid_minor", { precision: 18, scale: 0 }),

    // Final state
    finalPriceMinor: numeric("final_price_minor", { precision: 18, scale: 0 }),
    outcome: text("outcome", { enum: ["DEAL", "REJECT", "TIMEOUT", "WALKAWAY"] }),

    // Price movement
    totalRounds: integer("total_rounds").notNull(),
    priceTrajectory: jsonb("price_trajectory").$type<number[]>(),
    convergenceRound: integer("convergence_round"),

    // External reference price
    externalRefMinor: numeric("external_ref_minor", { precision: 18, scale: 0 }),
    externalRefSource: text("external_ref_source"),
    savingsVsRef: numeric("savings_vs_ref", { precision: 18, scale: 0 }),

    // Timing
    dayOfWeek: integer("day_of_week"),
    hourOfDay: integer("hour_of_day"),
    durationMinutes: numeric("duration_minutes", { precision: 10, scale: 1 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("price_discovery_session_idx").on(table.sessionId),
    index("price_discovery_listing_idx").on(table.listingId),
    index("price_discovery_category_sku_idx").on(table.category, table.sku),
    index("price_discovery_created_idx").on(table.createdAt),
  ],
);
