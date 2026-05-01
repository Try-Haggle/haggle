import { sql, type Database } from "@haggle/db";
import type { ConversationSignal } from "./conversation-signal-extractor.js";

export interface RecordTermCandidateInput {
  sessionId: string;
  roundNo?: number;
  listingId?: string;
  sourceKey: string;
  signals: ConversationSignal[];
  metadata?: Record<string, unknown>;
}

export interface RecordTermCandidateResult {
  observed: number;
}

const CANDIDATE_OCCURRENCE_THRESHOLD = 3;

export async function recordTermCandidates(
  db: Database,
  input: RecordTermCandidateInput,
): Promise<RecordTermCandidateResult> {
  const candidates = dedupeTermCandidates(input.signals);
  if (candidates.length === 0) return { observed: 0 };

  let observed = 0;
  for (const signal of candidates) {
    try {
      const result = await db.execute(sql`
        WITH inserted_evidence AS (
          INSERT INTO term_intelligence_evidence (
            normalized_term,
            source_key,
            session_id,
            round_no,
            listing_id,
            role_perspective,
            confidence,
            evidence,
            metadata
          )
          VALUES (
            ${signal.normalizedValue},
            ${input.sourceKey},
            ${input.sessionId},
            ${input.roundNo ?? null},
            ${input.listingId ?? null},
            ${signal.rolePerspective},
            ${signal.confidence.toFixed(4)},
            ${JSON.stringify(signal.evidence)}::jsonb,
            ${JSON.stringify({ ...signal.metadata, ...input.metadata })}::jsonb
          )
          ON CONFLICT (normalized_term, source_key) DO NOTHING
          RETURNING normalized_term
        )
        INSERT INTO term_intelligence_terms (
          normalized_term,
          display_label,
          lifecycle_status,
          term_category,
          value_type,
          occurrence_count,
          supporting_source_count,
          avg_confidence,
          first_seen_at,
          last_seen_at,
          metadata
        )
        SELECT
          ${signal.normalizedValue},
          ${signal.entityValue},
          'OBSERVED',
          ${signal.entityType},
          'unknown',
          1,
          1,
          ${signal.confidence.toFixed(4)},
          NOW(),
          NOW(),
          ${JSON.stringify({ source: "conversation_signal", ...signal.metadata, ...input.metadata })}::jsonb
        FROM inserted_evidence
        ON CONFLICT (normalized_term) DO UPDATE
          SET occurrence_count = term_intelligence_terms.occurrence_count + 1,
              supporting_source_count = term_intelligence_terms.supporting_source_count + 1,
              avg_confidence = (
                (term_intelligence_terms.avg_confidence::numeric * term_intelligence_terms.occurrence_count)
                + ${signal.confidence.toFixed(4)}::numeric
              ) / (term_intelligence_terms.occurrence_count + 1),
              lifecycle_status = CASE
                WHEN term_intelligence_terms.lifecycle_status = 'OBSERVED'
                 AND term_intelligence_terms.occurrence_count + 1 >= ${CANDIDATE_OCCURRENCE_THRESHOLD}
                  THEN 'CANDIDATE'
                ELSE term_intelligence_terms.lifecycle_status
              END,
              last_seen_at = NOW(),
              updated_at = NOW()
        RETURNING normalized_term
      `);

      if (resultHasRows(result)) observed++;
    } catch (err) {
      console.error("[term-intelligence] failed to record candidate:", (err as Error).message);
    }
  }

  return { observed };
}

function dedupeTermCandidates(signals: ConversationSignal[]): ConversationSignal[] {
  const seen = new Set<string>();
  const out: ConversationSignal[] = [];

  for (const signal of signals) {
    if (signal.type !== "term_candidate") continue;
    if (signal.privacyClass === "private_context") continue;
    if (seen.has(signal.normalizedValue)) continue;
    seen.add(signal.normalizedValue);
    out.push(signal);
  }

  return out;
}

function resultHasRows(result: unknown): boolean {
  if (Array.isArray(result)) return result.length > 0;
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows.length > 0;
    const rowCount = (result as { rowCount?: number }).rowCount;
    if (typeof rowCount === "number") return rowCount > 0;
  }
  return true;
}
