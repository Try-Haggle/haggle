import { createHash } from "node:crypto";
import {
  and,
  type Database,
  desc,
  disputeCases,
  disputePrecedents,
  disputeResolutions,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
} from "@haggle/db";

const RESOLVED_STATUSES = [
  "RESOLVED_BUYER_FAVOR",
  "RESOLVED_SELLER_FAVOR",
  "PARTIAL_REFUND",
  "CLOSED",
] as const;

export interface ApprovedDisputePrecedent {
  id: string;
  reason_code: string;
  outcome: "buyer_favor" | "seller_favor" | "partial_refund" | "no_action";
  facts_summary: string;
  issue_summary: string;
  decision_principle: string;
  evidence_profile: {
    evidence_types: string[];
    high_weight_evidence: string[];
    material_gaps: string[];
  };
  distinguishing_factors: string[];
  remedy_summary?: string;
  analysis_version: string;
  policy_version: string;
  approved_at: string;
}

export interface DisputePrecedentAnalysisInput {
  precedentId: string;
  expectedSourceSnapshotSha256: string;
  factsSummary: string;
  issueSummary: string;
  decisionPrinciple: string;
  evidenceProfile: ApprovedDisputePrecedent["evidence_profile"];
  distinguishingFactors: string[];
  remedySummary?: string;
  analysisVersion: string;
  policyVersion: string;
  analyzedBy: string;
}

