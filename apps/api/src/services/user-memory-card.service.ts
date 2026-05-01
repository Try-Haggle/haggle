import { sql, type Database } from "@haggle/db";
import type { ConversationSignal } from "./conversation-signal-extractor.js";

type UserMemoryCardType = "preference" | "constraint" | "pricing" | "style" | "trust" | "interest";

export interface UserMemoryBriefItem {
  cardType: UserMemoryCardType;
  memoryKey: string;
  summary: string;
  strength: number;
  memory: Record<string, unknown>;
  evidenceRefs: string[];
}

export interface UserMemoryBrief {
  userId: string;
  items: UserMemoryBriefItem[];
}

export interface UserMemoryCardListItem extends UserMemoryBriefItem {
  id: string;
  status: "ACTIVE" | "STALE" | "SUPPRESSED" | "EXPIRED";
}

export interface LoadUserMemoryBriefInput {
  userId?: string;
  limit?: number;
  minStrength?: number;
}

interface MemoryCandidate {
  cardType: UserMemoryCardType;
  memoryKey: string;
  summary: string;
  memory: Record<string, unknown>;
  evidenceRef: string;
  strength: number;
  confidence: number;
  ttlDays: number;
}

export interface RecordUserMemoryCardsInput {
  userId?: string;
  sourceKey: string;
  signals: ConversationSignal[];
  metadata?: Record<string, unknown>;
}

export interface RecordUserMemoryCardsResult {
  observed: number;
}

export interface ListUserMemoryCardsInput {
  userId: string;
  includeSuppressed?: boolean;
  limit?: number;
}

export interface SuppressUserMemoryCardInput {
  userId: string;
  cardId: string;
  reason?: string;
}

export interface ResetUserMemoryCardsInput {
  userId: string;
  reason?: string;
}

export interface MemoryControlResult {
  affected: number;
}

const DEFAULT_MEMORY_BRIEF_LIMIT = 6;
const DEFAULT_MEMORY_BRIEF_MIN_STRENGTH = 0.35;

export async function loadUserMemoryBrief(
  db: Database,
  input: LoadUserMemoryBriefInput,
): Promise<UserMemoryBrief | null> {
  if (!input.userId) return null;

  const limit = Math.max(1, Math.min(input.limit ?? DEFAULT_MEMORY_BRIEF_LIMIT, 12));
  const minStrength = Math.max(0, Math.min(input.minStrength ?? DEFAULT_MEMORY_BRIEF_MIN_STRENGTH, 1));

  try {
    const result = await db.execute(sql`
      SELECT
        card_type AS "cardType",
        memory_key AS "memoryKey",
        summary,
        strength::text AS strength,
        memory,
        evidence_refs AS "evidenceRefs"
      FROM user_memory_cards
      WHERE user_id = ${input.userId}
        AND status = 'ACTIVE'
        AND strength >= ${minStrength.toFixed(4)}
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY strength DESC, updated_at DESC
      LIMIT ${limit}
    `);

    const items = rowsFromResult(result)
      .map(rowToBriefItem)
      .filter((item): item is UserMemoryBriefItem => item !== null);
    if (items.length === 0) return null;
    return { userId: input.userId, items };
  } catch (err) {
    console.error("[user-memory-card] failed to load memory brief:", (err as Error).message);
    return null;
  }
}

export function formatUserMemoryBriefSignals(brief?: UserMemoryBrief | null): string[] {
  if (!brief || brief.items.length === 0) return [];

  return [
    "USER_MEMORY_HINTS:non_authoritative",
    ...brief.items.map((item) => {
      const normalizedValue = item.memory.normalizedValue;
      const value = typeof normalizedValue === "string" ? normalizedValue : item.memoryKey;
      return `MEM:${item.cardType}:${value}|strength:${item.strength.toFixed(2)}`;
    }),
  ];
}

export async function listUserMemoryCards(
  db: Database,
  input: ListUserMemoryCardsInput,
): Promise<UserMemoryCardListItem[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const statuses = input.includeSuppressed
    ? ["ACTIVE", "STALE", "SUPPRESSED", "EXPIRED"]
    : ["ACTIVE", "STALE"];

  const result = await db.execute(sql`
    SELECT
      card_type AS "cardType",
      memory_key AS "memoryKey",
      id,
      status,
      summary,
      strength::text AS strength,
      memory,
      evidence_refs AS "evidenceRefs"
    FROM user_memory_cards
    WHERE user_id = ${input.userId}
      AND status = ANY(${statuses}::text[])
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `);

  return rowsFromResult(result)
    .map(rowToListItem)
    .filter((item): item is UserMemoryCardListItem => item !== null);
}

