import { createHash, randomUUID, type KeyObject } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import { canonicalDisputeAuditJson, disputeAiAuditAdvisoryLockKey, listDisputeAiAssessmentEvents,
  verifyDisputeAiAssessmentEventChain } from "./dispute-ai-assessment-event.service.js";
import { createSignedDisputeAiAuditExport, DisputeAuditSigningNotConfiguredError } from "./dispute-ai-audit-export.service.js";
import {
  resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv,
  type DisputeSimilarityReviewAuditArchiveConfig as DisputeAiAuditArchiveConfig,
} from "./dispute-similarity-review-audit-archive.service.js";

export type { DisputeAiAuditArchiveConfig };

export interface DisputeAiAuditArchiveRecord {
  id: string;
  archiveKey: string;
  disputeId: string;
  eventCount: number;
  eventsSha256: string;
  chainHeadEventHash: string | null;
  payload: Record<string, unknown>;
  payloadSha256: string;
  status: "PENDING" | "PROCESSING" | "DELIVERED" | "FAILED" | "DEAD_LETTER";
  attemptCount: number;
  nextAttemptAt: string;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  httpStatus: number | null;
  receiptId: string | null;
  receiptSha256: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DisputeAiAuditArchiveHealth {
  status: "healthy" | "attention" | "critical";
  pending: number; processing: number; failed: number; deadLetter: number;
  staleProcessing: number; retryReady: number; overdueUnfinished: number;
  unfinishedMaxAgeMinutes: number; oldestUnfinishedAgeSeconds: number | null; recordedAt: string;
}
export interface DisputeAiAuditArchiveCoverage {
  status: "healthy" | "attention" | "critical";
  totalChains: number; eligibleChains: number; archivedCurrent: number; eligibleUnarchived: number;
  overdueEligibleUnarchived: number; blockedUnsealed: number; blockedOversized: number;
  coveragePercent: number; oldestUnarchivedAgeSeconds: number | null;
  coverageMaxAgeMinutes: number; maxExportEvents: number; recordedAt: string;
}
export interface DisputeAiAuditDiscoveryFailureHealth {
  status: "healthy" | "attention" | "critical"; open: number; retryRequested: number; unresolved: number; invalidChain: number;
  tooLarge: number; unsealed: number; resolvedLast24h: number; oldestOpenAgeSeconds: number | null; recordedAt: string;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getDisputeAiAuditArchivePolicyStatus() {
  const url = process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim();
  const signing = Boolean(process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim());
  let configurationState: "not_configured" | "partial" | "invalid" | "valid" = !url && !signing
    ? "not_configured" : !url || !signing ? "partial" : "valid";
  if (configurationState === "valid") {
    try { resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv(); } catch { configurationState = "invalid"; }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_DISPUTE_AI_AUDIT_ARCHIVE_JOB === "true",
    maxExportEvents: boundedInteger(process.env.DISPUTE_AI_AUDIT_ARCHIVE_MAX_EVENTS, 10_000, 1, 100_000),
    unfinishedMaxAgeMinutes: boundedInteger(process.env.DISPUTE_AI_AUDIT_ARCHIVE_UNFINISHED_MAX_AGE_MINUTES, 15, 1, 10_080),
    coverageMaxAgeMinutes: boundedInteger(process.env.DISPUTE_AI_AUDIT_ARCHIVE_COVERAGE_MAX_AGE_MINUTES, 15, 1, 10_080),
  };
}

function mapRow(row: Record<string, unknown>): DisputeAiAuditArchiveRecord {
  return {
    id: String(row.id), archiveKey: String(row.archive_key), disputeId: String(row.dispute_id),
    eventCount: Number(row.event_count), eventsSha256: String(row.events_sha256),
    chainHeadEventHash: row.chain_head_event_hash ? String(row.chain_head_event_hash) : null,
    payload: row.payload as Record<string, unknown>, payloadSha256: String(row.payload_sha256),
    status: String(row.status) as DisputeAiAuditArchiveRecord["status"], attemptCount: Number(row.attempt_count),
    nextAttemptAt: new Date(String(row.next_attempt_at)).toISOString(),
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at ? new Date(String(row.lease_expires_at)).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
    receiptId: row.receipt_id ? String(row.receipt_id) : null,
    receiptSha256: row.receipt_sha256 ? String(row.receipt_sha256) : null,
    deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getDisputeAiAuditArchiveHealth(db: Database, now = new Date()): Promise<DisputeAiAuditArchiveHealth> {
  const policy = getDisputeAiAuditArchivePolicyStatus();
  const overdueAt = new Date(now.getTime() - policy.unfinishedMaxAgeMinutes * 60_000);
  const rows = await db.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
      count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE status = 'DEAD_LETTER')::int AS dead_letter,
      count(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at <= ${now.toISOString()}::timestamptz)::int AS stale_processing,
      count(*) FILTER (WHERE status = 'FAILED' AND next_attempt_at <= ${now.toISOString()}::timestamptz)::int AS retry_ready,
      count(*) FILTER (WHERE status <> 'DELIVERED' AND created_at <= ${overdueAt.toISOString()}::timestamptz)::int AS overdue_unfinished,
      extract(epoch FROM (${now.toISOString()}::timestamptz - min(created_at) FILTER (WHERE status <> 'DELIVERED')))::int AS oldest_unfinished_age_seconds
    FROM dispute_ai_audit_outbox
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const deadLetter = Number(row.dead_letter ?? 0);
  const staleProcessing = Number(row.stale_processing ?? 0);
  const failed = Number(row.failed ?? 0);
  const overdueUnfinished = Number(row.overdue_unfinished ?? 0);
  return {
    status: deadLetter > 0 ? "critical" : staleProcessing > 0 || failed > 0 || overdueUnfinished > 0 ? "attention" : "healthy",
    pending: Number(row.pending ?? 0), processing: Number(row.processing ?? 0), failed, deadLetter,
    staleProcessing, retryReady: Number(row.retry_ready ?? 0), overdueUnfinished,
    unfinishedMaxAgeMinutes: policy.unfinishedMaxAgeMinutes,
    oldestUnfinishedAgeSeconds: row.oldest_unfinished_age_seconds == null ? null : Math.max(0, Number(row.oldest_unfinished_age_seconds)),
    recordedAt: now.toISOString(),
  };
}

export async function getDisputeAiAuditArchiveCoverage(db: Database, now = new Date()): Promise<DisputeAiAuditArchiveCoverage> {
  const policy = getDisputeAiAuditArchivePolicyStatus();
  const overdueAt = new Date(now.getTime() - policy.coverageMaxAgeMinutes * 60_000);
  const rows = await db.execute(sql`
    WITH event_chains AS (
      SELECT dispute_id, count(*)::int AS event_count, bool_and(event_hash IS NOT NULL) AS fully_sealed,
        min(created_at) AS first_event_at, max(created_at) AS last_event_at
      FROM dispute_ai_assessment_events GROUP BY dispute_id
    ), coverage AS (
      SELECT chain.*,
        EXISTS (SELECT 1 FROM dispute_ai_audit_outbox archive
          WHERE archive.dispute_id = chain.dispute_id AND archive.event_count = chain.event_count) AS archived_current
      FROM event_chains chain
    )
    SELECT count(*)::int AS total_chains,
      count(*) FILTER (WHERE fully_sealed AND event_count <= ${policy.maxExportEvents})::int AS eligible_chains,
      count(*) FILTER (WHERE fully_sealed AND event_count <= ${policy.maxExportEvents} AND archived_current)::int AS archived_current,
      count(*) FILTER (WHERE fully_sealed AND event_count <= ${policy.maxExportEvents} AND NOT archived_current)::int AS eligible_unarchived,
      count(*) FILTER (WHERE fully_sealed AND event_count <= ${policy.maxExportEvents} AND NOT archived_current
        AND last_event_at <= ${overdueAt.toISOString()}::timestamptz)::int AS overdue_eligible_unarchived,
      count(*) FILTER (WHERE NOT fully_sealed)::int AS blocked_unsealed,
      count(*) FILTER (WHERE fully_sealed AND event_count > ${policy.maxExportEvents})::int AS blocked_oversized,
      extract(epoch FROM (${now.toISOString()}::timestamptz - min(last_event_at) FILTER
        (WHERE fully_sealed AND event_count <= ${policy.maxExportEvents} AND NOT archived_current)))::int AS oldest_unarchived_age_seconds
    FROM coverage
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const eligibleChains = Number(row.eligible_chains ?? 0);
  const archivedCurrent = Number(row.archived_current ?? 0);
  const eligibleUnarchived = Number(row.eligible_unarchived ?? 0);
  const overdueEligibleUnarchived = Number(row.overdue_eligible_unarchived ?? 0);
  const blockedUnsealed = Number(row.blocked_unsealed ?? 0);
  const blockedOversized = Number(row.blocked_oversized ?? 0);
  return {
    status: overdueEligibleUnarchived > 0 || blockedOversized > 0 ? "critical"
      : eligibleUnarchived > 0 || blockedUnsealed > 0 ? "attention" : "healthy",
    totalChains: Number(row.total_chains ?? 0), eligibleChains, archivedCurrent, eligibleUnarchived,
    overdueEligibleUnarchived, blockedUnsealed, blockedOversized,
    coveragePercent: eligibleChains === 0 ? 100 : Math.round((archivedCurrent / eligibleChains) * 10_000) / 100,
    oldestUnarchivedAgeSeconds: row.oldest_unarchived_age_seconds == null ? null : Math.max(0, Number(row.oldest_unarchived_age_seconds)),
    coverageMaxAgeMinutes: policy.coverageMaxAgeMinutes, maxExportEvents: policy.maxExportEvents, recordedAt: now.toISOString(),
  };
}

export async function getDisputeAiAuditDiscoveryFailureHealth(
  db: Database, now = new Date(),
): Promise<DisputeAiAuditDiscoveryFailureHealth> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
  const rows = await db.execute(sql`
    SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open,
      count(*) FILTER (WHERE status = 'RETRY_REQUESTED')::int AS retry_requested,
      count(*) FILTER (WHERE status IN ('OPEN', 'RETRY_REQUESTED'))::int AS unresolved,
      count(*) FILTER (WHERE status IN ('OPEN', 'RETRY_REQUESTED') AND failure_code = 'AI_AUDIT_CHAIN_INVALID')::int AS invalid_chain,
      count(*) FILTER (WHERE status IN ('OPEN', 'RETRY_REQUESTED') AND failure_code = 'AI_AUDIT_ARCHIVE_TOO_LARGE')::int AS too_large,
      count(*) FILTER (WHERE status IN ('OPEN', 'RETRY_REQUESTED') AND failure_code = 'AI_AUDIT_CHAIN_UNSEALED')::int AS unsealed,
      count(*) FILTER (WHERE status = 'RESOLVED' AND resolved_at >= ${dayAgo.toISOString()}::timestamptz)::int AS resolved_last_24h,
      extract(epoch FROM (${now.toISOString()}::timestamptz - min(first_failed_at) FILTER (WHERE status IN ('OPEN', 'RETRY_REQUESTED'))))::int AS oldest_open_age_seconds
    FROM dispute_ai_audit_discovery_failures
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const open = Number(row.open ?? 0); const retryRequested = Number(row.retry_requested ?? 0);
  const unresolved = Number(row.unresolved ?? 0); const tooLarge = Number(row.too_large ?? 0);
  return { status: tooLarge > 0 ? "critical" : unresolved > 0 ? "attention" : "healthy", open, retryRequested, unresolved,
    invalidChain: Number(row.invalid_chain ?? 0), tooLarge, unsealed: Number(row.unsealed ?? 0),
    resolvedLast24h: Number(row.resolved_last_24h ?? 0),
    oldestOpenAgeSeconds: row.oldest_open_age_seconds == null ? null : Math.max(0, Number(row.oldest_open_age_seconds)),
    recordedAt: now.toISOString() };
}

interface DiscoveryFailureCursor { lastFailedAt: string; id: string }
function decodeDiscoveryFailureCursor(value: string): DiscoveryFailureCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DiscoveryFailureCursor>;
    if (typeof parsed.lastFailedAt !== "string" || !Number.isFinite(Date.parse(parsed.lastFailedAt))
      || typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error("invalid");
    return { lastFailedAt: new Date(parsed.lastFailedAt).toISOString(), id: parsed.id };
  } catch { throw new Error("INVALID_AI_AUDIT_DISCOVERY_FAILURE_CURSOR"); }
}
function encodeDiscoveryFailureCursor(value: DiscoveryFailureCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function listDisputeAiAuditDiscoveryFailures(
  db: Database, input: { limit?: number; cursor?: string; now?: Date } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_AI_AUDIT_DISCOVERY_FAILURE_LIMIT");
  const cursor = input.cursor ? decodeDiscoveryFailureCursor(input.cursor) : null;
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`
    SELECT id, dispute_id, event_count, failure_code, status, attempt_count, first_failed_at, last_failed_at
    FROM dispute_ai_audit_discovery_failures WHERE status IN ('OPEN', 'RETRY_REQUESTED')
      ${cursor ? sql`AND (last_failed_at, id) > (${cursor.lastFailedAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY last_failed_at ASC, id ASC LIMIT ${limit + 1}
  `) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit; const selected = hasMore ? rows.slice(0, limit) : rows;
  const items = selected.map((row) => ({ id: String(row.id), disputeId: String(row.dispute_id),
    status: String(row.status) as "OPEN" | "RETRY_REQUESTED",
    eventCount: Number(row.event_count), failureCode: String(row.failure_code), attemptCount: Number(row.attempt_count),
    firstFailedAt: new Date(String(row.first_failed_at)).toISOString(), lastFailedAt: new Date(String(row.last_failed_at)).toISOString(),
    ageSeconds: Math.max(0, Math.floor((now.getTime() - new Date(String(row.first_failed_at)).getTime()) / 1000)) }));
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeDiscoveryFailureCursor({ lastFailedAt: last.lastFailedAt, id: last.id }) : null,
    recordedAt: now.toISOString() };
}

export async function retryDisputeAiAuditDiscoveryFailure(
  db: Database, input: { disputeId: string; eventCount: number; actorId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 500) return { outcome: "invalid_reason" as const };
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM dispute_ai_audit_discovery_failures
      WHERE dispute_id = ${input.disputeId}::uuid AND event_count = ${input.eventCount} FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) return { outcome: "not_found" as const };
    if (rows[0].status === "RESOLVED") return { outcome: "already_resolved" as const };
    if (rows[0].status === "RETRY_REQUESTED") return { outcome: "retry_already_requested" as const };
    await tx.execute(sql`
      UPDATE dispute_ai_audit_discovery_failures SET status = 'RETRY_REQUESTED', resolved_at = NULL,
        updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${String(rows[0].id)}::uuid AND status = 'OPEN'
    `);
    await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (${input.actorId}::uuid, 'dispute.ai_audit_discovery_retry', 'dispute_ai_audit_discovery_failures', ${String(rows[0].id)},
        jsonb_build_object('dispute_id', ${input.disputeId}::text, 'event_count', ${input.eventCount}::int,
          'failure_code', ${String(rows[0].failure_code)}::text, 'attempt_count', ${Number(rows[0].attempt_count)}::int,
          'reason', ${reason}::text), ${now.toISOString()}::timestamptz)
    `);
    return { outcome: "retry_enabled" as const };
  });
}

interface FailureCursor { createdAt: string; id: string }
function decodeFailureCursor(value: string): FailureCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<FailureCursor>;
    if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error("invalid");
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { throw new Error("INVALID_AI_AUDIT_ARCHIVE_FAILURE_CURSOR"); }
}
function encodeFailureCursor(value: FailureCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function listDisputeAiAuditArchiveFailures(db: Database, input: { limit?: number; cursor?: string; now?: Date } = {}) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_AI_AUDIT_ARCHIVE_FAILURE_LIMIT");
  const cursor = input.cursor ? decodeFailureCursor(input.cursor) : null;
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`
    SELECT * FROM dispute_ai_audit_outbox WHERE status IN ('FAILED', 'DEAD_LETTER')
      ${cursor ? sql`AND (created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
    ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}
  `) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const records = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
  const items = records.map((record) => ({
    id: record.id, disputeId: record.disputeId, eventCount: record.eventCount,
    eventsSha256: record.eventsSha256, payloadSha256: record.payloadSha256,
    status: record.status, attemptCount: record.attemptCount, nextAttemptAt: record.nextAttemptAt,
    lastError: record.lastError?.slice(0, 500) ?? null, httpStatus: record.httpStatus,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    failureAgeSeconds: Math.max(0, Math.floor((now.getTime() - new Date(record.updatedAt).getTime()) / 1000)),
  }));
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeFailureCursor({ createdAt: last.createdAt, id: last.id }) : null, recordedAt: now.toISOString() };
}

export async function requeueDisputeAiAuditArchive(
  db: Database,
  input: { archiveId: string; actorId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 500) return { outcome: "invalid_reason" as const };
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`SELECT * FROM dispute_ai_audit_outbox WHERE id = ${input.archiveId}::uuid FOR UPDATE`) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) return { outcome: "not_found" as const };
    const current = mapRow(rows[0]);
    if (current.status === "PENDING" || current.status === "PROCESSING") return { outcome: "already_queued" as const, archive: current };
    if (current.status === "DELIVERED") return { outcome: "already_delivered" as const, archive: current };
    const updated = await tx.execute(sql`
      UPDATE dispute_ai_audit_outbox SET status = 'PENDING', attempt_count = 0,
        next_attempt_at = ${now.toISOString()}::timestamptz, lease_token = NULL, lease_expires_at = NULL,
        last_error = NULL, http_status = NULL, receipt_id = NULL, receipt_sha256 = NULL,
        delivered_at = NULL, updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${current.id}::uuid AND status IN ('FAILED', 'DEAD_LETTER') RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    if (!updated[0]) throw new Error("AI_AUDIT_ARCHIVE_REQUEUE_CONFLICT");
    await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (${input.actorId}::uuid, 'dispute.ai_audit_archive_requeue', 'dispute_ai_audit_outbox', ${current.id},
        jsonb_build_object('dispute_id', ${current.disputeId}::text, 'event_count', ${current.eventCount}::int,
          'previous_status', ${current.status}::text, 'previous_attempt_count', ${current.attemptCount}::int, 'reason', ${reason}::text),
        ${now.toISOString()}::timestamptz)
    `);
    return { outcome: "requeued" as const, archive: mapRow(updated[0]) };
  });
}

async function buildDisputeAiAuditSnapshot(db: Database, input: { disputeId: string; now: Date; privateKey?: KeyObject }) {
  const maxEvents = getDisputeAiAuditArchivePolicyStatus().maxExportEvents;
  const newestFirst = await listDisputeAiAssessmentEvents(db, input.disputeId, maxEvents + 1);
  if (newestFirst.length === 0) throw new Error("AI_AUDIT_ARCHIVE_NO_EVENTS");
  if (newestFirst.length > maxEvents) throw new Error("AI_AUDIT_ARCHIVE_TOO_LARGE");
  const events = [...newestFirst].reverse();
  const chain = verifyDisputeAiAssessmentEventChain(events);
  const genesisVerified = !events[0]?.eventHash || events[0].previousEventHash === null;
  if (!chain.valid || !genesisVerified) throw new Error("AI_AUDIT_CHAIN_INVALID");
  if (chain.legacy_unsealed_events > 0) throw new Error("AI_AUDIT_CHAIN_UNSEALED");
  const auditExport = createSignedDisputeAiAuditExport({
    disputeId: input.disputeId,
    events,
    generatedAt: input.now,
    privateKey: input.privateKey,
    chain: {
      valid: true, complete: true, headEventHash: chain.head_event_hash,
      sealedEvents: chain.sealed_events, legacyUnsealedEvents: chain.legacy_unsealed_events,
    },
  });
  return auditExport;
}

export async function enqueueDisputeAiAuditArchive(
  db: Database,
  input: { disputeId: string; now?: Date; privateKey?: KeyObject },
) {
  const now = input.now ?? new Date();
  const payload = await buildDisputeAiAuditSnapshot(db, { disputeId: input.disputeId, now, privateKey: input.privateKey });
  const payloadRecord = payload as unknown as Record<string, unknown>;
  const payloadSha256 = createHash("sha256").update(canonicalDisputeAuditJson(payloadRecord)).digest("hex");
  const archiveKey = `dai_${createHash("sha256").update([
    input.disputeId, payload.manifest.event_count, payload.manifest.events_sha256,
    payload.manifest.chain_head_event_hash ?? "none",
  ].join(":")).digest("hex")}`;
  const inserted = await db.execute(sql`
    INSERT INTO dispute_ai_audit_outbox
      (archive_key, dispute_id, event_count, events_sha256, chain_head_event_hash,
       payload, payload_sha256, status, attempt_count, next_attempt_at, created_at, updated_at)
    VALUES (${archiveKey}, ${input.disputeId}::uuid, ${payload.manifest.event_count}, ${payload.manifest.events_sha256},
            ${payload.manifest.chain_head_event_hash}, ${JSON.stringify(payloadRecord)}::jsonb, ${payloadSha256},
            'PENDING', 0, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    ON CONFLICT (archive_key) DO NOTHING RETURNING *
  `) as unknown as Array<Record<string, unknown>>;
  if (inserted[0]) return { outcome: "enqueued" as const, archive: mapRow(inserted[0]) };
  const existing = await db.execute(sql`SELECT * FROM dispute_ai_audit_outbox WHERE archive_key = ${archiveKey}`) as unknown as Array<Record<string, unknown>>;
  if (!existing[0]) throw new Error("AI_AUDIT_ARCHIVE_IDEMPOTENCY_LOOKUP_FAILED");
  return { outcome: "duplicate" as const, archive: mapRow(existing[0]) };
}

export async function getLatestDisputeAiAuditArchive(db: Database, disputeId: string) {
  const rows = await db.execute(sql`
    SELECT * FROM dispute_ai_audit_outbox WHERE dispute_id = ${disputeId}::uuid
     ORDER BY event_count DESC, created_at DESC, id DESC LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function enqueuePendingDisputeAiAudits(
  db: Database,
  input: { limit?: number; now?: Date; privateKey?: KeyObject } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const scanLimit = Math.min(limit * 4, 400);
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`
    WITH snapshots AS (
      SELECT event.dispute_id, count(*)::int AS event_count, min(event.created_at) AS first_event_at
        FROM dispute_ai_assessment_events event
       GROUP BY event.dispute_id
      HAVING bool_and(event.event_hash IS NOT NULL)
    )
    SELECT snapshot.dispute_id AS "disputeId", snapshot.event_count AS "eventCount"
      FROM snapshots snapshot
     WHERE NOT EXISTS (
       SELECT 1 FROM dispute_ai_audit_outbox archive
        WHERE archive.dispute_id = snapshot.dispute_id AND archive.event_count = snapshot.event_count
     )
       AND NOT EXISTS (
         SELECT 1 FROM dispute_ai_audit_discovery_failures failure
          WHERE failure.dispute_id = snapshot.dispute_id AND failure.event_count = snapshot.event_count
            AND failure.status = 'OPEN'
       )
     ORDER BY snapshot.first_event_at ASC LIMIT ${scanLimit}
  `) as unknown as Array<{ disputeId: string; eventCount: number }>;
  let discovered = 0; let enqueued = 0; let isolated = 0; let contended = 0; let stale = 0;
  for (const row of rows) {
    if (enqueued + isolated >= limit) break;
    discovered += 1;
    const outcome = await db.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      const lockRows = await tx.execute(sql`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${disputeAiAuditAdvisoryLockKey(row.disputeId)}, 0)) AS acquired
      `) as unknown as Array<{ acquired: boolean }>;
      if (lockRows[0]?.acquired !== true) return "contended" as const;
      const eligibleRows = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM (
            SELECT count(*)::int AS event_count, bool_and(event_hash IS NOT NULL) AS fully_sealed
              FROM dispute_ai_assessment_events WHERE dispute_id = ${row.disputeId}::uuid
          ) snapshot
          WHERE snapshot.event_count = ${row.eventCount} AND snapshot.fully_sealed
            AND NOT EXISTS (SELECT 1 FROM dispute_ai_audit_outbox archive
              WHERE archive.dispute_id = ${row.disputeId}::uuid AND archive.event_count = ${row.eventCount})
            AND NOT EXISTS (SELECT 1 FROM dispute_ai_audit_discovery_failures failure
              WHERE failure.dispute_id = ${row.disputeId}::uuid AND failure.event_count = ${row.eventCount}
                AND failure.status = 'OPEN')
        ) AS eligible
      `) as unknown as Array<{ eligible: boolean }>;
      if (eligibleRows[0]?.eligible !== true) return "stale" as const;
      try {
        const result = await enqueueDisputeAiAuditArchive(tx, {
          disputeId: row.disputeId, now, privateKey: input.privateKey,
        });
        await tx.execute(sql`
          UPDATE dispute_ai_audit_discovery_failures SET status = 'RESOLVED', resolved_at = ${now.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz
          WHERE dispute_id = ${row.disputeId}::uuid AND status IN ('OPEN', 'RETRY_REQUESTED')
        `);
        return result.outcome === "enqueued" ? "enqueued" as const : "stale" as const;
      } catch (error) {
        if (error instanceof DisputeAuditSigningNotConfiguredError) throw error;
        const code = error instanceof Error ? error.message : "";
        if (!["AI_AUDIT_ARCHIVE_TOO_LARGE", "AI_AUDIT_CHAIN_INVALID", "AI_AUDIT_CHAIN_UNSEALED"].includes(code)) throw error;
        await tx.execute(sql`
          UPDATE dispute_ai_audit_discovery_failures SET status = 'RESOLVED', resolved_at = ${now.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz
          WHERE dispute_id = ${row.disputeId}::uuid AND status IN ('OPEN', 'RETRY_REQUESTED') AND event_count <> ${row.eventCount}
        `);
        await tx.execute(sql`
          INSERT INTO dispute_ai_audit_discovery_failures
            (dispute_id, event_count, failure_code, status, attempt_count, first_failed_at, last_failed_at, created_at, updated_at)
          VALUES (${row.disputeId}::uuid, ${row.eventCount}, ${code}, 'OPEN', 1,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
            ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
          ON CONFLICT (dispute_id, event_count) DO UPDATE SET failure_code = EXCLUDED.failure_code,
            status = 'OPEN', attempt_count = dispute_ai_audit_discovery_failures.attempt_count + 1,
            last_failed_at = EXCLUDED.last_failed_at, resolved_at = NULL, updated_at = EXCLUDED.updated_at
        `);
        return "isolated" as const;
      }
    });
    if (outcome === "enqueued") enqueued += 1;
    else if (outcome === "isolated") isolated += 1;
    else if (outcome === "contended") contended += 1;
    else stale += 1;
  }
  return { discovered, enqueued, isolated, contended, stale };
}

export async function claimDisputeAiAuditArchives(db: Database, input: { limit?: number; now?: Date; leaseMs?: number } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const now = input.now ?? new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 120_000));
  const rows = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM dispute_ai_audit_outbox
       WHERE (status IN ('PENDING', 'FAILED') AND next_attempt_at <= ${now.toISOString()}::timestamptz)
          OR (status = 'PROCESSING' AND lease_expires_at <= ${now.toISOString()}::timestamptz)
       ORDER BY next_attempt_at ASC, id ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    UPDATE dispute_ai_audit_outbox archive
       SET status = 'PROCESSING', lease_token = ${leaseToken}::uuid,
           lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
           attempt_count = attempt_count + 1, updated_at = ${now.toISOString()}::timestamptz
      FROM candidates WHERE archive.id = candidates.id RETURNING archive.*
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export async function deliverDisputeAiAuditArchive(
  archive: DisputeAiAuditArchiveRecord,
  config: DisputeAiAuditArchiveConfig,
  input: { fetchImpl?: typeof fetch } = {},
) {
  assertDisputeModuleOutboundUrl(config.url, {
    label: "dispute AI audit archive", allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  const rawBody = canonicalDisputeAuditJson(archive.payload);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(config.url, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: {
        "content-type": "application/json", "idempotency-key": archive.archiveKey,
        "x-haggle-content-sha256": archive.payloadSha256,
        ...(config.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {}),
      }, body: rawBody,
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) return { status: "failed" as const, httpStatus: response.status, error: "ARCHIVE_RECEIPT_TOO_LARGE" };
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 16_384) return { status: "failed" as const, httpStatus: response.status, error: "ARCHIVE_RECEIPT_TOO_LARGE" };
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = {}; }
    if (!response.ok) return { status: "failed" as const, httpStatus: response.status, error: `HTTP ${response.status}` };
    const receiptId = typeof body.receipt_id === "string" ? body.receipt_id.trim() : "";
    const receiptSha256 = typeof body.stored_sha256 === "string" ? body.stored_sha256.toLowerCase() : "";
    if (!receiptId || receiptSha256 !== archive.payloadSha256) return { status: "failed" as const, httpStatus: response.status, error: "ARCHIVE_RECEIPT_HASH_MISMATCH" };
    return { status: "delivered" as const, httpStatus: response.status, receiptId, receiptSha256 };
  } catch (error) {
    return { status: "failed" as const, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timeout); }
}

export async function dispatchDisputeAiAuditArchives(
  db: Database,
  input: { config?: DisputeAiAuditArchiveConfig | null; fetchImpl?: typeof fetch; now?: Date; limit?: number } = {},
) {
  const config = input.config === undefined ? resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv() : input.config;
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const, claimed: 0, delivered: 0, failed: 0, deadLettered: 0 };
  const now = input.now ?? new Date();
  const claimed = await claimDisputeAiAuditArchives(db, { limit: input.limit, now });
  let delivered = 0; let failed = 0; let deadLettered = 0;
  for (const archive of claimed) {
    const result = await deliverDisputeAiAuditArchive(archive, config, { fetchImpl: input.fetchImpl });
    if (result.status === "delivered") {
      const updated = await db.execute(sql`
        UPDATE dispute_ai_audit_outbox SET status = 'DELIVERED', lease_token = NULL, lease_expires_at = NULL,
          last_error = NULL, http_status = ${result.httpStatus}, receipt_id = ${result.receiptId}, receipt_sha256 = ${result.receiptSha256},
          delivered_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
        WHERE id = ${archive.id}::uuid AND status = 'PROCESSING' AND lease_token = ${archive.leaseToken}::uuid RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
      if (updated.length === 1) delivered += 1; else failed += 1;
      continue;
    }
    const nextStatus = archive.attemptCount >= config.maxAttempts ? "DEAD_LETTER" : "FAILED";
    const retryAt = new Date(now.getTime() + Math.min(3_600_000, 2 ** Math.min(archive.attemptCount, 10) * 1000));
    await db.execute(sql`
      UPDATE dispute_ai_audit_outbox SET status = ${nextStatus}, lease_token = NULL, lease_expires_at = NULL,
        last_error = ${(result.error ?? "archive delivery failed").slice(0, 1000)}, http_status = ${result.httpStatus ?? null},
        next_attempt_at = ${retryAt.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
      WHERE id = ${archive.id}::uuid AND status = 'PROCESSING' AND lease_token = ${archive.leaseToken}::uuid
    `);
    if (nextStatus === "DEAD_LETTER") deadLettered += 1; else failed += 1;
  }
  return { status: "processed" as const, claimed: claimed.length, delivered, failed, deadLettered };
}
