import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import {
  extractConversationSignals,
  type ConversationSignal,
  type RolePerspective,
} from "./conversation-signal-extractor.js";
import { queueProposedTags } from "./tag-placement.service.js";
import type { ProposedTag } from "./tag-placement-llm.service.js";
import { recordTermCandidates } from "./term-intelligence.service.js";
import { recordUserMemoryCards } from "./user-memory-card.service.js";

export interface RecordConversationSignalsInput {
  sessionId: string;
  roundId?: string;
  roundNo?: number;
  listingId?: string;
  userId?: string;
  rolePerspective: RolePerspective;
  text: string;
  sourceMessageId?: string;
  sourceLabel?: "incoming" | "outgoing" | "system";
  metadata?: Record<string, unknown>;
}

export interface RecordConversationSignalsResult {
  extracted: number;
  inserted: number;
}

export interface RecordRoundConversationSignalsInput {
  sessionId: string;
  roundId: string;
  roundNo: number;
  listingId: string;
  buyerId: string;
  sellerId: string;
  incomingRole: "BUYER" | "SELLER";
  agentRole: "BUYER" | "SELLER";
  incomingText: string;
  outgoingText: string;
  engine: string;
  idempotencyKey?: string;
  decision?: string;
}

export interface RecordRoundConversationSignalsResult {
  incoming: RecordConversationSignalsResult;
  outgoing: RecordConversationSignalsResult;
}

interface InsertMarketSignalsResult {
  inserted: number;
  insertedSignals: ConversationSignal[];
}

export async function recordConversationSignalsForRound(
  db: Database,
  input: RecordConversationSignalsInput,
): Promise<RecordConversationSignalsResult> {
  try {
    const signals = extractConversationSignals({
      text: input.text,
      rolePerspective: input.rolePerspective,
      sourceRoundNo: input.roundNo,
      sourceMessageId: input.sourceMessageId,
    });

    if (signals.length === 0) {
      return { extracted: 0, inserted: 0 };
    }

    const sourceKey = input.sourceMessageId ?? buildSourceKey(input);
    const rawTextHash = hashText(input.text);
    const sourceLabel = input.sourceLabel ?? "system";
    const signalsWithSource = signals.map((signal) => attachSourceEvidence(signal, sourceKey));

    await upsertSignalSource(db, input, sourceKey, sourceLabel, rawTextHash);
    const marketInsert = await insertMarketSignals(db, input, signalsWithSource, sourceKey);

    await queueTagCandidates(db, input, marketInsert.insertedSignals);
    await recordTermCandidates(db, {
      sessionId: input.sessionId,
      roundNo: input.roundNo,
      listingId: input.listingId,
      sourceKey,
      signals: signalsWithSource,
      metadata: input.metadata,
    });
    await recordUserMemoryCards(db, {
      userId: input.userId,
      sourceKey,
      signals: signalsWithSource,
      metadata: input.metadata,
    });

    return { extracted: signals.length, inserted: marketInsert.inserted };
  } catch (err) {
    console.error("[conversation-signal-sink] failed to record signals:", (err as Error).message);
    return { extracted: 0, inserted: 0 };
  }
}

export async function recordRoundConversationSignals(
  db: Database,
  input: RecordRoundConversationSignalsInput,
): Promise<RecordRoundConversationSignalsResult> {
  const incoming = await recordConversationSignalsForRound(db, {
    sessionId: input.sessionId,
    roundId: input.roundId,
    roundNo: input.roundNo,
    listingId: input.listingId,
    userId: userIdForRole(input, input.incomingRole),
    rolePerspective: input.incomingRole,
    text: input.incomingText,
    sourceMessageId: `${input.roundId}:incoming`,
    sourceLabel: "incoming",
    metadata: {
      engine: input.engine,
      idempotency_key: input.idempotencyKey,
    },
  });

  const outgoing = await recordConversationSignalsForRound(db, {
    sessionId: input.sessionId,
    roundId: input.roundId,
    roundNo: input.roundNo,
    listingId: input.listingId,
    userId: userIdForRole(input, input.agentRole),
    rolePerspective: input.agentRole,
    text: input.outgoingText,
    sourceMessageId: `${input.roundId}:outgoing`,
    sourceLabel: "outgoing",
    metadata: {
      engine: input.engine,
      decision: input.decision,
    },
  });

  return { incoming, outgoing };
}

const RAW_EVIDENCE_ACCESS_POLICY = {
  allowedPurposes: ["debugging", "audit"] as Array<"debugging" | "audit">,
  reasonRequired: true,
  marketUseAllowed: false,
  memoryUseAllowed: false,
  tagUseAllowed: false,
};

async function queueTagCandidates(
  db: Database,
  input: RecordConversationSignalsInput,
  signals: ConversationSignal[],
): Promise<number> {
  const proposed: ProposedTag[] = signals
    .filter((signal) => signal.type === "tag_candidate")
    .map((signal) => ({
      label: signal.normalizedValue.replace(/_/g, "-"),
      category: mapSignalToTagCategory(signal),
      reason: `conversation ${signal.entityType} signal (${signal.confidence.toFixed(2)})`,
    }));

  if (proposed.length === 0) return 0;
  return queueProposedTags(db, proposed, input.listingId ?? null);
}

