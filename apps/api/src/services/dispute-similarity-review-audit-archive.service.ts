import { createHash, randomUUID, type KeyObject } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import { canonicalDisputeAuditJson } from "./dispute-ai-assessment-event.service.js";
import { createSignedDisputeSimilarityReviewAuditExport } from "./dispute-similarity-review-audit-export.service.js";
import { getDisputeSimilarityReviewExpiryEventById } from "./dispute-similarity-review-expiry.service.js";

export interface DisputeSimilarityReviewAuditArchiveConfig {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
  maxAttempts: number;
  allowInsecureHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface DisputeSimilarityReviewAuditArchiveRecord {
  id: string;
  archiveKey: string;
  eventId: string;
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

export interface DisputeSimilarityReviewAuditArchiveHealth {
  status: "healthy" | "attention" | "critical";
  pending: number;
  processing: number;
  failed: number;
  deadLetter: number;
  staleProcessing: number;
  retryReady: number;
  overdueUnfinished: number;
  unfinishedMaxAgeMinutes: number;
  oldestUnfinishedAgeSeconds: number | null;
  recordedAt: string;
}

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv(): DisputeSimilarityReviewAuditArchiveConfig | null {
  const url = process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim();
  if (!url) return null;
  const config = {
    url,
    bearerToken: process.env.HAGGLE_AUDIT_ARCHIVE_BEARER_TOKEN?.trim() || undefined,
    timeoutMs: boundedInteger(process.env.HAGGLE_AUDIT_ARCHIVE_TIMEOUT_MS, 10_000, 250, 30_000),
    maxAttempts: boundedInteger(process.env.HAGGLE_AUDIT_ARCHIVE_MAX_ATTEMPTS, 10, 1, 100),
    allowInsecureHttp: process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_INSECURE_HTTP === "true",
    allowPrivateNetwork: process.env.HAGGLE_AUDIT_ARCHIVE_ALLOW_PRIVATE_NETWORK === "true",
  };
  assertDisputeModuleOutboundUrl(config.url, {
    label: "similarity review audit archive",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  return config;
}

export function getDisputeSimilarityReviewAuditArchivePolicyStatus() {
  const url = process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim();
  const signing = Boolean(process.env.DISPUTE_AUDIT_SIGNING_PRIVATE_KEY_BASE64?.trim());
  let configurationState: "not_configured" | "partial" | "invalid" | "valid" = !url && !signing
    ? "not_configured" : !url || !signing ? "partial" : "valid";
  if (configurationState === "valid") {
    try { resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv(); }
    catch { configurationState = "invalid"; }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_AUDIT_ARCHIVE_JOB === "true",
    unfinishedMaxAgeMinutes: boundedInteger(process.env.HAGGLE_AUDIT_ARCHIVE_UNFINISHED_MAX_AGE_MINUTES, 15, 1, 1440),
  };
}

function mapRow(row: Record<string, unknown>): DisputeSimilarityReviewAuditArchiveRecord {
  return {
    id: String(row.id), archiveKey: String(row.archive_key), eventId: String(row.event_id),
    payload: row.payload as Record<string, unknown>, payloadSha256: String(row.payload_sha256),
    status: String(row.status) as DisputeSimilarityReviewAuditArchiveRecord["status"],
    attemptCount: Number(row.attempt_count), nextAttemptAt: new Date(String(row.next_attempt_at)).toISOString(),
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at ? new Date(String(row.lease_expires_at)).toISOString() : null,
    lastError: row.last_error ? String(row.last_error) : null,
    httpStatus: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
    receiptId: row.receipt_id ? String(row.receipt_id) : null,
    receiptSha256: row.receipt_sha256 ? String(row.receipt_sha256) : null,
    deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function getDisputeSimilarityReviewAuditArchiveHealth(
  db: Database,
  now = new Date(),
): Promise<DisputeSimilarityReviewAuditArchiveHealth> {
  const policy = getDisputeSimilarityReviewAuditArchivePolicyStatus();
  const overdueAt = new Date(now.getTime() - policy.unfinishedMaxAgeMinutes * 60_000);
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
      count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE status = 'DEAD_LETTER')::int AS dead_letter,
      count(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at <= ${now.toISOString()}::timestamptz)::int AS stale_processing,
      count(*) FILTER (WHERE status = 'FAILED' AND next_attempt_at <= ${now.toISOString()}::timestamptz)::int AS retry_ready,
      count(*) FILTER (WHERE status <> 'DELIVERED' AND created_at <= ${overdueAt.toISOString()}::timestamptz)::int AS overdue_unfinished,
      extract(epoch FROM (${now.toISOString()}::timestamptz - min(created_at) FILTER (WHERE status <> 'DELIVERED')))::int
        AS oldest_unfinished_age_seconds
    FROM dispute_evidence_similarity_review_audit_outbox
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
    oldestUnfinishedAgeSeconds: row.oldest_unfinished_age_seconds === null || row.oldest_unfinished_age_seconds === undefined
      ? null : Math.max(0, Number(row.oldest_unfinished_age_seconds)),
    recordedAt: now.toISOString(),
  };
}

interface FailureCursor { createdAt: string; id: string }
function decodeFailureCursor(value: string): FailureCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<FailureCursor>;
    if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) throw new Error("invalid");
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { throw new Error("INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_FAILURE_CURSOR"); }
}
function encodeFailureCursor(value: FailureCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function listDisputeSimilarityReviewAuditArchiveFailures(
  db: Database,
  input: { limit?: number; cursor?: string; now?: Date } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_SIMILARITY_REVIEW_AUDIT_ARCHIVE_FAILURE_LIMIT");
  const cursor = input.cursor ? decodeFailureCursor(input.cursor) : null;
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`
    SELECT * FROM dispute_evidence_similarity_review_audit_outbox
     WHERE status IN ('FAILED', 'DEAD_LETTER')
       ${cursor ? sql`AND (created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
     ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}
  `) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const records = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
  const items = records.map((record) => ({
    id: record.id, eventId: record.eventId, payloadSha256: record.payloadSha256,
    status: record.status, attemptCount: record.attemptCount, nextAttemptAt: record.nextAttemptAt,
    lastError: record.lastError?.slice(0, 500) ?? null, httpStatus: record.httpStatus,
    createdAt: record.createdAt, updatedAt: record.updatedAt,
    failureAgeSeconds: Math.max(0, Math.floor((now.getTime() - new Date(record.updatedAt).getTime()) / 1000)),
  }));
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeFailureCursor({ createdAt: last.createdAt, id: last.id }) : null, recordedAt: now.toISOString() };
}

export async function requeueDisputeSimilarityReviewAuditArchive(
  db: Database,
  input: { eventId: string; actorId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 500) return { outcome: "invalid_reason" as const };
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT * FROM dispute_evidence_similarity_review_audit_outbox
       WHERE event_id = ${input.eventId}::uuid ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) return { outcome: "not_found" as const };
    const current = mapRow(rows[0]);
    if (current.status === "PENDING" || current.status === "PROCESSING") return { outcome: "already_queued" as const, archive: current };
    if (current.status === "DELIVERED") return { outcome: "already_delivered" as const, archive: current };
    const updated = await tx.execute(sql`
      UPDATE dispute_evidence_similarity_review_audit_outbox
         SET status = 'PENDING', attempt_count = 0, next_attempt_at = ${now.toISOString()}::timestamptz,
             lease_token = NULL, lease_expires_at = NULL, last_error = NULL, http_status = NULL,
             receipt_id = NULL, receipt_sha256 = NULL, delivered_at = NULL, updated_at = ${now.toISOString()}::timestamptz
       WHERE id = ${current.id}::uuid AND status IN ('FAILED', 'DEAD_LETTER') RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    if (!updated[0]) throw new Error("SIMILARITY_REVIEW_AUDIT_ARCHIVE_REQUEUE_CONFLICT");
    await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (${input.actorId}::uuid, 'dispute.similarity_review_audit_archive_requeue',
              'dispute_evidence_similarity_review_audit_outbox', ${current.id},
              jsonb_build_object('event_id', ${input.eventId}::text, 'previous_status', ${current.status}::text,
                                 'previous_attempt_count', ${current.attemptCount}::int, 'reason', ${reason}::text),
              ${now.toISOString()}::timestamptz)
    `);
    return { outcome: "requeued" as const, archive: mapRow(updated[0]) };
  });
}

export async function enqueueDisputeSimilarityReviewAuditArchive(
  db: Database,
  input: { eventId: string; now?: Date; privateKey?: KeyObject },
) {
  const event = await getDisputeSimilarityReviewExpiryEventById(db, input.eventId);
  if (!event) throw new Error("SIMILARITY_REVIEW_EXPIRY_EVENT_NOT_FOUND");
  if (event.integrity !== "valid" || !event.eventHash) throw new Error("SIMILARITY_REVIEW_AUDIT_INTEGRITY_INVALID");
  const now = input.now ?? new Date();
  const auditExport = createSignedDisputeSimilarityReviewAuditExport({
    event: event.hashable, storedEventHash: event.eventHash, generatedAt: now, privateKey: input.privateKey,
  });
  const payload = auditExport as unknown as Record<string, unknown>;
  const payloadSha256 = createHash("sha256").update(canonicalDisputeAuditJson(payload)).digest("hex");
  const archiveKey = `dsre_${createHash("sha256").update(`${event.eventId}:${event.eventHash}`).digest("hex")}`;
  const inserted = await db.execute(sql`
    INSERT INTO dispute_evidence_similarity_review_audit_outbox
      (archive_key, event_id, payload, payload_sha256, status, attempt_count, next_attempt_at, created_at, updated_at)
    VALUES (${archiveKey}, ${event.eventId}::uuid, ${JSON.stringify(payload)}::jsonb, ${payloadSha256},
            'PENDING', 0, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    ON CONFLICT (archive_key) DO NOTHING RETURNING *
  `) as unknown as Array<Record<string, unknown>>;
  if (inserted[0]) return { outcome: "enqueued" as const, archive: mapRow(inserted[0]) };
  const existing = await db.execute(sql`
    SELECT * FROM dispute_evidence_similarity_review_audit_outbox WHERE archive_key = ${archiveKey}
  `) as unknown as Array<Record<string, unknown>>;
  if (!existing[0]) throw new Error("SIMILARITY_REVIEW_AUDIT_ARCHIVE_IDEMPOTENCY_LOOKUP_FAILED");
  return { outcome: "duplicate" as const, archive: mapRow(existing[0]) };
}

export async function enqueuePendingDisputeSimilarityReviewAudits(db: Database, input: { limit?: number; now?: Date } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const rows = await db.execute(sql`
    SELECT event.id FROM dispute_evidence_similarity_review_events event
     WHERE event.event_hash IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dispute_evidence_similarity_review_audit_outbox archive WHERE archive.event_id = event.id)
     ORDER BY event.created_at ASC, event.id ASC LIMIT ${limit}
  `) as unknown as Array<{ id: string }>;
  let enqueued = 0;
  for (const row of rows) {
    const result = await enqueueDisputeSimilarityReviewAuditArchive(db, { eventId: row.id, now: input.now });
    if (result.outcome === "enqueued") enqueued += 1;
  }
  return { discovered: rows.length, enqueued };
}

export async function claimDisputeSimilarityReviewAuditArchives(
  db: Database,
  input: { limit?: number; now?: Date; leaseMs?: number } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const now = input.now ?? new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 120_000));
  const rows = await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM dispute_evidence_similarity_review_audit_outbox
       WHERE (status IN ('PENDING', 'FAILED') AND next_attempt_at <= ${now.toISOString()}::timestamptz)
          OR (status = 'PROCESSING' AND lease_expires_at <= ${now.toISOString()}::timestamptz)
       ORDER BY next_attempt_at ASC, id ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    UPDATE dispute_evidence_similarity_review_audit_outbox archive
       SET status = 'PROCESSING', lease_token = ${leaseToken}::uuid,
           lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
           attempt_count = attempt_count + 1, updated_at = ${now.toISOString()}::timestamptz
      FROM candidates WHERE archive.id = candidates.id RETURNING archive.*
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export async function deliverDisputeSimilarityReviewAuditArchive(
  archive: DisputeSimilarityReviewAuditArchiveRecord,
  config: DisputeSimilarityReviewAuditArchiveConfig,
  input: { fetchImpl?: typeof fetch } = {},
) {
  assertDisputeModuleOutboundUrl(config.url, {
    label: "similarity review audit archive", allowInsecureHttp: config.allowInsecureHttp,
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
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
      return { status: "failed" as const, httpStatus: response.status, error: "ARCHIVE_RECEIPT_TOO_LARGE" };
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 16_384) return { status: "failed" as const, httpStatus: response.status, error: "ARCHIVE_RECEIPT_TOO_LARGE" };
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = {}; }
    if (!response.ok) return { status: "failed" as const, httpStatus: response.status, error: `HTTP ${response.status}` };
    const receiptId = typeof body.receipt_id === "string" ? body.receipt_id.trim() : "";
    const receiptSha256 = typeof body.stored_sha256 === "string" ? body.stored_sha256.toLowerCase() : "";
    if (!receiptId || receiptSha256 !== archive.payloadSha256) {
      return { status: "failed" as const, httpStatus: response.status, error: "ARCHIVE_RECEIPT_HASH_MISMATCH" };
    }
    return { status: "delivered" as const, httpStatus: response.status, receiptId, receiptSha256 };
  } catch (error) {
    return { status: "failed" as const, error: error instanceof Error ? error.message : String(error) };
  } finally { clearTimeout(timeout); }
}

export async function dispatchDisputeSimilarityReviewAuditArchives(
  db: Database,
  input: { config?: DisputeSimilarityReviewAuditArchiveConfig | null; fetchImpl?: typeof fetch; now?: Date; limit?: number } = {},
) {
  const config = input.config === undefined ? resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv() : input.config;
  if (!config) return { status: "skipped" as const, reason: "not_configured" as const, claimed: 0, delivered: 0, failed: 0, deadLettered: 0 };
  const now = input.now ?? new Date();
  const claimed = await claimDisputeSimilarityReviewAuditArchives(db, { limit: input.limit, now });
  let delivered = 0; let failed = 0; let deadLettered = 0;
  for (const archive of claimed) {
    const result = await deliverDisputeSimilarityReviewAuditArchive(archive, config, { fetchImpl: input.fetchImpl });
    if (result.status === "delivered") {
      const updated = await db.execute(sql`
        UPDATE dispute_evidence_similarity_review_audit_outbox
           SET status = 'DELIVERED', lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
               http_status = ${result.httpStatus}, receipt_id = ${result.receiptId}, receipt_sha256 = ${result.receiptSha256},
               delivered_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
         WHERE id = ${archive.id}::uuid AND status = 'PROCESSING' AND lease_token = ${archive.leaseToken}::uuid RETURNING id
      `) as unknown as Array<Record<string, unknown>>;
      if (updated.length === 1) delivered += 1; else failed += 1;
      continue;
    }
    const nextStatus = archive.attemptCount >= config.maxAttempts ? "DEAD_LETTER" : "FAILED";
    const retryAt = new Date(now.getTime() + Math.min(3_600_000, 2 ** Math.min(archive.attemptCount, 10) * 1000));
    await db.execute(sql`
      UPDATE dispute_evidence_similarity_review_audit_outbox
         SET status = ${nextStatus}, lease_token = NULL, lease_expires_at = NULL,
             last_error = ${(result.error ?? "archive delivery failed").slice(0, 1000)},
             http_status = ${result.httpStatus ?? null}, next_attempt_at = ${retryAt.toISOString()}::timestamptz,
             updated_at = ${now.toISOString()}::timestamptz
       WHERE id = ${archive.id}::uuid AND status = 'PROCESSING' AND lease_token = ${archive.leaseToken}::uuid
    `);
    if (nextStatus === "DEAD_LETTER") deadLettered += 1; else failed += 1;
  }
  return { status: "processed" as const, claimed: claimed.length, delivered, failed, deadLettered };
}
