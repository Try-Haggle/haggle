import { sql, type Database } from "@haggle/db";

const RETENTION_LOCK_KEY =
  "haggle:dispute-evidence-scan-retry-alert-snapshot-retention";
const RETENTION_DAYS = 30;

function boundedBatchSize(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error(
      "dispute evidence scan retry alert snapshot retention batch size must be 1..1000",
    );
  }
  return value;
}
export function getDisputeEvidenceScanRetryAlertSnapshotRetentionPolicy() {
  return {
    retentionDays: RETENTION_DAYS,
    batchSize: boundedBatchSize(
      process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_RETENTION_BATCH_SIZE,
    ),
    jobEnabled:
      process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB === "true",
    cronEnabled: process.env.ENABLE_CRON === "true",
  };
}

export async function getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth(
  db: Database,
  source?: string,
) {
  const sourceFilter = source ? sql`AND s.source = ${source}` : sql``;
  const rows = await db.execute(sql`
    SELECT count(*) FILTER (
             WHERE s.expires_at <= now() AND w.status = 'COMPLETED'
           )::int AS "eligibleExpired",
           count(*) FILTER (
             WHERE s.expires_at <= now()
               AND (w.id IS NULL OR w.status <> 'COMPLETED')
           )::int AS "blockedExpired",
           extract(epoch FROM now() - min(s.expires_at) FILTER (
             WHERE s.expires_at <= now()
               AND (w.id IS NULL OR w.status <> 'COMPLETED')
           ))::int AS "oldestBlockedExpiredAgeSeconds"
      FROM dispute_evidence_scan_retry_alert_snapshots s
      LEFT JOIN webhook_idempotency w
        ON w.source = s.source AND w.idempotency_key = s.delivery_id
     WHERE true ${sourceFilter}
  `) as unknown as Array<Record<string, number | string | null>>;
  const row = rows[0] ?? {};
  const eligibleExpired = Number(row.eligibleExpired ?? 0);
  const blockedExpired = Number(row.blockedExpired ?? 0);
  const policy = getDisputeEvidenceScanRetryAlertSnapshotRetentionPolicy();
  return {
    status: blockedExpired > 0 ? "attention" as const : "healthy" as const,
    eligibleExpired,
    blockedExpired,
    oldestBlockedExpiredAgeSeconds:
      row.oldestBlockedExpiredAgeSeconds === null
        || row.oldestBlockedExpiredAgeSeconds === undefined
        ? null : Math.max(0, Number(row.oldestBlockedExpiredAgeSeconds)),
    policy,
    containsIdentifiers: false,
    recordedAt: new Date().toISOString(),
  };
}

export async function runDisputeEvidenceScanRetryAlertSnapshotRetention(
  db: Database,
  options: {
    batchSize?: number;
    onLockAcquired?: () => Promise<void>;
  } = {},
) {
  const batchSize = options.batchSize ??
    getDisputeEvidenceScanRetryAlertSnapshotRetentionPolicy().batchSize;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new Error("invalid scan retry alert snapshot retention batch size");
  }
  return db.transaction(async (tx) => {
    const lockRows = await tx.execute(sql`
      SELECT pg_try_advisory_xact_lock(
        hashtextextended(${RETENTION_LOCK_KEY}, 0)
      ) AS acquired
    `) as unknown as Array<{ acquired: boolean }>;
    if (lockRows[0]?.acquired !== true) {
      return {
        status: "skipped" as const,
        reason: "retention_lock_held" as const,
        deleted: 0,
      };
    }
    await options.onLockAcquired?.();
    await tx.execute(sql`
      SET LOCAL haggle.allow_scan_retry_alert_snapshot_retention = 'on'
    `);
    const deleted = await tx.execute(sql`
      WITH candidates AS (
        SELECT s.id
          FROM dispute_evidence_scan_retry_alert_snapshots s
          JOIN webhook_idempotency w
            ON w.source = s.source AND w.idempotency_key = s.delivery_id
         WHERE s.expires_at <= now() AND w.status = 'COMPLETED'
         ORDER BY s.expires_at ASC, s.id ASC
         LIMIT ${batchSize}
         FOR UPDATE OF s SKIP LOCKED
      )
      DELETE FROM dispute_evidence_scan_retry_alert_snapshots s
       USING candidates c
       WHERE s.id = c.id
      RETURNING s.id
    `) as unknown as Array<{ id: string }>;
    return {
      status: "executed" as const,
      deleted: deleted.length,
      batchSize,
      containsIdentifiers: false,
    };
  });
}