function mapSignalToTagCategory(signal: ConversationSignal): ProposedTag["category"] {
  switch (signal.entityType) {
    case "storage":
      return "size";
    case "color":
      return "style";
    case "carrier":
      return "compatibility";
    case "screen":
    case "battery":
    case "packaging":
    case "cosmetic":
    case "verification":
      return "condition";
    default:
      return "other";
  }
}

function mapSignalToInsert(
  input: RecordConversationSignalsInput,
  signal: ConversationSignal,
  sourceKey: string,
): Record<string, unknown> {
  return {
    signalKey: buildSignalKey(sourceKey, signal),
    sessionId: input.sessionId,
    roundId: input.roundId,
    roundNo: input.roundNo,
    listingId: input.listingId,
    userId: input.userId,
    rolePerspective: signal.rolePerspective,
    signalType: signal.type,
    entityType: signal.entityType,
    entityValue: signal.entityValue,
    normalizedValue: signal.normalizedValue,
    confidence: signal.confidence.toFixed(4),
    extractionMethod: signal.method,
    privacyClass: signal.privacyClass,
    marketUsefulness: signal.marketUsefulness,
    evidence: {
      ...signal.evidence,
    },
    metadata: {
      ...signal.metadata,
      ...input.metadata,
      source_label: input.sourceLabel,
    },
  };
}

async function upsertSignalSource(
  db: Database,
  input: RecordConversationSignalsInput,
  sourceKey: string,
  sourceLabel: "incoming" | "outgoing" | "system",
  rawTextHash: string,
): Promise<void> {
  const result = await db.execute(sql`
    INSERT INTO conversation_signal_sources (
      source_key,
      session_id,
      round_id,
      round_no,
      listing_id,
      user_id,
      role_perspective,
      source_label,
      raw_text,
      raw_text_hash,
      raw_access_policy
    )
    VALUES (
      ${sourceKey},
      ${input.sessionId},
      ${input.roundId ?? null},
      ${input.roundNo ?? null},
      ${input.listingId ?? null},
      ${input.userId ?? null},
      ${input.rolePerspective},
      ${sourceLabel},
      ${input.text},
      ${rawTextHash},
      ${JSON.stringify(RAW_EVIDENCE_ACCESS_POLICY)}::jsonb
    )
    ON CONFLICT (source_key) DO UPDATE
      SET raw_access_policy = conversation_signal_sources.raw_access_policy
      WHERE conversation_signal_sources.raw_text_hash = EXCLUDED.raw_text_hash
    RETURNING source_key
  `);

  if (!resultHasRows(result)) {
    throw new Error(`SOURCE_KEY_HASH_MISMATCH: ${sourceKey}`);
  }
}

async function insertMarketSignals(
  db: Database,
  input: RecordConversationSignalsInput,
  signals: ConversationSignal[],
  sourceKey: string,
): Promise<InsertMarketSignalsResult> {
  let inserted = 0;
  const insertedSignals: ConversationSignal[] = [];

  for (const signal of signals) {
    const row = mapSignalToInsert(input, signal, sourceKey);
    const result = await db.execute(sql`
      INSERT INTO conversation_market_signals (
        signal_key,
        session_id,
        round_id,
        round_no,
        listing_id,
        user_id,
        role_perspective,
        signal_type,
        entity_type,
        entity_value,
        normalized_value,
        confidence,
        extraction_method,
        privacy_class,
        market_usefulness,
        evidence,
        metadata
      )
      VALUES (
        ${row.signalKey},
        ${row.sessionId ?? null},
        ${row.roundId ?? null},
        ${row.roundNo ?? null},
        ${row.listingId ?? null},
        ${row.userId ?? null},
        ${row.rolePerspective},
        ${row.signalType},
        ${row.entityType},
        ${row.entityValue},
        ${row.normalizedValue},
        ${row.confidence},
        ${row.extractionMethod},
        ${row.privacyClass},
        ${row.marketUsefulness},
        ${JSON.stringify(row.evidence)}::jsonb,
        ${JSON.stringify(row.metadata ?? {})}::jsonb
      )
      ON CONFLICT (signal_key) DO NOTHING
      RETURNING signal_key
    `);

    if (resultHasRows(result)) {
      inserted++;
      insertedSignals.push(signal);
    }
  }

  return { inserted, insertedSignals };
}

function attachSourceEvidence(signal: ConversationSignal, sourceKey: string): ConversationSignal {
  return {
    ...signal,
    evidence: {
      ...signal.evidence,
      sourceKey,
      rawTextAvailable: true,
    },
  };
}

function buildSourceKey(input: RecordConversationSignalsInput): string {
  return [
    input.sessionId,
    input.roundId ?? "no-round",
    input.roundNo ?? "no-round-no",
    input.sourceLabel ?? "system",
    hashText(input.text).slice(0, 16),
  ].join(":");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildSignalKey(sourceKey: string, signal: ConversationSignal): string {
  return [
    sourceKey,
    signal.type,
    signal.entityType,
    signal.normalizedValue,
    signal.evidence.start ?? "na",
    signal.evidence.end ?? "na",
  ].join(":");
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

function userIdForRole(input: RecordRoundConversationSignalsInput, role: "BUYER" | "SELLER"): string {
  return role === "BUYER" ? input.buyerId : input.sellerId;
}
