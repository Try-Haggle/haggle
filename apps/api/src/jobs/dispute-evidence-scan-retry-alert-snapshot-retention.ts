import { randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { runDisputeEvidenceScanRetryAlertSnapshotRetention } from
  "../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js";

const JOB_KEY = "snapshot_retention";
const LEASE_MS = 15 * 60_000;
const INTERVAL_SECONDS = 24 * 60 * 60;
const MAX_START_DELAY_SECONDS = 26 * 60 * 60;

export interface DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth {
  status: "inactive" | "healthy" | "attention" | "critical";
  lastRunStatus: "NEVER" | "RUNNING" | "STALE_RUNNING" | "SUCCEEDED" | "FAILED";
  overdue: boolean;
  leaseStale: boolean;
  firstObservedAt: string | null;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastDeletedSnapshots: number;
  lastFailureCode: "RETENTION_EXECUTION_FAILED" | null;
  policy: {
    jobEnabled: boolean;
    cronEnabled: boolean;
    intervalSeconds: number;
    leaseSeconds: number;
    maxStartDelaySeconds: number;
  };
  containsIdentifiers: false;
  recordedAt: string;
}

export function getDisputeEvidenceScanRetryAlertSnapshotRetentionJobStatus() {
  return {
    jobEnabled:
      process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB === "true",
    cronEnabled: process.env.ENABLE_CRON === "true",
    intervalSeconds: INTERVAL_SECONDS,
    leaseSeconds: LEASE_MS / 1_000,
    maxStartDelaySeconds: MAX_START_DELAY_SECONDS,
  };
}

async function claimRun(db: Database, now: Date) {
  const claimId = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const rows = await db.execute(sql`
    INSERT INTO dispute_evidence_scan_retry_alert_snapshot_retention_state
      (job_key, status, claim_id, lease_expires_at, first_observed_at,
       last_started_at, updated_at)
    VALUES (${JOB_KEY}, 'RUNNING', ${claimId}::uuid,
      ${leaseExpiresAt.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz)
    ON CONFLICT (job_key) DO UPDATE
      SET status = 'RUNNING', claim_id = EXCLUDED.claim_id,
          lease_expires_at = EXCLUDED.lease_expires_at,
          last_started_at = EXCLUDED.last_started_at,
          last_failure_code = NULL, updated_at = EXCLUDED.updated_at
    WHERE dispute_evidence_scan_retry_alert_snapshot_retention_state.status <> 'RUNNING'
       OR dispute_evidence_scan_retry_alert_snapshot_retention_state.lease_expires_at
          <= ${now.toISOString()}::timestamptz
    RETURNING claim_id
  `) as unknown as Array<{ claim_id: string }>;
  return rows[0]
    ? { acquired: true as const, claimId }
    : { acquired: false as const, claimId: null };
}

async function completeRun(
  db: Database,
  claimId: string,
  now: Date,
  deleted: number,
) {
  const rows = await db.execute(sql`
    UPDATE dispute_evidence_scan_retry_alert_snapshot_retention_state
       SET status = 'SUCCEEDED', claim_id = NULL, lease_expires_at = NULL,
           last_succeeded_at = ${now.toISOString()}::timestamptz,
           last_deleted_snapshots = ${deleted}, last_failure_code = NULL,
           updated_at = ${now.toISOString()}::timestamptz
     WHERE job_key = ${JOB_KEY} AND status = 'RUNNING'
       AND claim_id = ${claimId}::uuid
    RETURNING status
  `) as unknown as Array<{ status: string }>;
  if (!rows[0]) {
    throw new Error("SCAN_RETRY_ALERT_SNAPSHOT_RETENTION_LEASE_LOST");
  }
}

async function failRun(db: Database, claimId: string, now: Date) {
  await db.execute(sql`
    UPDATE dispute_evidence_scan_retry_alert_snapshot_retention_state
       SET status = 'FAILED', claim_id = NULL, lease_expires_at = NULL,
           last_failed_at = ${now.toISOString()}::timestamptz,
           last_failure_code = 'RETENTION_EXECUTION_FAILED',
           updated_at = ${now.toISOString()}::timestamptz
     WHERE job_key = ${JOB_KEY} AND status = 'RUNNING'
       AND claim_id = ${claimId}::uuid
  `);
}

export async function getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(
  db: Database,
  now = new Date(),
): Promise<DisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth> {
  const rows = await db.execute(sql`
    SELECT status, lease_expires_at, first_observed_at, last_started_at,
           last_succeeded_at, last_failed_at, last_deleted_snapshots,
           last_failure_code
      FROM dispute_evidence_scan_retry_alert_snapshot_retention_state
     WHERE job_key = ${JOB_KEY}
     LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  const policy = getDisputeEvidenceScanRetryAlertSnapshotRetentionJobStatus();
  const rawStatus = row?.status
    ? String(row.status) as "NEVER" | "RUNNING" | "SUCCEEDED" | "FAILED"
    : "NEVER";
  const leaseStale = rawStatus === "RUNNING" && row?.lease_expires_at != null
    && new Date(String(row.lease_expires_at)).getTime() <= now.getTime();
  const lastRunStatus = leaseStale ? "STALE_RUNNING" as const : rawStatus;
  const firstObservedAt = row?.first_observed_at
    ? new Date(String(row.first_observed_at)).toISOString() : null;
  const lastSucceededAt = row?.last_succeeded_at
    ? new Date(String(row.last_succeeded_at)).toISOString() : null;
  const baseline = lastSucceededAt ?? firstObservedAt;
  const overdue = Boolean(baseline
    && now.getTime() - new Date(baseline).getTime()
      >= MAX_START_DELAY_SECONDS * 1_000);
  const active = policy.jobEnabled && policy.cronEnabled;
  const status = !active ? "inactive" as const
    : leaseStale ? "critical" as const
      : rawStatus === "FAILED" || overdue ? "attention" as const
        : "healthy" as const;
  return {
    status,
    lastRunStatus,
    overdue,
    leaseStale,
    firstObservedAt,
    lastStartedAt: row?.last_started_at
      ? new Date(String(row.last_started_at)).toISOString() : null,
    lastSucceededAt,
    lastFailedAt: row?.last_failed_at
      ? new Date(String(row.last_failed_at)).toISOString() : null,
    lastDeletedSnapshots: Number(row?.last_deleted_snapshots ?? 0),
    lastFailureCode: row?.last_failure_code === "RETENTION_EXECUTION_FAILED"
      ? "RETENTION_EXECUTION_FAILED" : null,
    policy,
    containsIdentifiers: false,
    recordedAt: now.toISOString(),
  };
}

export async function runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(
  db: Database,
  options: {
    now?: Date;
    finishedAt?: Date;
    batchSize?: number;
    onLockAcquired?: () => Promise<void>;
  } = {},
) {
  const now = options.now ?? new Date();
  const claim = await claimRun(db, now);
  if (!claim.acquired) {
    return {
      status: "skipped" as const,
      reason: "retention_run_in_progress" as const,
      deleted: 0,
    };
  }
  try {
    const result = await runDisputeEvidenceScanRetryAlertSnapshotRetention(db, {
      batchSize: options.batchSize,
      onLockAcquired: options.onLockAcquired,
    });
    await completeRun(
      db,
      claim.claimId,
      options.finishedAt ?? new Date(),
      result.deleted,
    );
    console.log(
      `[dispute-evidence-scan-retry-alert-snapshot-retention] status=${result.status} deleted=${result.deleted}`,
    );
    return result;
  } catch (error) {
    await failRun(db, claim.claimId, options.finishedAt ?? new Date())
      .catch(() => undefined);
    throw error;
  }
}
