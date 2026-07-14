import {
  disputeCases,
  disputeEvidence,
  disputeEvidenceUploads,
  disputeModuleIdempotencyKeys,
  disputeResolutions,
  eq,
  and,
  sql,
  type Database,
} from "@haggle/db";
import type {
  DisputeCase,
  DisputeStatus,
  DisputeEvidence as DisputeEvidenceType,
  DisputeResolution,
} from "@haggle/dispute-core";
import {
  assessImageSimilarity,
  type ImageSimilarityAssessment,
  type ImageSimilarityFingerprint,
} from "./dispute-image-similarity.service.js";
import { resolveDisputeAuditPublicKeyRegistryFromEnv } from "./dispute-audit-public-key-registry.service.js";
import { verifyTrustedDisputeEvidenceProvenance } from "./dispute-evidence-provenance.service.js";

// Fingerprint fields are persisted by the workspace DB schema built with migration 0058.

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapDisputeCase(
  row: typeof disputeCases.$inferSelect,
  evidence: DisputeEvidenceType[] = [],
  resolution?: DisputeResolution,
): DisputeCase {
  return {
    id: row.id,
    order_id: row.orderId,
    reason_code: row.reasonCode,
    status: row.status as DisputeStatus,
    opened_by: row.openedBy as "buyer" | "seller" | "system",
    opened_at: row.openedAt.toISOString(),
    evidence,
    resolution,
    metadata: row.metadata ?? null,
    refundAmountMinor: resolution?.refund_amount_minor?.toString() ?? null,
  };
}

export async function createDisputeRecord(
  db: Database,
  dispute: DisputeCase,
): Promise<DisputeCase> {
  const [row] = await db
    .insert(disputeCases)
    .values({
      id: dispute.id,
      orderId: dispute.order_id,
      reasonCode: dispute.reason_code,
      status: dispute.status,
      openedBy: dispute.opened_by,
      openedAt: new Date(dispute.opened_at),
      metadata: dispute.metadata ?? undefined,
    })
    .returning();

  if (dispute.evidence.length > 0) {
    await db.insert(disputeEvidence).values(
      dispute.evidence.map((e) => ({
        id: e.id,
        disputeId: dispute.id,
        submittedBy: e.submitted_by,
        type: e.type,
        uri: e.uri,
        text: e.text,
        derivedArtifacts: e.derived_artifacts,
        sourceContentSha256: e.source_content_sha256,
        derivedArtifactsProvenance: e.derived_artifacts_provenance,
        createdAt: new Date(e.created_at),
      })),
    );
  }

  return mapDisputeCase(row, dispute.evidence);
}

export async function getDisputeById(db: Database, id: string): Promise<DisputeCase | null> {
  const row = await db.query.disputeCases.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  if (!row) return null;

  const evidenceRows = await db.query.disputeEvidence.findMany({
    where: (fields, ops) => ops.eq(fields.disputeId, id),
    orderBy: (fields, { asc }) => [asc(fields.createdAt)],
  });

  let provenanceKeys: ReturnType<typeof resolveDisputeAuditPublicKeyRegistryFromEnv> = [];
  try {
    provenanceKeys = resolveDisputeAuditPublicKeyRegistryFromEnv();
  } catch {
    provenanceKeys = [];
  }
  const evidence: DisputeEvidenceType[] = evidenceRows.map((e) => {
    const artifacts = (e.derivedArtifacts ?? []) as NonNullable<DisputeEvidenceType["derived_artifacts"]>;
    const integrity = artifacts.length > 0
      ? verifyTrustedDisputeEvidenceProvenance({
        provenance: e.derivedArtifactsProvenance,
        artifacts,
        disputeId: e.disputeId,
        evidenceId: e.id,
        sourceContentSha256: e.sourceContentSha256,
        keys: provenanceKeys,
      })
      : null;
    return {
      id: e.id,
      dispute_id: e.disputeId,
      submitted_by: e.submittedBy as "buyer" | "seller" | "system",
      type: e.type as DisputeEvidenceType["type"],
      uri: e.uri ?? undefined,
      text: e.text ?? undefined,
      source_content_sha256: e.sourceContentSha256 ?? undefined,
      derived_artifacts: integrity?.valid ? artifacts : undefined,
      derived_artifacts_integrity: integrity ? (integrity.valid ? "valid" : "invalid") : undefined,
      derived_artifacts_integrity_reason: integrity?.reason,
      created_at: e.createdAt.toISOString(),
    };
  });

  let resolution: DisputeResolution | undefined;
  const resRow = await db.query.disputeResolutions.findFirst({
    where: (fields, ops) => ops.eq(fields.disputeId, id),
  });
  if (resRow) {
    resolution = {
      outcome: resRow.outcome as DisputeResolution["outcome"],
      summary: resRow.summary,
      refund_amount_minor: resRow.refundAmountMinor ? Number(resRow.refundAmountMinor) : undefined,
      resolved_at: toIso(resRow.resolvedAt),
    };
  }

  return mapDisputeCase(row, evidence, resolution);
}

