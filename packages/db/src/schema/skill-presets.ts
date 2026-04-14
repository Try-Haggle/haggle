import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// skill_presets — negotiation strategy presets (system + custom)
// ────────────────────────────────────────────────────────────────

export const skillPresets = pgTable(
  "skill_presets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    advisorSkillId: text("advisor_skill_id").notNull(),
    advisorConfig: jsonb("advisor_config").$type<Record<string, unknown>>(),
    validatorSkills: jsonb("validator_skills").$type<string[]>(),
    isSystem: boolean("is_system").notNull().default(true),
    userId: uuid("user_id"),
    avgSavingPct: numeric("avg_saving_pct", { precision: 8, scale: 4 }),
    avgWinRate: numeric("avg_win_rate", { precision: 8, scale: 4 }),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("skill_presets_name_idx").on(table.name),
    index("skill_presets_is_system_idx").on(table.isSystem),
    index("skill_presets_user_id_idx").on(table.userId),
  ],
);
