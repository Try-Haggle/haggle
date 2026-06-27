import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────
// negotiation_agents — system presets + user-owned custom agents.
// Was skill_presets before migration 0024; 0024 also renamed the
// advisor_config column to negotiation_agent_config and added the
// role column used by /buy/agents vs /sell/agents filtering.
// ────────────────────────────────────────────────────────────────

export const negotiationAgents = pgTable(
  "negotiation_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    advisorSkillId: text("advisor_skill_id").notNull(),
    negotiationAgentConfig: jsonb("negotiation_agent_config").$type<Record<string, unknown>>(),
    validatorSkills: jsonb("validator_skills").$type<string[]>(),
    /** Which surface the agent belongs on: `buyer`, `seller`, or `both`. Migration 0024. */
    role: text("role", { enum: ["buyer", "seller", "both"] })
      .notNull()
      .default("both"),
    isSystem: boolean("is_system").notNull().default(true),
    userId: uuid("user_id"),
    avgSavingPct: numeric("avg_saving_pct", { precision: 8, scale: 4 }),
    avgWinRate: numeric("avg_win_rate", { precision: 8, scale: 4 }),
    usageCount: integer("usage_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("negotiation_agents_name_idx").on(table.name),
    index("negotiation_agents_is_system_idx").on(table.isSystem),
    index("negotiation_agents_user_id_idx").on(table.userId),
    index("negotiation_agents_role_idx").on(table.role),
  ],
);