export async function getDisputeByOrderId(db: Database, orderId: string): Promise<DisputeCase | null> {
  const row = await db.query.disputeCases.findFirst({
    where: (fields, ops) => ops.eq(fields.orderId, orderId),
  });
  if (!row) return null;
  return getDisputeById(db, row.id);
}

export async function getActiveDisputeByOrderId(db: Database, orderId: string): Promise<DisputeCase | null> {
  const row = await db.query.disputeCases.findFirst({
    where: (fields) => sql`
      ${fields.orderId} = ${orderId}
      AND ${fields.status} NOT IN (
        'RESOLVED_BUYER_FAVOR',
        'RESOLVED_SELLER_FAVOR',
        'PARTIAL_REFUND',
        'CLOSED'
      )
    `,
  });
  if (!row) return null;
  return getDisputeById(db, row.id);
}

export async function updateDisputeRecord(
  db: Database,
  dispute: DisputeCase,
): Promise<void> {
  await db
    .update(disputeCases)
    .set({
      status: dispute.status,
      resolutionSummary: dispute.resolution?.summary,
      metadata: dispute.metadata ?? undefined,
      resolvedAt: dispute.resolution?.resolved_at ? new Date(dispute.resolution.resolved_at) : undefined,
      closedAt: dispute.status === "CLOSED" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(disputeCases.id, dispute.id));
}

export async function addDisputeEvidenceRecord(
  db: Database,
  evidence: DisputeEvidenceType,
): Promise<void> {
  await db.insert(disputeEvidence).values({
    id: evidence.id,
    disputeId: evidence.dispute_id,
    submittedBy: evidence.submitted_by,
    type: evidence.type,
    uri: evidence.uri,
    text: evidence.text,
    derivedArtifacts: evidence.derived_artifacts,
    sourceContentSha256: evidence.source_content_sha256,
    derivedArtifactsProvenance: evidence.derived_artifacts_provenance,
    createdAt: new Date(evidence.created_at),
  });
}

export interface DisputeEvidenceUploadRecord {
  id: string;
  disputeId: string;
  uploadedBy: "buyer" | "seller" | "system";
  evidenceType: "image" | "video";
  contentType: string;
  fileSizeBytes: number;
  storagePath: string;
  status: "PENDING" | "QUARANTINED" | "COMMITTED" | "REJECTED" | "EXPIRED";
  scanStatus: "PENDING" | "SCANNING" | "CLEAN" | "INFECTED" | "FAILED" | "SKIPPED";
  contentSha256: string | null;
  cameraSessionId: string | null;
  captureDeclaredSha256: string | null;
  perceptualHash: string | null;
  averageHash: string | null;
  colorHistogram: number[] | null;
  similaritySignals: Record<string, unknown> | null;
  similarityStatus: "PENDING" | "CLEAR" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED" | "FAILED" | "SKIPPED";
  similarityDistance: number | null;
  similarityReviewedBy: string | null;
  similarityReviewedAt: Date | null;
  retentionStatus: "ACTIVE" | "DELETING" | "DELETED" | "FAILED";
  retentionUntil: Date | null;
  deletionClaimId: string | null;
  deletionClaimedAt: Date | null;
  deletionAttempts: number;
  deletionNextAttemptAt: Date | null;
  deletionLastError: string | null;
  deletedAt: Date | null;
  scanProvider: string | null;
  scanDetail: string | null;
  scannedAt: Date | null;
  scanAttemptCount: number;
  scanNextAttemptAt: Date | null;
  scanLeaseToken: string | null;
  scanLeaseExpiresAt: Date | null;
  scanLastError: string | null;
  expiresAt: Date;
  committedEvidenceId: string | null;
  committedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createDisputeEvidenceUploadRecord(
  db: Database,
  data: {
    id: string;
    disputeId: string;
    uploadedBy: "buyer" | "seller" | "system";
    evidenceType: "image" | "video";
    contentType: string;
    fileSizeBytes: number;
    storagePath: string;
    expiresAt: Date;
    cameraSessionId?: string;
    captureDeclaredSha256?: string;
  },
): Promise<DisputeEvidenceUploadRecord> {
  const [row] = await db
    .insert(disputeEvidenceUploads)
    .values({
      id: data.id,
      disputeId: data.disputeId,
      uploadedBy: data.uploadedBy,
      evidenceType: data.evidenceType,
      contentType: data.contentType,
      fileSizeBytes: data.fileSizeBytes,
      storagePath: data.storagePath,
      expiresAt: data.expiresAt,
      cameraSessionId: data.cameraSessionId,
      captureDeclaredSha256: data.captureDeclaredSha256,
    })
    .returning();

  return row as DisputeEvidenceUploadRecord;
}

export async function hasCommittedCameraEvidenceSha256(
  db: Database,
  sha256: string,
): Promise<boolean> {
  const row = await db.query.disputeEvidenceUploads.findFirst({
    where: (fields) => sql`
      ${fields.contentSha256} = ${sha256}
      AND ${fields.status} = 'COMMITTED'
      AND ${fields.cameraSessionId} IS NOT NULL
    `,
    columns: { id: true },
  });
  return Boolean(row);
}

export async function getDisputeEvidenceUploadByPath(
  db: Database,
  disputeId: string,
  storagePath: string,
): Promise<DisputeEvidenceUploadRecord | null> {
  const row = await db.query.disputeEvidenceUploads.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.disputeId, disputeId),
      ops.eq(fields.storagePath, storagePath),
    ),
  });
  return (row as DisputeEvidenceUploadRecord | undefined) ?? null;
}

