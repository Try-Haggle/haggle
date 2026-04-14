import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// buddies — companion creatures born from completed trades
// ────────────────────────────────────────────────────────────────

export const BUDDY_SPECIES = [
  "FOX", "RABBIT", "BEAR", "CAT", "OWL", "DRAGON", "EAGLE", "WOLF",
] as const;

export const BUDDY_RARITY = [
  "COMMON", "UNCOMMON", "RARE", "EPIC", "LEGENDARY", "MYTHIC",
] as const;

export const BUDDY_STATUS = ["EGG", "HATCHED", "ACTIVE"] as const;

export const buddies = pgTable(
  "buddies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),
    name: text("name"),
    species: text("species", { enum: BUDDY_SPECIES }).notNull(),
    rarity: text("rarity", { enum: BUDDY_RARITY }).notNull(),

    // Birth imprint (immutable)
    birthTradeId: uuid("birth_trade_id").notNull(),
    birthCategory: text("birth_category").notNull(),
    birthSkills: jsonb("birth_skills").$type<string[]>().notNull(),
    birthPreset: text("birth_preset"),
    birthSavingPct: numeric("birth_saving_pct", { precision: 8, scale: 4 }),

    // Growth stats (updated per trade)
    totalTrades: integer("total_trades").notNull().default(0),
    deals: integer("deals").notNull().default(0),
    rejects: integer("rejects").notNull().default(0),
    timeouts: integer("timeouts").notNull().default(0),
    walkaways: integer("walkaways").notNull().default(0),
    avgSavingPct: numeric("avg_saving_pct", { precision: 8, scale: 4 }),
    bestSavingPct: numeric("best_saving_pct", { precision: 8, scale: 4 }),

    // Passive ability (LEGENDARY+ only)
    // Single object for LEGENDARY, array for MYTHIC (enhanced LEGENDARY + unique MYTHIC)
    ability: jsonb("ability").$type<
      | { id: string; name: string; description: string; effect: string; enhanced?: boolean; bonus?: string }
      | { id: string; name: string; description: string; effect: string; enhanced?: boolean; bonus?: string }[]
    >(),
    abilityUnlockedAt: timestamp("ability_unlocked_at", { withTimezone: true }),

    // Buddy level (individual growth)
    buddyLevel: integer("buddy_level").notNull().default(1),
    buddyXp: integer("buddy_xp").notNull().default(0),

    // Awaken system (LEGENDARY+ only)
    isAwakened: boolean("is_awakened").notNull().default(false),
    awakenedAt: timestamp("awakened_at", { withTimezone: true }),
    awakenPerks: jsonb("awaken_perks").$type<string[]>(),

    // Meta
    status: text("status", { enum: BUDDY_STATUS }).notNull().default("EGG"),
    hatchedAt: timestamp("hatched_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("buddies_user_id_idx").on(table.userId),
    index("buddies_species_idx").on(table.species),
    index("buddies_rarity_idx").on(table.rarity),
    index("buddies_status_idx").on(table.status),
  ],
);