export async function suppressUserMemoryCard(
  db: Database,
  input: SuppressUserMemoryCardInput,
): Promise<MemoryControlResult> {
  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE user_memory_cards
      SET status = 'SUPPRESSED',
          updated_at = NOW()
      WHERE id = ${input.cardId}
        AND user_id = ${input.userId}
        AND status <> 'SUPPRESSED'
      RETURNING id
    ),
    event AS (
      INSERT INTO user_memory_events (
        user_id,
        card_id,
        event_type,
        delta,
        created_at
      )
      SELECT
        ${input.userId},
        id,
        'SUPPRESSED',
        ${JSON.stringify({
          source: "user_memory_control",
          reason: input.reason ?? "user_suppressed",
        })}::jsonb,
        NOW()
      FROM updated
    )
    SELECT id FROM updated
  `);

  return { affected: rowsFromResult(result).length };
}

export async function resetUserMemoryCards(
  db: Database,
  input: ResetUserMemoryCardsInput,
): Promise<MemoryControlResult> {
  const result = await db.execute(sql`
    WITH updated AS (
      UPDATE user_memory_cards
      SET status = 'SUPPRESSED',
          updated_at = NOW()
      WHERE user_id = ${input.userId}
        AND status IN ('ACTIVE', 'STALE')
      RETURNING id
    ),
    event AS (
      INSERT INTO user_memory_events (
        user_id,
        card_id,
        event_type,
        delta,
        created_at
      )
      SELECT
        ${input.userId},
        id,
        'USER_RESET',
        ${JSON.stringify({
          source: "user_memory_control",
          reason: input.reason ?? "user_reset",
        })}::jsonb,
        NOW()
      FROM updated
    )
    SELECT id FROM updated
  `);

  return { affected: rowsFromResult(result).length };
}

export async function recordUserMemoryCards(
  db: Database,
  input: RecordUserMemoryCardsInput,
): Promise<RecordUserMemoryCardsResult> {
  if (!input.userId) return { observed: 0 };

  const candidates = dedupeCandidates(input.signals.flatMap((signal) => candidateFromSignal(signal, input.sourceKey)));
  if (candidates.length === 0) return { observed: 0 };

  let observed = 0;
  for (const candidate of candidates) {
    try {
      const result = await db.execute(sql`
        WITH existing AS (
          SELECT id, evidence_refs ? ${candidate.evidenceRef} AS evidence_seen
          FROM user_memory_cards
          WHERE user_id = ${input.userId}
            AND card_type = ${candidate.cardType}
            AND memory_key = ${candidate.memoryKey}
        ),
        upserted AS (
          INSERT INTO user_memory_cards (
            user_id,
            card_type,
            memory_key,
            status,
            summary,
            memory,
            evidence_refs,
            strength,
            version,
            last_reinforced_at,
            expires_at,
            created_at,
            updated_at
          )
          VALUES (
            ${input.userId},
            ${candidate.cardType},
            ${candidate.memoryKey},
            'ACTIVE',
            ${candidate.summary},
            ${JSON.stringify(candidate.memory)}::jsonb,
            ${JSON.stringify([candidate.evidenceRef])}::jsonb,
            ${candidate.strength.toFixed(4)},
            1,
            NOW(),
            NOW() + (${candidate.ttlDays}::text || ' days')::interval,
            NOW(),
            NOW()
          )
          ON CONFLICT (user_id, card_type, memory_key) DO UPDATE
            SET status = 'ACTIVE',
                summary = EXCLUDED.summary,
                memory = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.memory
                  ELSE user_memory_cards.memory || EXCLUDED.memory
                END,
                evidence_refs = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.evidence_refs
                  ELSE (
                    SELECT COALESCE(jsonb_agg(DISTINCT ref), '[]'::jsonb)
                    FROM jsonb_array_elements_text(user_memory_cards.evidence_refs || EXCLUDED.evidence_refs) AS refs(ref)
                  )
                END,
                strength = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.strength
                  ELSE LEAST(0.9500, user_memory_cards.strength::numeric + 0.0600)
                END,
                version = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.version
                  ELSE user_memory_cards.version + 1
                END,
                last_reinforced_at = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.last_reinforced_at
                  ELSE NOW()
                END,
                expires_at = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.expires_at
                  ELSE GREATEST(user_memory_cards.expires_at, EXCLUDED.expires_at)
                END,
                updated_at = CASE
                  WHEN user_memory_cards.evidence_refs ? ${candidate.evidenceRef}
                    THEN user_memory_cards.updated_at
                  ELSE NOW()
                END
          WHERE NOT (user_memory_cards.evidence_refs ? ${candidate.evidenceRef})
          RETURNING
            id,
            (xmax = 0) AS created,
            NOT COALESCE((SELECT evidence_seen FROM existing), false) AS should_record_event
        )
        INSERT INTO user_memory_events (
          user_id,
          card_id,
          event_type,
          delta,
          confidence,
          created_at
        )
        SELECT
          ${input.userId},
          id,
          CASE WHEN created THEN 'CREATED' ELSE 'REINFORCED' END,
          ${JSON.stringify({
            source: "conversation_signal",
            sourceKey: input.sourceKey,
            metadata: input.metadata ?? {},
          })}::jsonb || ${JSON.stringify({
            cardType: candidate.cardType,
            memoryKey: candidate.memoryKey,
            summary: candidate.summary,
            evidenceRef: candidate.evidenceRef,
          })}::jsonb,
          ${candidate.confidence.toFixed(4)},
          NOW()
        FROM upserted
        WHERE should_record_event
        RETURNING card_id
      `);
      if (resultHasRows(result)) observed++;
    } catch (err) {
      console.error("[user-memory-card] failed to record memory candidate:", (err as Error).message);
    }
  }

  return { observed };
}

function candidateFromSignal(signal: ConversationSignal, sourceKey: string): MemoryCandidate[] {
  if (signal.privacyClass === "private_context") return [];
  if (signal.rolePerspective === "SYSTEM" || signal.rolePerspective === "UNKNOWN") return [];

  switch (signal.type) {
    case "price_resistance":
      return [buildCandidate(signal, sourceKey, "pricing", 90, "pricing boundary")];
    case "deal_blocker":
      return [buildCandidate(signal, sourceKey, "constraint", 180, "deal constraint")];
    case "term_preference":
      return [buildCandidate(signal, sourceKey, "preference", 365, "term preference")];
    case "demand_intent":
      return [buildCandidate(signal, sourceKey, "interest", 120, "shopping intent")];
    default:
      return [];
  }
}

function buildCandidate(
  signal: ConversationSignal,
  sourceKey: string,
  cardType: UserMemoryCardType,
  ttlDays: number,
  label: string,
): MemoryCandidate {
  const role = signal.rolePerspective.toLowerCase();
  const memoryKey = [signal.type, signal.entityType, signal.normalizedValue].join(":");
  return {
    cardType,
    memoryKey,
    summary: `${role} ${label}: ${signal.normalizedValue}`,
    memory: {
      signalType: signal.type,
      entityType: signal.entityType,
      normalizedValue: signal.normalizedValue,
      rolePerspective: signal.rolePerspective,
      privacyClass: signal.privacyClass,
      marketUsefulness: signal.marketUsefulness,
      lastEvidence: evidencePointer(signal, sourceKey),
    },
    evidenceRef: evidenceRef(signal, sourceKey),
    strength: initialStrength(signal.confidence),
    confidence: signal.confidence,
    ttlDays,
  };
}

function dedupeCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>();
  const out: MemoryCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.cardType}:${candidate.memoryKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }

  return out;
}

function evidencePointer(signal: ConversationSignal, sourceKey: string): Record<string, unknown> {
  return {
    sourceKey,
    messageId: signal.evidence.messageId,
    start: signal.evidence.start,
    end: signal.evidence.end,
    textHash: signal.evidence.textHash,
    rawTextAvailable: signal.evidence.rawTextAvailable === true,
  };
}

function evidenceRef(signal: ConversationSignal, sourceKey: string): string {
  const start = signal.evidence.start ?? "na";
  const end = signal.evidence.end ?? "na";
  return `${sourceKey}#${start}-${end}`;
}