export async function getDisputeEvidenceUploadById(
  db: Database,
  disputeId: string,
  uploadId: string,
): Promise<DisputeEvidenceUploadRecord | null> {
  const row = await db.query.disputeEvidenceUploads.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.disputeId, disputeId),
      ops.eq(fields.id, uploadId),
    ),
  });
  return (row as DisputeEvidenceUploadRecord | undefined) ?? null;
}

export async function getDisputeEvidenceUploadByEvidenceId(
  db: Database,
  disputeId: string,
  evidenceId: string,
): Promise<DisputeEvidenceUploadRecord | null> {
  const row = await db.query.disputeEvidenceUploads.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.disputeId, disputeId),
      ops.eq(fields.committedEvidenceId, evidenceId),
    ),
  });
  return (row as DisputeEvidenceUploadRecord | undefined) ?? null;
}

export async function markDisputeEvidenceUploadCommitted(
  db: Database,
  uploadId: string,
  evidenceId: string,
  allowSkipped = false,
): Promise<boolean> {
  const rows = await db
    .update(disputeEvidenceUploads)
    .set({
      status: "COMMITTED",
      committedEvidenceId: evidenceId,
      committedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(disputeEvidenceUploads.id, uploadId),
      sql`${disputeEvidenceUploads.status} IN ('PENDING', 'QUARANTINED')`,
      allowSkipped
        ? sql`${disputeEvidenceUploads.scanStatus} IN ('CLEAN', 'SKIPPED')`
        : eq(disputeEvidenceUploads.scanStatus, "CLEAN"),
      allowSkipped
        ? sql`true`
        : sql`(${disputeEvidenceUploads.cameraSessionId} IS NULL OR ${disputeEvidenceUploads.similarityStatus} IN ('CLEAR', 'APPROVED'))`,
    ))
    .returning({ id: disputeEvidenceUploads.id });
  return rows.length === 1;
}

