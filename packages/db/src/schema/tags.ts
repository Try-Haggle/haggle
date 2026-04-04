import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const tags = pgTable("tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  status: text("status", { enum: ["CANDIDATE", "EMERGING", "OFFICIAL", "DEPRECATED"] }).notNull().default("CANDIDATE"),
  category: text("category").notNull(),
  useCount: integer("use_count").notNull().default(0),
  parentId: uuid("parent_id"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const expertTags = pgTable("expert_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(),
  tagId: uuid("tag_id").notNull(),
  category: text("category").notNull(),
  caseCount: integer("case_count").notNull().default(0),
  accuracy: numeric("accuracy", { precision: 8, scale: 4 }).notNull(),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tagMergeLog = pgTable("tag_merge_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  sourceTagId: uuid("source_tag_id").notNull(),
  targetTagId: uuid("target_tag_id").notNull(),
  reason: text("reason", { enum: ["levenshtein", "synonym", "manual"] }).notNull(),
  mergedBy: text("merged_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
