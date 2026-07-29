import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { disputeCases } from "./disputes.js";

export interface DisputePrecedentEvidenceProfile {
  evidence_types: string[];
  high_weight_evidence: string[];
  material_gaps: string[];
}

/**
 * Versioned, pre-analyzed platform precedents.
 *
 * Candidate rows contain no party evidence or free-form case text. Runtime
 * consumers may read APPROVED rows only; analysis and approval happen outside
 * the request-time Advisor LLM call.
 */
export const disputePrecedents = pgTable(
  "dispute_precedents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDisputeId: uuid("source_dispute_id")
      .notNull()
      .references(() => disputeCases.id, { onDelete: "restrict" }),
    sourceSnapshotSha256: text("source_snapshot_sha256").notNull(),
    reasonCode: text("reason_code").notNull(),
    outcome: text("outcome", {
      enum: ["buyer_favor", "seller_favor", "partial_refund", "no_action"],
    }).notNull(),
    status: text("status", {
      enum: ["CANDIDATE", "DRAFT", "APPROVED", "RETIRED", "EXCLUDED"],
    })
      .notNull()
      .default("CANDIDATE"),
    factsSummary: text("facts_summary"),
    issueSummary: text("issue_summary"),
    decisionPrinciple: text("decision_principle"),
    evidenceProfile: jsonb("evidence_profile").$type<DisputePrecedentEvidenceProfile>(),
    distinguishingFactors: jsonb("distinguishing_factors").$type<string[]>(),
    remedySummary: text("remedy_summary"),
    analysisVersion: text("analysis_version"),
    policyVersion: text("policy_version"),
    analyzedBy: text("analyzed_by"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dispute_precedents_current_source_unique")
      .on(table.sourceDisputeId)
      .where(sql`${table.status} IN ('CANDIDATE', 'DRAFT', 'APPROVED', 'EXCLUDED')`),
    index("dispute_precedents_runtime_lookup_idx").on(
      table.status,
      table.reasonCode,
      table.effectiveFrom,
      table.approvedAt,
    ),
    check(
      "dispute_precedents_status_valid",
      sql`${table.status} IN ('CANDIDATE', 'DRAFT', 'APPROVED', 'RETIRED', 'EXCLUDED')`,
    ),
    check(
      "dispute_precedents_outcome_valid",
      sql`${table.outcome} IN ('buyer_favor', 'seller_favor', 'partial_refund', 'no_action')`,
    ),
    check(
      "dispute_precedents_approved_analysis_complete",
      sql`${table.status} <> 'APPROVED' OR (
        ${table.factsSummary} IS NOT NULL
        AND ${table.issueSummary} IS NOT NULL
        AND ${table.decisionPrinciple} IS NOT NULL
        AND ${table.evidenceProfile} IS NOT NULL
        AND ${table.analysisVersion} IS NOT NULL
        AND ${table.policyVersion} IS NOT NULL
        AND ${table.approvedBy} IS NOT NULL
        AND ${table.approvedAt} IS NOT NULL
        AND ${table.effectiveFrom} IS NOT NULL
      )`,
    ),
    check(
      "dispute_precedents_effective_window_valid",
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveFrom} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
  ],
);