function requireAnalysisText(name: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${name} must be between 1 and ${maxLength} characters`);
  }
  return normalized;
}

export function buildApprovedPrecedentFilter(reasonCode: string, now: Date) {
  return and(
    eq(disputePrecedents.status, "APPROVED"),
    eq(disputePrecedents.reasonCode, reasonCode),
    lte(disputePrecedents.effectiveFrom, now),
    or(isNull(disputePrecedents.effectiveUntil), gt(disputePrecedents.effectiveUntil, now)),
  );
}

export function rankApprovedDisputePrecedents(
  precedents: ApprovedDisputePrecedent[],
  evidenceTypes: string[],
  limit: number,
): ApprovedDisputePrecedent[] {
  const currentEvidenceTypes = new Set(evidenceTypes);
  return precedents
    .map((precedent) => {
      const typeMatches = precedent.evidence_profile.evidence_types.filter((type) =>
        currentEvidenceTypes.has(type),
      ).length;
      const highWeightMatches = precedent.evidence_profile.high_weight_evidence.filter((type) =>
        currentEvidenceTypes.has(type),
      ).length;
      return { precedent, score: typeMatches + highWeightMatches * 2 };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.precedent.approved_at.localeCompare(left.precedent.approved_at),
    )
    .slice(0, limit)
    .map(({ precedent }) => precedent);
}

export async function listApprovedDisputePrecedents(
  db: Database,
  reasonCode: string,
  options: { limit?: number; now?: Date; evidenceTypes?: string[] } = {},
): Promise<ApprovedDisputePrecedent[]> {
  const limit = Math.min(Math.max(options.limit ?? 5, 1), 10);
  const now = options.now ?? new Date();
  const rows = await db
    .select()
    .from(disputePrecedents)
    .where(buildApprovedPrecedentFilter(reasonCode, now))
    .orderBy(desc(disputePrecedents.approvedAt), desc(disputePrecedents.id))
    .limit(50);

  const precedents = rows.flatMap((row) => {
    if (
      !row.factsSummary ||
      !row.issueSummary ||
      !row.decisionPrinciple ||
      !row.evidenceProfile ||
      !row.analysisVersion ||
      !row.policyVersion ||
      !row.approvedAt
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        reason_code: row.reasonCode,
        outcome: row.outcome,
        facts_summary: row.factsSummary,
        issue_summary: row.issueSummary,
        decision_principle: row.decisionPrinciple,
        evidence_profile: row.evidenceProfile,
        distinguishing_factors: row.distinguishingFactors ?? [],
        remedy_summary: row.remedySummary ?? undefined,
        analysis_version: row.analysisVersion,
        policy_version: row.policyVersion,
        approved_at: row.approvedAt.toISOString(),
      },
    ];
  });

  return rankApprovedDisputePrecedents(precedents, options.evidenceTypes ?? [], limit);
}

export function formatApprovedDisputePrecedents(precedents: ApprovedDisputePrecedent[]): string {
  if (precedents.length === 0) {
    return "No approved platform precedent closely matches this reason code.";
  }

  return precedents
    .map(
      (precedent, index) =>
        `PRECEDENT ${index + 1} (Haggle ID: ${precedent.id})\n${JSON.stringify(precedent)}`,
    )
    .join("\n\n");
}

/** Records pre-computed analysis. This function never invokes an LLM. */
export async function recordDisputePrecedentAnalysis(
  db: Database,
  input: DisputePrecedentAnalysisInput,
): Promise<boolean> {
  const rows = await db
    .update(disputePrecedents)
    .set({
      status: "DRAFT",
      factsSummary: requireAnalysisText("factsSummary", input.factsSummary, 2_000),
      issueSummary: requireAnalysisText("issueSummary", input.issueSummary, 1_000),
      decisionPrinciple: requireAnalysisText("decisionPrinciple", input.decisionPrinciple, 2_000),
      evidenceProfile: input.evidenceProfile,
      distinguishingFactors: input.distinguishingFactors.slice(0, 20),
      remedySummary: input.remedySummary?.trim().slice(0, 1_000),
      analysisVersion: requireAnalysisText("analysisVersion", input.analysisVersion, 100),
      policyVersion: requireAnalysisText("policyVersion", input.policyVersion, 100),
      analyzedBy: requireAnalysisText("analyzedBy", input.analyzedBy, 200),
      analyzedAt: new Date(),
      approvedBy: null,
      approvedAt: null,
      effectiveFrom: null,
      effectiveUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(disputePrecedents.id, input.precedentId),
        eq(disputePrecedents.sourceSnapshotSha256, input.expectedSourceSnapshotSha256),
        inArray(disputePrecedents.status, ["CANDIDATE", "DRAFT"]),
      ),
    )
    .returning({ id: disputePrecedents.id });
  return rows.length === 1;
}

/** Publishes reviewed analysis for runtime retrieval. */
export async function approveDisputePrecedentAnalysis(
  db: Database,
  input: { precedentId: string; approvedBy: string; effectiveFrom?: Date },
): Promise<boolean> {
  const rows = await db
    .update(disputePrecedents)
    .set({
      status: "APPROVED",
      approvedBy: requireAnalysisText("approvedBy", input.approvedBy, 200),
      approvedAt: new Date(),
      effectiveFrom: input.effectiveFrom ?? new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(disputePrecedents.id, input.precedentId), eq(disputePrecedents.status, "DRAFT")))
    .returning({ id: disputePrecedents.id });
  return rows.length === 1;
}

function sourceSnapshotHash(input: {
  disputeId: string;
  reasonCode: string;
  outcome: string;
  resolutionSummary: string;
  resolvedAt: Date | null;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        dispute_id: input.disputeId,
        reason_code: input.reasonCode,
        outcome: input.outcome,
        resolution_summary: input.resolutionSummary,
        resolved_at: input.resolvedAt?.toISOString() ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Collects resolved cases as analysis candidates without copying party evidence
 * or free-form case content into the precedent store.
 */
export async function collectDisputePrecedentCandidates(
  db: Database,
  options: { limit?: number } = {},
): Promise<{ scanned: number; inserted: number }> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await db
    .select({
      disputeId: disputeCases.id,
      reasonCode: disputeCases.reasonCode,
      status: disputeCases.status,
      outcome: disputeResolutions.outcome,
      resolutionSummary: disputeResolutions.summary,
      resolvedAt: disputeResolutions.resolvedAt,
    })
    .from(disputeCases)
    .innerJoin(disputeResolutions, eq(disputeResolutions.disputeId, disputeCases.id))
    .leftJoin(
      disputePrecedents,
      and(
        eq(disputePrecedents.sourceDisputeId, disputeCases.id),
        inArray(disputePrecedents.status, ["CANDIDATE", "DRAFT", "APPROVED", "EXCLUDED"]),
      ),
    )
    .where(and(inArray(disputeCases.status, [...RESOLVED_STATUSES]), isNull(disputePrecedents.id)))
    .orderBy(desc(disputeResolutions.createdAt))
    .limit(limit);

  let inserted = 0;
  for (const row of rows) {
    const created = await db
      .insert(disputePrecedents)
      .values({
        sourceDisputeId: row.disputeId,
        sourceSnapshotSha256: sourceSnapshotHash(row),
        reasonCode: row.reasonCode,
        outcome: row.outcome,
        status: "CANDIDATE",
      })
      .onConflictDoNothing()
      .returning({ id: disputePrecedents.id });
    inserted += created.length;
  }

  return { scanned: rows.length, inserted };
}
