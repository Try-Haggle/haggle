import { randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";

export interface EvidenceRetentionPolicy {
  committedDays: number;
  orphanDays: number;
  batchSize: number;
}

export interface EvidenceRetentionClaim {
  uploadId: string;
  disputeId: string;
  storagePath: string;
  claimId: string;
  deletionAttempts: number;
  retentionUntil: Date;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function evidenceRetentionPolicy(): EvidenceRetentionPolicy {
  return {
    committedDays: boundedInteger(process.env.DISPUTE_EVIDENCE_RETENTION_DAYS, 90, 30, 3650),
    orphanDays: boundedInteger(process.env.DISPUTE_EVIDENCE_ORPHAN_RETENTION_DAYS, 7, 1, 90),
    batchSize: boundedInteger(process.env.DISPUTE_EVIDENCE_RETENTION_BATCH_SIZE, 50, 1, 500),
  };
}

export async function countEligibleEvidenceRetention(
  db: Database,
  policy = evidenceRetentionPolicy(),
): Promise<number> {
  const rows = await db.execute(sql`
    SELECT count(*)::int AS count
      FROM dispute_evidence_uploads u
      JOIN dispute_cases d ON d.id = u.dispute_id
     WHERE d.evidence_legal_hold = false
       AND u.retention_status IN ('ACTIVE', 'FAILED')
       AND (u.deletion_next_attempt_at IS NULL OR u.deletion_next_attempt_at <= now())
       AND (
         (u.status = 'COMMITTED'
           AND COALESCE(d.closed_at, d.resolved_at) IS NOT NULL
           AND COALESCE(d.closed_at, d.resolved_at) + (${policy.committedDays} * interval '1 day') <= now())
         OR
         (u.status <> 'COMMITTED'
           AND u.expires_at + (${policy.orphanDays} * interval '1 day') <= now())
       )
  `) as unknown as Array<{ count: number | string }>;
  return Number(rows[0]?.count ?? 0);
}

export async function claimEvidenceRetentionBatch(
  db: Database,
  policy = evidenceRetentionPolicy(),
): Promise<EvidenceRetentionClaim[]> {
  const claimId = randomUUID();
  const rows = await db.execute(sql`
    WITH candidates AS (
      SELECT u.id,
             CASE
               WHEN u.status = 'COMMITTED'
                 THEN COALESCE(d.closed_at, d.resolved_at) + (${policy.committedDays} * interval '1 day')
               ELSE u.expires_at + (${policy.orphanDays} * interval '1 day')
             END AS retention_until
        FROM dispute_evidence_uploads u
        JOIN dispute_cases d ON d.id = u.dispute_id
       WHERE d.evidence_legal_hold = false
         AND u.retention_status IN ('ACTIVE', 'FAILED')
         AND (u.deletion_next_attempt_at IS NULL OR u.deletion_next_attempt_at <= now())
         AND (
           (u.status = 'COMMITTED'
             AND COALESCE(d.closed_at, d.resolved_at) IS NOT NULL
             AND COALESCE(d.closed_at, d.resolved_at) + (${policy.committedDays} * interval '1 day') <= now())
           OR
           (u.status <> 'COMMITTED'
             AND u.expires_at + (${policy.orphanDays} * interval '1 day') <= now())
         )
       ORDER BY retention_until ASC, u.id ASC
       FOR UPDATE OF u, d SKIP LOCKED
       LIMIT ${policy.batchSize}
    )
    UPDATE dispute_evidence_uploads u
       SET retention_status = 'DELETING',
           retention_until = candidates.retention_until,
           deletion_claim_id = ${claimId},
           deletion_claimed_at = now(),
           deletion_attempts = u.deletion_attempts + 1,
           deletion_last_error = NULL,
           updated_at = now()
      FROM candidates
     WHERE u.id = candidates.id
    RETURNING u.id AS "uploadId", u.dispute_id AS "disputeId", u.storage_path AS "storagePath",
              u.deletion_claim_id AS "claimId", u.deletion_attempts AS "deletionAttempts",
              u.retention_until AS "retentionUntil"
  `) as unknown as Array<{
    uploadId: string;
    disputeId: string;
    storagePath: string;
    claimId: string;
    deletionAttempts: number | string;
    retentionUntil: Date | string;
  }>;
  return rows.map((row) => ({
    ...row,
    deletionAttempts: Number(row.deletionAttempts),
    retentionUntil: row.retentionUntil instanceof Date ? row.retentionUntil : new Date(row.retentionUntil),
  }));
}

export async function retentionClaimStillAuthorized(
  db: Database,
  claim: EvidenceRetentionClaim,
): Promise<boolean> {
  const rows = await db.execute(sql`
    SELECT u.id
      FROM dispute_evidence_uploads u
      JOIN dispute_cases d ON d.id = u.dispute_id
     WHERE u.id = ${claim.uploadId}
       AND u.deletion_claim_id = ${claim.claimId}
       AND u.retention_status = 'DELETING'
       AND d.evidence_legal_hold = false
     LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return rows.length === 1;
}

export async function releaseRetentionClaimForHold(
  db: Database,
  claim: EvidenceRetentionClaim,
): Promise<void> {
  await db.execute(sql`
    UPDATE dispute_evidence_uploads
       SET retention_status = 'ACTIVE', deletion_claim_id = NULL, deletion_claimed_at = NULL, updated_at = now()
     WHERE id = ${claim.uploadId} AND deletion_claim_id = ${claim.claimId} AND retention_status = 'DELETING'
  `);
}

export async function completeEvidenceRetentionDeletion(
  db: Database,
  claim: EvidenceRetentionClaim,
): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE dispute_evidence_uploads
       SET retention_status = 'DELETED', deleted_at = now(), deletion_claim_id = NULL,
           deletion_claimed_at = NULL, deletion_next_attempt_at = NULL, deletion_last_error = NULL, updated_at = now()
     WHERE id = ${claim.uploadId} AND deletion_claim_id = ${claim.claimId} AND retention_status = 'DELETING'
     RETURNING id
  `) as unknown as Array<{ id: string }>;
  if (rows.length === 1) return true;
  const reconciled = await db.execute(sql`
    UPDATE dispute_evidence_uploads
       SET retention_status = 'DELETED', deleted_at = COALESCE(deleted_at, now()),
           deletion_claim_id = NULL, deletion_claimed_at = NULL, deletion_next_attempt_at = NULL,
           deletion_last_error = 'CLAIM_RECONCILED_AFTER_STORAGE_DELETE', updated_at = now()
     WHERE id = ${claim.uploadId} AND retention_status <> 'DELETED'
     RETURNING id
  `) as unknown as Array<{ id: string }>;
  if (reconciled.length === 1) return true;
  const existing = await db.execute(sql`
    SELECT id FROM dispute_evidence_uploads WHERE id = ${claim.uploadId} AND retention_status = 'DELETED'
  `) as unknown as Array<{ id: string }>;
  return existing.length === 1;
}

export async function failEvidenceRetentionDeletion(
  db: Database,
  claim: EvidenceRetentionClaim,
): Promise<void> {
  const delayMinutes = Math.min(24 * 60, 2 ** Math.min(claim.deletionAttempts, 10));
  await db.execute(sql`
    UPDATE dispute_evidence_uploads
       SET retention_status = 'FAILED', deletion_claim_id = NULL, deletion_claimed_at = NULL,
           deletion_next_attempt_at = now() + (${delayMinutes} * interval '1 minute'),
           deletion_last_error = 'STORAGE_DELETE_FAILED', updated_at = now()
     WHERE id = ${claim.uploadId} AND deletion_claim_id = ${claim.claimId} AND retention_status = 'DELETING'
  `);
}

export async function setDisputeEvidenceLegalHold(
  db: Database,
  input: { disputeId: string; active: boolean; reason: string; actorId: string },
): Promise<boolean> {
  const rows = input.active
    ? await db.execute(sql`
        WITH locked AS (
          SELECT id FROM dispute_cases WHERE id = ${input.disputeId} FOR UPDATE
        )
        UPDATE dispute_cases d
           SET evidence_legal_hold = true, evidence_legal_hold_reason = ${input.reason},
               evidence_legal_hold_set_by = ${input.actorId}, evidence_legal_hold_set_at = now(), updated_at = now()
          FROM locked
         WHERE d.id = locked.id
           AND NOT EXISTS (
             SELECT 1 FROM dispute_evidence_uploads u
              WHERE u.dispute_id = d.id AND u.retention_status = 'DELETING'
           )
        RETURNING d.id
      `)
    : await db.execute(sql`
        UPDATE dispute_cases
           SET evidence_legal_hold = false, evidence_legal_hold_reason = NULL,
               evidence_legal_hold_set_by = NULL, evidence_legal_hold_set_at = NULL, updated_at = now()
         WHERE id = ${input.disputeId}
        RETURNING id
      `);
  return (rows as unknown as Array<{ id: string }>).length === 1;
}

export async function getDisputeEvidenceRetentionSummary(db: Database, disputeId: string) {
  const policy = evidenceRetentionPolicy();
  const rows = await db.execute(sql`
    SELECT d.evidence_legal_hold AS "legalHold", d.evidence_legal_hold_reason AS "legalHoldReason",
           d.evidence_legal_hold_set_by AS "legalHoldSetBy", d.evidence_legal_hold_set_at AS "legalHoldSetAt",
           count(u.id)::int AS total,
           count(u.id) FILTER (WHERE u.retention_status = 'ACTIVE')::int AS active,
           count(u.id) FILTER (WHERE u.retention_status = 'DELETING')::int AS deleting,
           count(u.id) FILTER (WHERE u.retention_status = 'FAILED')::int AS failed,
           count(u.id) FILTER (WHERE u.retention_status = 'DELETED')::int AS deleted,
           min(COALESCE(
             u.retention_until,
             CASE
               WHEN u.status = 'COMMITTED' AND COALESCE(d.closed_at, d.resolved_at) IS NOT NULL
                 THEN COALESCE(d.closed_at, d.resolved_at) + (${policy.committedDays} * interval '1 day')
               WHEN u.status <> 'COMMITTED'
                 THEN u.expires_at + (${policy.orphanDays} * interval '1 day')
             END
           )) FILTER (WHERE u.retention_status <> 'DELETED') AS "nextRetentionAt"
      FROM dispute_cases d
      LEFT JOIN dispute_evidence_uploads u ON u.dispute_id = d.id
     WHERE d.id = ${disputeId}
     GROUP BY d.id
  `) as unknown as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}
