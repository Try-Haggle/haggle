import { integer, pgTable, text, timestamp, uuid, unique, index } from "drizzle-orm/pg-core";

/**
 * DAG edges between tags. Multi-parent support.
 * Replaces the legacy single parentId column on tags table.
 *
 * Cycle prevention: enforced at application layer (insert checks).
 */
export const tagEdges = pgTable(
  "tag_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentTagId: uuid("parent_tag_id").notNull(),
    childTagId: uuid("child_tag_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueEdge: unique("tag_edges_unique").on(t.parentTagId, t.childTagId),
    parentIdx: index("tag_edges_parent_idx").on(t.parentTagId),
    childIdx: index("tag_edges_child_idx").on(t.childTagId),
  }),
);

/**
 * Missing tags queue — surfaced by LLM via `missing_tags` field.
 * Admin reviews and either creates a CANDIDATE tag or rejects.
 * Auto-promotion to CANDIDATE is post-MVP.
 */
export const tagSuggestions = pgTable(
  "tag_suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    label: text("label").notNull(),
    normalizedLabel: text("normalized_label").notNull(),
    suggestedBy: text("suggested_by", { enum: ["LLM", "USER", "ADMIN"] }).notNull(),
    firstSeenListingId: uuid("first_seen_listing_id"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED", "MERGED"] }).notNull().default("PENDING"),
    mergedIntoTagId: uuid("merged_into_tag_id"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueNormalized: unique("tag_suggestions_normalized_unique").on(t.normalizedLabel),
    statusIdx: index("tag_suggestions_status_idx").on(t.status),
  }),
);

/**
 * LLM placement cache — avoid re-running GPT-4o-mini for identical inputs.
 * Cache key: sha256(title|description|category|sorted_candidate_ids).
 */
export const tagPlacementCache = pgTable(
  "tag_placement_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    selectedTagIds: text("selected_tag_ids").array().notNull(), // real tag ids, not refs
    reasoning: text("reasoning"),
    missingTags: text("missing_tags").array().notNull().default([]),
    modelVersion: text("model_version").notNull(), // "gpt-4o-mini-2024-07-18"
    hitCount: integer("hit_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