export async function updateDisputeEvidenceUploadSimilarity(
  db: Database,
  uploadId: string,
  result: {
    perceptualHash?: string;
    averageHash?: string;
    colorHistogram?: number[];
    signals?: Record<string, unknown>;
    status: "CLEAR" | "REVIEW_REQUIRED" | "APPROVED" | "REJECTED" | "FAILED" | "SKIPPED";
    distance?: number;
    reviewedBy?: string;
  },
): Promise<void> {
  await db
    .update(disputeEvidenceUploads)
    .set({
      perceptualHash: result.perceptualHash,
      averageHash: result.averageHash,
      colorHistogram: result.colorHistogram,
      similaritySignals: result.signals,
      similarityStatus: result.status,
      similarityDistance: result.distance,
      similarityReviewedBy: result.reviewedBy,
      similarityReviewedAt: result.reviewedBy ? new Date() : undefined,
      expiresAt: result.status === "REVIEW_REQUIRED"
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : undefined,
      updatedAt: new Date(),
    })
    .where(and(
      eq(disputeEvidenceUploads.id, uploadId),
      sql`${disputeEvidenceUploads.status} IN ('PENDING', 'QUARANTINED')`,
    ));
}

export async function findNearestCommittedCameraEvidence(
  db: Database,
  fingerprint: ImageSimilarityFingerprint,
): Promise<{ uploadId: string; distance: number; assessment: ImageSimilarityAssessment } | null> {
  const rows = await db.execute(sql`
    SELECT id AS "uploadId", perceptual_hash AS "dHash", average_hash AS "aHash",
           color_histogram AS "colorHistogram",
           bit_count(perceptual_hash::bit(64) # ${fingerprint.dHash}::bit(64))::int AS "dHashDistance",
           CASE WHEN average_hash IS NULL THEN 64
                ELSE bit_count(average_hash::bit(64) # ${fingerprint.aHash}::bit(64))::int END AS "aHashDistance"
      FROM dispute_evidence_uploads
     WHERE status = 'COMMITTED'
       AND camera_session_id IS NOT NULL
       AND perceptual_hash IS NOT NULL
     ORDER BY LEAST(
       bit_count(perceptual_hash::bit(64) # ${fingerprint.dHash}::bit(64))::int,
       CASE WHEN average_hash IS NULL THEN 64
            ELSE bit_count(average_hash::bit(64) # ${fingerprint.aHash}::bit(64))::int END
     ) ASC
     LIMIT 50
  `) as unknown as Array<{ uploadId: string; dHash: string; aHash: string | null; colorHistogram: number[] | null }>;
  const assessed = rows.map((row) => ({
    uploadId: row.uploadId,
    assessment: assessImageSimilarity(fingerprint, {
      dHash: row.dHash,
      aHash: row.aHash,
      colorHistogram: row.colorHistogram,
    }),
  })).sort((left, right) => left.assessment.score - right.assessment.score);
  const nearest = assessed[0];
  return nearest ? { uploadId: nearest.uploadId, distance: nearest.assessment.dHashDistance, assessment: nearest.assessment } : null;
}

interface SimilarityReviewCursor { createdAt: string; id: string }

function decodeSimilarityReviewCursor(value: string): SimilarityReviewCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SimilarityReviewCursor>;
    if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)) {
      throw new Error("invalid cursor");
    }
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { throw new Error("INVALID_SIMILARITY_REVIEW_CURSOR"); }
}

