import { index, integer, numeric, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// agent_levels — user-wide XP, level, and trade statistics
// ────────────────────────────────────────────────────────────────

export const agentLevels = pgTable(
  "agent_levels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    totalTrades: integer("total_trades").notNull().default(0),
    totalDeals: integer("total_deals").notNull().default(0),
    totalVolume: numeric("total_volume", { precision: 18, scale: 2 }).notNull().default("0"),
    totalSaved: numeric("total_saved", { precision: 18, scale: 2 }).notNull().default("0"),
    avgSavingPct: numeric("avg_saving_pct", { precision: 8, scale: 4 }).notNull().default("0"),
    bestSavingPct: numeric("best_saving_pct", { precision: 8, scale: 4 }).notNull().default("0"),
    consecutiveDeals: integer("consecutive_deals").notNull().default(0),

    // Pity ceiling tracking (dual: volume OR quality trade count)
    // Resets when the corresponding rarity is obtained
    pityVolumeEpic: numeric("pity_volume_epic", { precision: 18, scale: 2 }).notNull().default("0"),
    pityTradesEpic: integer("pity_trades_epic").notNull().default(0),
    pityVolumeLegendary: numeric("pity_volume_legendary", { precision: 18, scale: 2 }).notNull().default("0"),
    pityTradesLegendary: integer("pity_trades_legendary").notNull().default(0),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_levels_user_id_idx").on(table.userId),
    index("agent_levels_level_desc_idx").on(table.level),
    index("agent_levels_total_volume_idx").on(table.totalVolume),
  ],
);
