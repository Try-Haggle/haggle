import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import type { DisputeEvidence } from "@haggle/dispute-core";
import { canonicalDisputeAuditJson } from "./dispute-ai-assessment-event.service.js";
import { normalizeDisputeAuditPublicKeyRecord } from "./dispute-audit-public-key-registry.service.js";
import { verifyTrustedDisputeEvidenceProvenance } from "./dispute-evidence-provenance.service.js";
import { assertDisputeModuleOutboundUrl } from "./dispute-module-outbound-url.service.js";
import {
  type DisputeSimilarityReviewAuditArchiveConfig,
  resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv,
} from "./dispute-similarity-review-audit-archive.service.js";

export interface DisputeEvidenceProvenanceArchiveRecord {
  id: string;
  archiveKey: string;
  evidenceId: string;
  disputeId: string;
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

function mapRow(row: Record<string, unknown>): DisputeEvidenceProvenanceArchiveRecord {
  return {
    id: String(row.id),
    archiveKey: String(row.archive_key),
    evidenceId: String(row.evidence_id),
    disputeId: String(row.dispute_id),
    payload: row.payload as Record<string, unknown>,
    payloadSha256: String(row.payload_sha256),
    status: String(row.status) as DisputeEvidenceProvenanceArchiveRecord["status"],
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: new Date(String(row.next_attempt_at)).toISOString(),
    leaseToken: row.lease_token ? String(row.lease_token) : null,
    leaseExpiresAt: row.lease_expires_at
      ? new Date(String(row.lease_expires_at)).toISOString()
      : null,
    lastError: row.last_error ? String(row.last_error) : null,
    httpStatus: row.http_status == null ? null : Number(row.http_status),
    receiptId: row.receipt_id ? String(row.receipt_id) : null,
    receiptSha256: row.receipt_sha256 ? String(row.receipt_sha256) : null,
    deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function getDisputeEvidenceProvenanceArchivePolicyStatus() {
  const configuredUrl = Boolean(process.env.HAGGLE_AUDIT_ARCHIVE_URL?.trim());
  let configurationState: "not_configured" | "invalid" | "valid" = configuredUrl
    ? "valid"
    : "not_configured";
  if (configuredUrl) {
    try {
      resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv();
    } catch {
      configurationState = "invalid";
    }
  }
  return {
    configured: configurationState === "valid",
    configurationState,
    jobEnabled: process.env.ENABLE_DISPUTE_EVIDENCE_PROVENANCE_ARCHIVE_JOB === "true",
  };
}

export async function enqueueDisputeEvidenceProvenanceArchive(
  db: Database,
  input: { evidence: DisputeEvidence; now?: Date },
) {
  const evidence = input.evidence;
  const artifacts = evidence.derived_artifacts ?? [];
  const provenance = evidence.derived_artifacts_provenance;
  if (!artifacts.length || !provenance || !evidence.source_content_sha256) {
    throw new Error("EVIDENCE_PROVENANCE_ARCHIVE_INPUT_INCOMPLETE");
  }
  const embeddedKey = normalizeDisputeAuditPublicKeyRecord({
    public_key_spki_base64: provenance.signature.public_key_spki_base64,
    status: "active",
    not_before: "1970-01-01T00:00:00.000Z",
  });
  const integrity = verifyTrustedDisputeEvidenceProvenance({
    provenance,
    artifacts,
    disputeId: evidence.dispute_id,
    evidenceId: evidence.id,
    sourceContentSha256: evidence.source_content_sha256,
    keys: [embeddedKey],
  });
  if (!integrity.valid) throw new Error("EVIDENCE_PROVENANCE_ARCHIVE_INTEGRITY_INVALID");
  const now = input.now ?? new Date();
  const payload = {
    schema: "haggle.dispute-evidence-provenance-archive.v1" as const,
    archived_at: now.toISOString(),
    dispute_id: evidence.dispute_id,
    evidence: {
      id: evidence.id,
      submitted_by: evidence.submitted_by,
      type: evidence.type,
      created_at: evidence.created_at,
      source_content_sha256: evidence.source_content_sha256,
      derived_artifacts: artifacts,
      derived_artifacts_provenance: provenance,
    },
  };
  const payloadRecord = payload as unknown as Record<string, unknown>;
  const payloadSha256 = createHash("sha256")
    .update(canonicalDisputeAuditJson(payloadRecord))
    .digest("hex");
  const archiveKey = `dep_${createHash("sha256")
    .update(
      [evidence.id, provenance.manifest.artifacts_sha256, provenance.signature.key_id].join(":"),
      "utf8",
    )
    .digest("hex")}`;
  const rows = (await db.execute(sql`
    INSERT INTO dispute_evidence_provenance_archive_outbox
      (archive_key, evidence_id, dispute_id, payload, payload_sha256, status, attempt_count,
       next_attempt_at, created_at, updated_at)
    VALUES (${archiveKey}, ${evidence.id}::uuid, ${evidence.dispute_id}::uuid, ${JSON.stringify(payloadRecord)}::jsonb,
      ${payloadSha256}, 'PENDING', 0, ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz)
    ON CONFLICT (archive_key) DO NOTHING RETURNING *
  `)) as unknown as Array<Record<string, unknown>>;
  if (rows[0]) return { outcome: "enqueued" as const, archive: mapRow(rows[0]) };
  const existing = (await db.execute(sql`
    SELECT * FROM dispute_evidence_provenance_archive_outbox WHERE archive_key = ${archiveKey}
  `)) as unknown as Array<Record<string, unknown>>;
  if (!existing[0]) throw new Error("EVIDENCE_PROVENANCE_ARCHIVE_IDEMPOTENCY_LOOKUP_FAILED");
  return { outcome: "duplicate" as const, archive: mapRow(existing[0]) };
}

export async function claimDisputeEvidenceProvenanceArchives(
  db: Database,
  input: { limit?: number; now?: Date; leaseMs?: number; archiveId?: string } = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const now = input.now ?? new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 120_000));
  const rows = (await db.execute(sql`
    WITH candidates AS (
      SELECT id FROM dispute_evidence_provenance_archive_outbox
       WHERE (${input.archiveId ?? null}::uuid IS NULL OR id = ${input.archiveId ?? null}::uuid)
         AND ((status IN ('PENDING', 'FAILED') AND next_attempt_at <= ${now.toISOString()}::timestamptz)
          OR (status = 'PROCESSING' AND lease_expires_at <= ${now.toISOString()}::timestamptz))
       ORDER BY next_attempt_at ASC, id ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED
    )
    UPDATE dispute_evidence_provenance_archive_outbox archive
       SET status = 'PROCESSING', lease_token = ${leaseToken}::uuid,
           lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
           attempt_count = attempt_count + 1, updated_at = ${now.toISOString()}::timestamptz
      FROM candidates WHERE archive.id = candidates.id RETURNING archive.*
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapRow);
}

export async function deliverDisputeEvidenceProvenanceArchive(
  archive: DisputeEvidenceProvenanceArchiveRecord,
  config: DisputeSimilarityReviewAuditArchiveConfig,
  input: { fetchImpl?: typeof fetch } = {},
) {
  assertDisputeModuleOutboundUrl(config.url, {
    label: "dispute evidence provenance archive",
    allowInsecureHttp: config.allowInsecureHttp,
    allowPrivateNetwork: config.allowPrivateNetwork,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await (input.fetchImpl ?? fetch)(config.url, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": archive.archiveKey,
        "x-haggle-content-sha256": archive.payloadSha256,
        ...(config.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {}),
      },
      body: canonicalDisputeAuditJson(archive.payload),
    });
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > 16_384) {
      return {
        status: "failed" as const,
        httpStatus: response.status,
        error: "ARCHIVE_RECEIPT_TOO_LARGE",
      };
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > 16_384) {
      return {
        status: "failed" as const,
        httpStatus: response.status,
        error: "ARCHIVE_RECEIPT_TOO_LARGE",
      };
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
    if (!response.ok)
      return {
        status: "failed" as const,
        httpStatus: response.status,
        error: `HTTP ${response.status}`,
      };
    const receiptId = typeof body.receipt_id === "string" ? body.receipt_id.trim() : "";
    const receiptSha256 =
      typeof body.stored_sha256 === "string" ? body.stored_sha256.toLowerCase() : "";
    if (!receiptId || receiptSha256 !== archive.payloadSha256) {
      return {
        status: "failed" as const,
        httpStatus: response.status,
        error: "ARCHIVE_RECEIPT_HASH_MISMATCH",
      };
    }
    return { status: "delivered" as const, httpStatus: response.status, receiptId, receiptSha256 };
  } catch (error) {
    return {
      status: "failed" as const,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchDisputeEvidenceProvenanceArchives(
  db: Database,
  input: {
    config?: DisputeSimilarityReviewAuditArchiveConfig | null;
    fetchImpl?: typeof fetch;
    now?: Date;
    limit?: number;
    archiveId?: string;
  } = {},
) {
  const config =
    input.config === undefined
      ? resolveDisputeSimilarityReviewAuditArchiveConfigFromEnv()
      : input.config;
  if (!config)
    return {
      status: "skipped" as const,
      reason: "not_configured" as const,
      claimed: 0,
      delivered: 0,
      failed: 0,
      deadLettered: 0,
    };
  const now = input.now ?? new Date();
  const claimed = await claimDisputeEvidenceProvenanceArchives(db, {
    limit: input.limit,
    now,
    archiveId: input.archiveId,
  });
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  for (const archive of claimed) {
    const result = await deliverDisputeEvidenceProvenanceArchive(archive, config, {
      fetchImpl: input.fetchImpl,
    });
    if (result.status === "delivered") {
      const rows = (await db.execute(sql`
        UPDATE dispute_evidence_provenance_archive_outbox
           SET status = 'DELIVERED', lease_token = NULL, lease_expires_at = NULL, last_error = NULL,
               http_status = ${result.httpStatus}, receipt_id = ${result.receiptId}, receipt_sha256 = ${result.receiptSha256},
               delivered_at = ${now.toISOString()}::timestamptz, updated_at = ${now.toISOString()}::timestamptz
         WHERE id = ${archive.id}::uuid AND status = 'PROCESSING' AND lease_token = ${archive.leaseToken}::uuid RETURNING id
      `)) as unknown as unknown[];
      if (rows.length === 1) delivered += 1;
      else failed += 1;
      continue;
    }
    const nextStatus = archive.attemptCount >= config.maxAttempts ? "DEAD_LETTER" : "FAILED";
    const retryAt = new Date(
      now.getTime() + Math.min(3_600_000, 2 ** Math.min(archive.attemptCount, 10) * 1000),
    );
    await db.execute(sql`
      UPDATE dispute_evidence_provenance_archive_outbox
         SET status = ${nextStatus}, lease_token = NULL, lease_expires_at = NULL,
             last_error = ${(result.error ?? "archive delivery failed").slice(0, 1000)},
             http_status = ${result.httpStatus ?? null}, next_attempt_at = ${retryAt.toISOString()}::timestamptz,
             updated_at = ${now.toISOString()}::timestamptz
       WHERE id = ${archive.id}::uuid AND status = 'PROCESSING' AND lease_token = ${archive.leaseToken}::uuid
    `);
    if (nextStatus === "DEAD_LETTER") deadLettered += 1;
    else failed += 1;
  }
  return { status: "processed" as const, claimed: claimed.length, delivered, failed, deadLettered };
}

export async function getDisputeEvidenceProvenanceArchiveHealth(db: Database, now = new Date()) {
  const rows = (await db.execute(sql`
    WITH delivery AS (
      SELECT count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
        count(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
        count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
        count(*) FILTER (WHERE status = 'DEAD_LETTER')::int AS dead_letter,
        count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
        count(*) FILTER (WHERE status = 'PROCESSING' AND lease_expires_at <= ${now.toISOString()}::timestamptz)::int AS stale_processing,
        count(*) FILTER (WHERE status = 'FAILED' AND next_attempt_at <= ${now.toISOString()}::timestamptz)::int AS retry_ready
      FROM dispute_evidence_provenance_archive_outbox
    ), coverage AS (
      SELECT count(*)::int AS eligible_evidence,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM dispute_evidence_provenance_archive_outbox archive WHERE archive.evidence_id = evidence.id
        ))::int AS archived_evidence
      FROM dispute_evidence evidence WHERE evidence.derived_artifacts_provenance IS NOT NULL
    )
    SELECT delivery.*, coverage.*, (coverage.eligible_evidence - coverage.archived_evidence)::int AS coverage_gap
      FROM delivery CROSS JOIN coverage
  `)) as unknown as Array<Record<string, unknown>>;
  const row = rows[0] ?? {};
  const deadLetter = Number(row.dead_letter ?? 0);
  const failed = Number(row.failed ?? 0);
  const staleProcessing = Number(row.stale_processing ?? 0);
  const eligibleEvidence = Number(row.eligible_evidence ?? 0);
  const archivedEvidence = Number(row.archived_evidence ?? 0);
  const coverageGap = Number(row.coverage_gap ?? 0);
  return {
    status:
      deadLetter > 0 || coverageGap > 0
        ? ("critical" as const)
        : failed > 0 || staleProcessing > 0
          ? ("attention" as const)
          : ("healthy" as const),
    pending: Number(row.pending ?? 0),
    processing: Number(row.processing ?? 0),
    failed,
    deadLetter,
    delivered: Number(row.delivered ?? 0),
    staleProcessing,
    retryReady: Number(row.retry_ready ?? 0),
    eligibleEvidence,
    archivedEvidence,
    coverageGap,
    coveragePercent:
      eligibleEvidence === 0
        ? 100
        : Math.round((archivedEvidence / eligibleEvidence) * 10_000) / 100,
    recordedAt: now.toISOString(),
  };
}

interface ProvenanceArchiveFailureCursor {
  createdAt: string;
  id: string;
}
function decodeProvenanceArchiveFailureCursor(value: string): ProvenanceArchiveFailureCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ProvenanceArchiveFailureCursor>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      throw new Error("invalid");
    }
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch {
    throw new Error("INVALID_EVIDENCE_PROVENANCE_ARCHIVE_FAILURE_CURSOR");
  }
}
function encodeProvenanceArchiveFailureCursor(value: ProvenanceArchiveFailureCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export async function listDisputeEvidenceProvenanceArchiveFailures(
  db: Database,
  input: { limit?: number; cursor?: string; now?: Date } = {},
) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("INVALID_EVIDENCE_PROVENANCE_ARCHIVE_FAILURE_LIMIT");
  }
  const cursor = input.cursor ? decodeProvenanceArchiveFailureCursor(input.cursor) : null;
  const now = input.now ?? new Date();
  const rows = (await db.execute(sql`
    SELECT * FROM dispute_evidence_provenance_archive_outbox
     WHERE status IN ('FAILED', 'DEAD_LETTER')
       ${cursor ? sql`AND (created_at, id) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql``}
     ORDER BY created_at ASC, id ASC LIMIT ${limit + 1}
  `)) as unknown as Array<Record<string, unknown>>;
  const hasMore = rows.length > limit;
  const records = (hasMore ? rows.slice(0, limit) : rows).map(mapRow);
  const items = records.map((record) => ({
    archiveId: record.id,
    evidenceId: record.evidenceId,
    disputeId: record.disputeId,
    payloadSha256: record.payloadSha256,
    status: record.status,
    attemptCount: record.attemptCount,
    nextAttemptAt: record.nextAttemptAt,
    lastError: record.lastError?.slice(0, 500) ?? null,
    httpStatus: record.httpStatus,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    failureAgeSeconds: Math.max(
      0,
      Math.floor((now.getTime() - new Date(record.updatedAt).getTime()) / 1000),
    ),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeProvenanceArchiveFailureCursor({ createdAt: last.createdAt, id: last.archiveId })
        : null,
    recordedAt: now.toISOString(),
  };
}

export async function requeueDisputeEvidenceProvenanceArchive(
  db: Database,
  input: { archiveId: string; actorId: string; reason: string; now?: Date },
) {
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 500) return { outcome: "invalid_reason" as const };
  const now = input.now ?? new Date();
  return db.transaction(async (transaction) => {
    const tx = transaction as unknown as Database;
    const rows = (await tx.execute(sql`
      SELECT * FROM dispute_evidence_provenance_archive_outbox WHERE id = ${input.archiveId}::uuid FOR UPDATE
    `)) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) return { outcome: "not_found" as const };
    const current = mapRow(rows[0]);
    if (current.status === "PENDING" || current.status === "PROCESSING") {
      return { outcome: "already_queued" as const, archive: current };
    }
    if (current.status === "DELIVERED")
      return { outcome: "already_delivered" as const, archive: current };
    const updated = (await tx.execute(sql`
      UPDATE dispute_evidence_provenance_archive_outbox
         SET status = 'PENDING', attempt_count = 0, next_attempt_at = ${now.toISOString()}::timestamptz,
             lease_token = NULL, lease_expires_at = NULL, last_error = NULL, http_status = NULL,
             receipt_id = NULL, receipt_sha256 = NULL, delivered_at = NULL, updated_at = ${now.toISOString()}::timestamptz
       WHERE id = ${current.id}::uuid AND status IN ('FAILED', 'DEAD_LETTER') RETURNING *
    `)) as unknown as Array<Record<string, unknown>>;
    if (!updated[0]) throw new Error("EVIDENCE_PROVENANCE_ARCHIVE_REQUEUE_CONFLICT");
    await tx.execute(sql`
      INSERT INTO admin_action_log (actor_id, action_type, target_type, target_id, payload, created_at)
      VALUES (${input.actorId}::uuid, 'dispute.evidence_provenance_archive_requeue',
        'dispute_evidence_provenance_archive_outbox', ${current.id},
        jsonb_build_object('evidence_id', ${current.evidenceId}::text, 'dispute_id', ${current.disputeId}::text,
          'payload_sha256', ${current.payloadSha256}::text, 'previous_status', ${current.status}::text,
          'previous_attempt_count', ${current.attemptCount}::int, 'reason', ${reason}::text),
        ${now.toISOString()}::timestamptz)
    `);
    return { outcome: "requeued" as const, archive: mapRow(updated[0]) };
  });
}
