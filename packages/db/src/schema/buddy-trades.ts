import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// buddy_trades — trade history per buddy
// ────────────────────────────────────────────────────────────────

export const buddyTrades = pgTable(
  "buddy_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    buddyId: uuid("buddy_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    category: text("category").notNull(),
    skillsUsed: jsonb("skills_used").$type<string[]>(),
    presetUsed: text("preset_used"),
    outcome: text("outcome", { enum: ["DEAL", "REJECT", "TIMEOUT", "WALKAWAY"] }).notNull(),
    savingPct: numeric("saving_pct", { precision: 8, scale: 4 }),
    rounds: integer("rounds"),
    opponentPattern: text("opponent_pattern"),
    tacticUsed: text("tactic_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("buddy_trades_buddy_id_idx").on(table.buddyId),
    index("buddy_trades_category_idx").on(table.category),
    index("buddy_trades_outcome_idx").on(table.outcome),
  ],
);
