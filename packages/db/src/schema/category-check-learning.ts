/**
 * Category-check learning (taxonomy cold-start → warm flywheel).
 *
 * The static taxonomy (`@haggle/shared/category-taxonomy`) cannot enumerate every
 * question every long-tail category needs. When the agent-builder repeatedly asks a
 * question that no taxonomy check covers, that recurrence is evidence the taxonomy is
 * missing something. These tables accumulate that evidence so `promoteLearnedChecks`
 * can turn it into a SOFT overlay check — no API call needed once learned.
 *
 * Shape mirrors the proven `term_intelligence_*` pair: an aggregate row per
 * (category, check) plus one evidence row per distinct source. The unique index on
 * (check_key, source_key) is what makes "distinct sources" countable — a single chatty
 * session can never promote a check on its own.
 */

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Aggregate: one row per (category path, learned check). */
export const learnedCategoryChecks = pgTable(
  "learned_category_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Taxonomy node path the check attaches to, e.g. "electronics/phones". */
    categoryPath: text("category_path").notNull(),
    /** Stable per-category check key (slug/checkId/featureKey) from the promotion algorithm. */
    checkKey: text("check_key").notNull(),
    /** Human question text (the representative phrasing). */
    questionKo: text("question_ko").notNull(),
    /** Optional FEATURE_SCHEMA key when the observed question maps to an engine feature. */
    featureKey: text("feature_key"),
    /** Running totals that drive promotion thresholds. */
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    distinctSourceCount: integer("distinct_source_count").notNull().default(1),
    /**
     * OBSERVED → accumulating; PROMOTED → served by the overlay;
     * SUPPRESSED → operator disabled it (never served, never re-promoted).
     */
    status: text("status", { enum: ["OBSERVED", "PROMOTED", "SUPPRESSED"] })
      .notNull()
      .default("OBSERVED"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("learned_category_checks_path_key_idx").on(table.categoryPath, table.checkKey),
    index("learned_category_checks_status_idx").on(table.status, table.lastSeenAt),
  ],
);

/** Evidence: one row per DISTINCT source that needed the check. */
export const learnedCategoryCheckEvidence = pgTable(
  "learned_category_check_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    categoryPath: text("category_path").notNull(),
    checkKey: text("check_key").notNull(),
    /** Distinct source identifier (draft/listing/session/user id). */
    sourceKey: text("source_key").notNull(),
    /** Where the observation came from, for auditing and for disabling a noisy feeder. */
    origin: text("origin", { enum: ["BUILDER", "NEGOTIATION", "SENSOR", "UNKNOWN"] })
      .notNull()
      .default("UNKNOWN"),
    questionKo: text("question_ko").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One evidence row per source — this is what makes distinct-source counting correct.
    uniqueIndex("learned_category_check_evidence_source_idx").on(
      table.categoryPath,
      table.checkKey,
      table.sourceKey,
    ),
    index("learned_category_check_evidence_check_idx").on(table.categoryPath, table.checkKey),
    index("learned_category_check_evidence_created_idx").on(sql`${table.createdAt} DESC`),
  ],
);