function initialStrength(confidence: number): number {
  return Math.max(0.35, Math.min(0.7, 0.3 + confidence * 0.4));
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

function rowsFromResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object") {
    const rows = (result as { rows?: unknown[] }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

function rowToBriefItem(row: Record<string, unknown>): UserMemoryBriefItem | null {
  const cardType = row.cardType;
  const memoryKey = row.memoryKey;
  const summary = row.summary;
  if (!isUserMemoryCardType(cardType) || typeof memoryKey !== "string" || typeof summary !== "string") {
    return null;
  }

  return {
    cardType,
    memoryKey,
    summary,
    strength: parseStrength(row.strength),
    memory: isRecord(row.memory) ? row.memory : {},
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? row.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
      : [],
  };
}

function rowToListItem(row: Record<string, unknown>): UserMemoryCardListItem | null {
  const item = rowToBriefItem(row);
  if (!item || typeof row.id !== "string" || !isUserMemoryCardStatus(row.status)) {
    return null;
  }

  return {
    ...item,
    id: row.id,
    status: row.status,
  };
}

function parseStrength(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed, 1));
}

function isUserMemoryCardType(value: unknown): value is UserMemoryCardType {
  return value === "preference"
    || value === "constraint"
    || value === "pricing"
    || value === "style"
    || value === "trust"
    || value === "interest";
}

function isUserMemoryCardStatus(value: unknown): value is UserMemoryCardListItem["status"] {
  return value === "ACTIVE" || value === "STALE" || value === "SUPPRESSED" || value === "EXPIRED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
