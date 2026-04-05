import { boolean, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const dsRatings = pgTable("ds_ratings", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewerId: uuid("reviewer_id").notNull(),
  score: integer("score").notNull(),
  tier: text("tier", { enum: ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"] }).notNull(),
  voteWeight: numeric("vote_weight", { precision: 8, scale: 4 }).notNull(),
  cumulativeCases: integer("cumulative_cases").notNull().default(0),
  recentCases: integer("recent_cases").notNull().default(0),
  zoneHitRate: numeric("zone_hit_rate", { precision: 8, scale: 4 }),
  participationRate: numeric("participation_rate", { precision: 8, scale: 4 }),
  uniqueCategories: integer("unique_categories").default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dsTagSpecializations = pgTable("ds_tag_specializations", {
  id: uuid("id").defaultRandom().primaryKey(),
  reviewerId: uuid("reviewer_id").notNull(),
  tag: text("tag").notNull(),
  score: integer("score").notNull(),
  tier: text("tier", { enum: ["BRONZE", "SILVER", "GOLD", "PLATINUM", "DIAMOND"] }).notNull(),
  caseCount: integer("case_count").notNull().default(0),
  zoneHitRate: numeric("zone_hit_rate", { precision: 8, scale: 4 }).notNull(),
  qualified: boolean("qualified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
