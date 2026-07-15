import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { canonicalDisputeAuditJson } from "./dispute-ai-assessment-event.service.js";

export interface HashableDisputeSimilarityExpiryEvent {
  schema: "haggle.dispute-similarity-review-event.v1";
  event_id: string;
  upload_id: string;
  dispute_id: string;
  event_type: "AUTO_EXPIRED";
  actor_id: string | null;
  reason: "REVIEW_WINDOW_EXPIRED" | "UNKNOWN";
  review_expires_at: string | null;
  created_at: string;
}

export function hashDisputeSimilarityExpiryEvent(event: HashableDisputeSimilarityExpiryEvent) {
  return createHash("sha256").update(canonicalDisputeAuditJson(event)).digest("hex");
}

function boundedBatchSize(raw: string | undefined) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 500 ? value : 50;
}

export function disputeSimilarityReviewExpiryPolicy() {
  return {
    enabled: process.env.ENABLE_DISPUTE_SIMILARITY_REVIEW_EXPIRY_JOB === "true",
    batchSize: boundedBatchSize(process.env.DISPUTE_SIMILARITY_REVIEW_EXPIRY_BATCH_SIZE),
  };
}

export async function expireDisputeSimilarityReviews(
  db: Database,
  input: { now?: Date; batchSize?: number } = {},
) {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? disputeSimilarityReviewExpiryPolicy().batchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("INVALID_SIMILARITY_REVIEW_EXPIRY_BATCH_SIZE");
  }
  return db.transaction(async (tx) => {
    const rows = (await tx.execute(sql`
      WITH candidates AS (
        SELECT upload.id
        FROM dispute_evidence_uploads upload
       WHERE upload.status = 'QUARANTINED'
         AND upload.similarity_status = 'REVIEW_REQUIRED'
         AND upload.retention_status = 'ACTIVE'
         AND upload.expires_at <= ${now.toISOString()}::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM dispute_evidence_similarity_review_events event
            WHERE event.upload_id = upload.id AND event.event_type = 'AUTO_EXPIRED'
         )
       ORDER BY upload.expires_at ASC, upload.id ASC
       FOR UPDATE OF upload SKIP LOCKED
         LIMIT ${batchSize}
      )
      UPDATE dispute_evidence_uploads upload
         SET status = 'EXPIRED', similarity_status = 'REJECTED',
             similarity_reviewed_by = NULL, similarity_reviewed_at = ${now.toISOString()}::timestamptz,
             scan_provider = 'haggle-similarity-review-expiry',
             scan_detail = 'CAMERA_SIMILARITY_REVIEW_EXPIRED', updated_at = ${now.toISOString()}::timestamptz
        FROM candidates
       WHERE upload.id = candidates.id
         AND upload.status = 'QUARANTINED' AND upload.similarity_status = 'REVIEW_REQUIRED'
         AND upload.retention_status = 'ACTIVE' AND upload.expires_at <= ${now.toISOString()}::timestamptz
      RETURNING upload.id AS "uploadId", upload.dispute_id AS "disputeId", upload.expires_at AS "expiresAt"
    `)) as unknown as Array<{ uploadId: string; disputeId: string; expiresAt: Date | string }>;
    for (const row of rows) {
      const eventId = randomUUID();
      const event: HashableDisputeSimilarityExpiryEvent = {
        schema: "haggle.dispute-similarity-review-event.v1",
        event_id: eventId,
        upload_id: row.uploadId,
        dispute_id: row.disputeId,
        event_type: "AUTO_EXPIRED",
        actor_id: null,
        reason: "REVIEW_WINDOW_EXPIRED",
        review_expires_at: new Date(row.expiresAt).toISOString(),
        created_at: now.toISOString(),
      };
      await tx.execute(sql`
        INSERT INTO dispute_evidence_similarity_review_events
          (id, upload_id, dispute_id, event_type, actor_id, metadata, event_hash, created_at)
        VALUES (${eventId}::uuid, ${row.uploadId}::uuid, ${row.disputeId}::uuid, 'AUTO_EXPIRED', NULL,
                jsonb_build_object('reason', 'REVIEW_WINDOW_EXPIRED', 'review_expires_at', ${event.review_expires_at}::timestamptz),
                ${hashDisputeSimilarityExpiryEvent(event)}, ${now.toISOString()}::timestamptz)
      `);
    }
    return { expired: rows.length, recordedAt: now.toISOString() };
  });
}

interface ExpiryEventCursor {
  createdAt: string;
  id: string;
}

function decodeExpiryEventCursor(value: string): ExpiryEventCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ExpiryEventCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch {
    throw new Error("INVALID_SIMILARITY_REVIEW_EXPIRY_CURSOR");
  }
}

function encodeExpiryEventCursor(cursor: ExpiryEventCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function mapExpiryEventRow(row: Record<string, unknown>) {
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const reviewExpiresAt =
    typeof metadata.review_expires_at === "string" &&
    Number.isFinite(Date.parse(metadata.review_expires_at))
      ? new Date(metadata.review_expires_at).toISOString()
      : null;
  const createdAt = new Date(String(row.created_at)).toISOString();
  const hashable: HashableDisputeSimilarityExpiryEvent = {
    schema: "haggle.dispute-similarity-review-event.v1",
    event_id: String(row.id),
    upload_id: String(row.upload_id),
    dispute_id: String(row.dispute_id),
    event_type: "AUTO_EXPIRED",
    actor_id: row.actor_id === null ? null : String(row.actor_id),
    reason: metadata.reason === "REVIEW_WINDOW_EXPIRED" ? "REVIEW_WINDOW_EXPIRED" : "UNKNOWN",
    review_expires_at: reviewExpiresAt,
    created_at: createdAt,
  };
  const eventHash = typeof row.event_hash === "string" ? row.event_hash : null;
  return {
    eventId: hashable.event_id,
    uploadId: hashable.upload_id,
    disputeId: hashable.dispute_id,
    eventType: hashable.event_type,
    actorKind: hashable.actor_id === null ? ("system" as const) : ("unexpected" as const),
    reason: hashable.reason,
    reviewExpiresAt,
    createdAt,
    eventHash,
    integrity:
      eventHash === null
        ? ("legacy" as const)
        : hashDisputeSimilarityExpiryEvent(hashable) === eventHash
          ? ("valid" as const)
          : ("invalid" as const),
    hashable,
  };
}

export async function listDisputeSimilarityReviewExpiryEvents(
  db: Database,
  input: { limit?: number; cursor?: string } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("INVALID_SIMILARITY_REVIEW_EXPIRY_LIMIT");
  const cursor = input.cursor ? decodeExpiryEventCursor(input.cursor) : null;
  const rows = (await db.execute(sql`
    SELECT id, upload_id, dispute_id, event_type, actor_id, metadata, event_hash, created_at
      FROM dispute_evidence_similarity_review_events
     WHERE event_type = 'AUTO_EXPIRED'
       ${cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit + 1}
  `)) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map(mapExpiryEventRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeExpiryEventCursor({ createdAt: last.createdAt, id: last.eventId })
        : null,
  };
}

export async function getDisputeSimilarityReviewExpiryEventById(db: Database, eventId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) return null;
  const rows = (await db.execute(sql`
    SELECT id, upload_id, dispute_id, event_type, actor_id, metadata, event_hash, created_at
      FROM dispute_evidence_similarity_review_events
     WHERE id = ${eventId}::uuid AND event_type = 'AUTO_EXPIRED'
     LIMIT 1
  `)) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? mapExpiryEventRow(rows[0]) : null;
}
