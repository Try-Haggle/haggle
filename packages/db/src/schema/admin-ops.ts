import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const tagPromotionRules = pgTable(
  "tag_promotion_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    category: text("category").notNull(),
    candidateMinUse: integer("candidate_min_use").notNull(),
    emergingMinUse: integer("emerging_min_use").notNull(),
    candidateMinAgeDays: integer("candidate_min_age_days").notNull().default(0),
    emergingMinAgeDays: integer("emerging_min_age_days").notNull().default(7),
    suggestionAutoPromoteCount: integer("suggestion_auto_promote_count").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryUnique: uniqueIndex("tag_promotion_rules_category_uq").on(t.category),
  }),
);

export const adminActionLog = pgTable(
  "admin_action_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id").notNull(),
    actionType: text("action_type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byActor: index("admin_action_log_actor_idx").on(t.actorId, t.createdAt),
    byAction: index("admin_action_log_action_idx").on(t.actionType, t.createdAt),
    byTarget: index("admin_action_log_target_idx").on(t.targetType, t.targetId),
  }),
);
