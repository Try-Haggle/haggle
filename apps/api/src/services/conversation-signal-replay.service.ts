import { sql, type Database } from "@haggle/db";
import {
  recordConversationSignalsForRound,
  type RecordConversationSignalsInput,
} from "./conversation-signal-sink.js";
import type { RolePerspective } from "./conversation-signal-extractor.js";

export interface ReplayConversationSignalSourcesInput {
  limit?: number;
  sessionId?: string;
  sourceKey?: string;
}

export interface ReplayConversationSignalSourcesResult {
  scanned: number;
  replayed: number;
  inserted: number;
  errors: Array<{ sourceKey: string; error: string }>;
}

interface SourceRow {
  sourceKey: string;
  sessionId: string;
  roundId?: string;
  roundNo?: number;
  listingId?: string;
  userId?: string;
  rolePerspective: RolePerspective;
  sourceLabel: "incoming" | "outgoing" | "system";
  rawText: string;
}

export async function replayConversationSignalSources(
  db: Database,
  input: ReplayConversationSignalSourcesInput = {},
): Promise<ReplayConversationSignalSourcesResult> {
  const rows = await loadReplayableSources(db, input);
  const result: ReplayConversationSignalSourcesResult = {
    scanned: rows.length,
    replayed: 0,
    inserted: 0,
    errors: [],
  };

  for (const row of rows) {
    try {
      const replay = await recordConversationSignalsForRound(db, mapSourceRowToRecordInput(row));
      result.replayed++;
      result.inserted += replay.inserted;
    } catch (err) {
      result.errors.push({ sourceKey: row.sourceKey, error: (err as Error).message });
    }
  }

  return result;
}

async function loadReplayableSources(
  db: Database,
  input: ReplayConversationSignalSourcesInput,
): Promise<SourceRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
  const result = await db.execute(sql`
    SELECT
      source_key AS "sourceKey",
      session_id AS "sessionId",
      round_id AS "roundId",
      round_no AS "roundNo",
      listing_id AS "listingId",
      user_id AS "userId",
      role_perspective AS "rolePerspective",
      source_label AS "sourceLabel",
      raw_text AS "rawText"
    FROM conversation_signal_sources source
    WHERE (${input.sourceKey ?? null}::text IS NULL OR source.source_key = ${input.sourceKey ?? null})
      AND (${input.sessionId ?? null}::uuid IS NULL OR source.session_id = ${input.sessionId ?? null})
      AND NOT EXISTS (
        SELECT 1
        FROM conversation_market_signals signal
        WHERE signal.evidence->>'sourceKey' = source.source_key
      )
    ORDER BY source.created_at ASC
    LIMIT ${limit}
  `);

  return rowsFromResult(result)
    .map(rowToSourceRow)
    .filter((row): row is SourceRow => row !== null);
}

function mapSourceRowToRecordInput(row: SourceRow): RecordConversationSignalsInput {
  return {
    sessionId: row.sessionId,
    roundId: row.roundId,
    roundNo: row.roundNo,
    listingId: row.listingId,
    userId: row.userId,
    rolePerspective: row.rolePerspective,
    sourceLabel: row.sourceLabel,
    sourceMessageId: row.sourceKey,
    text: row.rawText,
    metadata: {
      replayed_from_source: true,
    },
  };
}

function rowToSourceRow(row: Record<string, unknown>): SourceRow | null {
  if (
    typeof row.sourceKey !== "string"
    || typeof row.sessionId !== "string"
    || typeof row.rawText !== "string"
    || !isRolePerspective(row.rolePerspective)
    || !isSourceLabel(row.sourceLabel)
  ) {
    return null;
  }

  return {
    sourceKey: row.sourceKey,
    sessionId: row.sessionId,
    roundId: typeof row.roundId === "string" ? row.roundId : undefined,
    roundNo: typeof row.roundNo === "number" ? row.roundNo : undefined,
    listingId: typeof row.listingId === "string" ? row.listingId : undefined,
    userId: typeof row.userId === "string" ? row.userId : undefined,
    rolePerspective: row.rolePerspective,
    sourceLabel: row.sourceLabel,
    rawText: row.rawText,
  };
}

function isRolePerspective(value: unknown): value is RolePerspective {
  return value === "BUYER" || value === "SELLER" || value === "SYSTEM" || value === "UNKNOWN";
}

function isSourceLabel(value: unknown): value is "incoming" | "outgoing" | "system" {
  return value === "incoming" || value === "outgoing" || value === "system";
}

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}