function encodeSimilarityReviewCursor(cursor: SimilarityReviewCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export async function listDisputeEvidenceSimilarityReviews(
  db: Database,
  input: { limit?: number; cursor?: string; now?: Date } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_SIMILARITY_REVIEW_LIMIT");
  const cursor = input.cursor ? decodeSimilarityReviewCursor(input.cursor) : null;
  const now = input.now ?? new Date();
  const rows = await db.execute(sql`
    SELECT review.id, review.dispute_id, review.uploaded_by, review.content_type,
           review.file_size_bytes, review.storage_path, review.similarity_distance,
           review.similarity_signals, review.expires_at, review.created_at,
           reference.id AS matched_upload_id, reference.storage_path AS matched_storage_path
      FROM dispute_evidence_uploads review
      LEFT JOIN dispute_evidence_uploads reference
        ON reference.id = CASE
             WHEN review.similarity_signals->>'candidate_upload_id'
               ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN (review.similarity_signals->>'candidate_upload_id')::uuid
           END
       AND reference.status = 'COMMITTED'
     WHERE review.status = 'QUARANTINED' AND review.similarity_status = 'REVIEW_REQUIRED'
       AND review.retention_status = 'ACTIVE' AND review.expires_at > ${now.toISOString()}::timestamptz
       ${cursor ? sql`AND (review.created_at, review.id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
     ORDER BY review.created_at ASC, review.id ASC
     LIMIT ${limit + 1}
  `) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row) => ({
    uploadId: String(row.id),
    disputeId: String(row.dispute_id),
    uploadedBy: String(row.uploaded_by),
    contentType: String(row.content_type),
    fileSizeBytes: Number(row.file_size_bytes),
    storagePath: String(row.storage_path),
    matchedUploadId: row.matched_upload_id ? String(row.matched_upload_id) : null,
    matchedStoragePath: row.matched_storage_path ? String(row.matched_storage_path) : null,
    similarityDistance: row.similarity_distance === null ? null : Number(row.similarity_distance),
    similaritySignals: row.similarity_signals && typeof row.similarity_signals === "object" && !Array.isArray(row.similarity_signals)
      ? row.similarity_signals as Record<string, unknown> : null,
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    waitingAgeSeconds: Math.max(0, Math.floor((now.getTime() - new Date(String(row.created_at)).getTime()) / 1000)),
    dueInSeconds: Math.max(0, Math.floor((new Date(String(row.expires_at)).getTime() - now.getTime()) / 1000)),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? encodeSimilarityReviewCursor({ createdAt: last.createdAt, id: last.uploadId }) : null,
    recordedAt: now.toISOString(),
  };
}

export interface DisputeEvidenceSimilarityReviewHealth {
  status: "healthy" | "attention" | "critical";
  pendingReviews: number;
  overdueSla: number;
  dueSoon: number;
  expiredUnresolved: number;
  oldestPendingAgeSeconds: number | null;
  autoExpiredLast24Hours: number;
  lastAutoExpiredAt: string | null;
  recordedAt: string;
}

export async function getDisputeEvidenceSimilarityReviewHealth(
  db: Database,
  input: { now?: Date; slaMinutes?: number; dueSoonMinutes?: number } = {},
): Promise<DisputeEvidenceSimilarityReviewHealth> {
  const now = input.now ?? new Date();
  const slaMinutes = input.slaMinutes ?? 15;
  const dueSoonMinutes = input.dueSoonMinutes ?? 60;
  if (!Number.isInteger(slaMinutes) || slaMinutes < 1 || slaMinutes > 1440) throw new Error("INVALID_SIMILARITY_REVIEW_SLA");
  if (!Number.isInteger(dueSoonMinutes) || dueSoonMinutes < 1 || dueSoonMinutes > 1440) throw new Error("INVALID_SIMILARITY_REVIEW_DUE_SOON");
  const rows = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE expires_at > ${now.toISOString()}::timestamptz)::int AS pending_reviews,
      count(*) FILTER (
        WHERE expires_at > ${now.toISOString()}::timestamptz
          AND created_at <= ${now.toISOString()}::timestamptz - (${slaMinutes} * interval '1 minute')
      )::int AS overdue_sla,
      count(*) FILTER (
        WHERE expires_at > ${now.toISOString()}::timestamptz
          AND expires_at <= ${now.toISOString()}::timestamptz + (${dueSoonMinutes} * interval '1 minute')
      )::int AS due_soon,
      count(*) FILTER (WHERE expires_at <= ${now.toISOString()}::timestamptz)::int AS expired_unresolved,
      floor(extract(epoch FROM (${now.toISOString()}::timestamptz - min(created_at)
        FILTER (WHERE expires_at > ${now.toISOString()}::timestamptz))))::int AS oldest_pending_age_seconds,
      (SELECT count(*)::int FROM dispute_evidence_similarity_review_events event
        WHERE event.event_type = 'AUTO_EXPIRED'
          AND event.created_at > ${now.toISOString()}::timestamptz - interval '24 hours') AS auto_expired_last_24_hours,
      (SELECT max(event.created_at) FROM dispute_evidence_similarity_review_events event
        WHERE event.event_type = 'AUTO_EXPIRED') AS last_auto_expired_at
    FROM dispute_evidence_uploads
    WHERE status = 'QUARANTINED' AND similarity_status = 'REVIEW_REQUIRED'
      AND retention_status = 'ACTIVE'
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const pendingReviews = Number(row.pending_reviews ?? 0);
  const overdueSla = Number(row.overdue_sla ?? 0);
  const dueSoon = Number(row.due_soon ?? 0);
  const expiredUnresolved = Number(row.expired_unresolved ?? 0);
  return {
    status: expiredUnresolved > 0 ? "critical" : overdueSla > 0 || dueSoon > 0 ? "attention" : "healthy",
    pendingReviews,
    overdueSla,
    dueSoon,
    expiredUnresolved,
    oldestPendingAgeSeconds: row.oldest_pending_age_seconds === null || row.oldest_pending_age_seconds === undefined
      ? null : Math.max(0, Number(row.oldest_pending_age_seconds)),
    autoExpiredLast24Hours: Number(row.auto_expired_last_24_hours ?? 0),
    lastAutoExpiredAt: row.last_auto_expired_at ? new Date(String(row.last_auto_expired_at)).toISOString() : null,
    recordedAt: now.toISOString(),
  };
}

export async function decideDisputeEvidenceSimilarityReview(
  db: Database,
  input: { disputeId: string; uploadId: string; reviewerId: string; decision: "approve" | "reject"; note: string; now?: Date },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE dispute_evidence_uploads
         SET similarity_status = ${input.decision === "approve" ? "APPROVED" : "REJECTED"},
             similarity_reviewed_by = ${input.reviewerId}, similarity_reviewed_at = ${now.toISOString()}::timestamptz,
             status = CASE WHEN ${input.decision} = 'reject' THEN 'REJECTED' ELSE status END,
             scan_provider = CASE WHEN ${input.decision} = 'reject' THEN 'haggle-similarity-review' ELSE scan_provider END,
             scan_detail = CASE WHEN ${input.decision} = 'reject' THEN 'CAMERA_SIMILARITY_REJECTED' ELSE scan_detail END,
             updated_at = ${now.toISOString()}::timestamptz
       WHERE id = ${input.uploadId}::uuid AND dispute_id = ${input.disputeId}::uuid
         AND status = 'QUARANTINED' AND similarity_status = 'REVIEW_REQUIRED'
         AND retention_status = 'ACTIVE' AND expires_at > ${now.toISOString()}::timestamptz
       RETURNING similarity_distance, similarity_signals
    `) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) return { outcome: "not_pending" as const };
    await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (${input.reviewerId}::uuid, 'dispute.evidence_similarity_review', 'dispute_evidence_upload', ${input.uploadId},
              jsonb_build_object('dispute_id', ${input.disputeId}::text, 'decision', ${input.decision}::text,
                                 'distance', ${rows[0].similarity_distance ?? null}::int,
                                 'signals', ${JSON.stringify(rows[0].similarity_signals ?? null)}::jsonb,
                                 'note', ${input.note.slice(0, 1000)}::text), ${now.toISOString()}::timestamptz)
    `);
    return { outcome: input.decision === "approve" ? "approved" as const : "rejected" as const };
  });
}

export async function updateDisputeEvidenceUploadScan(
  db: Database,
  uploadId: string,
  result: {
    status: "CLEAN" | "INFECTED" | "PENDING" | "FAILED" | "SKIPPED";
    sha256?: string;
    provider: string;
    detail: string;
  },
): Promise<void> {
  const retryable = result.status === "PENDING" || result.status === "FAILED";
  const now = new Date();
  await db
    .update(disputeEvidenceUploads)
    .set({
      status: result.status === "INFECTED" ? "REJECTED" : "QUARANTINED",
      scanStatus: result.status,
      contentSha256: result.sha256,
      scanProvider: result.provider,
      scanDetail: result.detail,
      scannedAt: result.status === "PENDING" ? null : now,
      scanNextAttemptAt: retryable ? now : null,
      scanLeaseToken: null,
      scanLeaseExpiresAt: null,
      scanLastError: retryable ? result.detail.slice(0, 200) : null,
      updatedAt: now,
    })
    .where(and(
      eq(disputeEvidenceUploads.id, uploadId),
      sql`${disputeEvidenceUploads.status} IN ('PENDING', 'QUARANTINED')`,
    ));
}

export async function rejectDisputeEvidenceUpload(
  db: Database,
  uploadId: string,
  provider: string,
  detail: string,
): Promise<void> {
  await db
    .update(disputeEvidenceUploads)
    .set({
      status: "REJECTED",
      scanProvider: provider,
      scanDetail: detail,
      updatedAt: new Date(),
    })
    .where(and(
      eq(disputeEvidenceUploads.id, uploadId),
      sql`${disputeEvidenceUploads.status} IN ('PENDING', 'QUARANTINED')`,
    ));
}

export async function listBlockingDisputeEvidenceUploads(
  db: Database,
  disputeId: string,
): Promise<DisputeEvidenceUploadRecord[]> {
  const rows = await db.query.disputeEvidenceUploads.findMany({
    where: (fields) => sql`
      ${fields.disputeId} = ${disputeId}
      AND ${fields.status} IN ('PENDING', 'QUARANTINED')
      AND ${fields.expiresAt} > now()
      AND (
        ${fields.scanStatus} NOT IN ('CLEAN', 'SKIPPED')
        OR (
          ${fields.cameraSessionId} IS NOT NULL
          AND ${fields.similarityStatus} NOT IN ('CLEAR', 'APPROVED', 'SKIPPED')
        )
      )
    `,
  });
  return rows as DisputeEvidenceUploadRecord[];
}

export interface DisputeModuleIdempotencyRecord {
  id: string;
  platformId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  disputeId: string;
  createdAt: Date;
}

export async function getDisputeModuleIdempotencyRecord(
  db: Database,
  platformId: string,
  idempotencyKey: string,
): Promise<DisputeModuleIdempotencyRecord | null> {
  const row = await db.query.disputeModuleIdempotencyKeys.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.platformId, platformId),
      ops.eq(fields.idempotencyKey, idempotencyKey),
    ),
  });
  return (row as DisputeModuleIdempotencyRecord | undefined) ?? null;
}

export async function createDisputeModuleIdempotencyRecord(
  db: Database,
  data: {
    platformId: string;
    idempotencyKey: string;
    requestFingerprint: string;
    disputeId: string;
  },
): Promise<DisputeModuleIdempotencyRecord> {
  const [row] = await db
    .insert(disputeModuleIdempotencyKeys)
    .values({
      platformId: data.platformId,
      idempotencyKey: data.idempotencyKey,
      requestFingerprint: data.requestFingerprint,
      disputeId: data.disputeId,
    })
    .returning();

  return row as DisputeModuleIdempotencyRecord;
}

export async function createDisputeResolutionRecord(
  db: Database,
  disputeId: string,
  resolution: DisputeResolution,
): Promise<void> {
  await db.insert(disputeResolutions).values({
    disputeId,
    outcome: resolution.outcome,
    summary: resolution.summary,
    refundAmountMinor: resolution.refund_amount_minor?.toString(),
    resolvedAt: resolution.resolved_at ? new Date(resolution.resolved_at) : undefined,
  }).onConflictDoNothing({ target: disputeResolutions.disputeId });
}
