import { randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY } from "../services/payment-test-operation-lease.service.js";
import { maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics } from "../services/shipment-apv-invoice-restoration-remediation.service.js";

function boundedInteger(
  raw: string | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const value = Number(raw ?? String(fallback));
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

const JOB_KEY = "cursor_retention";
const LEASE_MS = 15 * 60_000;

export interface ShipmentApvRemediationCursorRetentionJobHealth {
  lastRunStatus: "NEVER" | "RUNNING" | "STALE_RUNNING" | "SUCCEEDED" | "FAILED";
  leaseStale: boolean;
  firstObservedAt: string | null;
  lastStartedAt: string | null;
  lastSucceededAt: string | null;
  lastFailedAt: string | null;
  lastDeletedBuckets: number;
  lastExpiredBuckets: number;
  lastInvalidBuckets: number;
  lastTruncated: boolean;
  lastFailureCode: string | null;
  recordedAt: string;
}

async function claimRetentionRun(db: Database, now: Date, fixtureLeaseId?: string) {
  const claimId = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
  const rows = await db.execute(sql`INSERT INTO shipment_apv_remediation_cursor_retention_state
      (job_key,status,claim_id,lease_expires_at,last_started_at,updated_at)
    SELECT ${JOB_KEY},'RUNNING',${claimId}::uuid,${leaseExpiresAt.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz,${now.toISOString()}::timestamptz
    WHERE NOT EXISTS (
      SELECT 1 FROM payment_test_operation_leases
       WHERE key=${SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY}
         AND expires_at > ${now.toISOString()}::timestamptz
         AND (${fixtureLeaseId ?? null}::uuid IS NULL OR lease_id <> ${fixtureLeaseId ?? null}::uuid)
    )
    ON CONFLICT (job_key) DO UPDATE SET status='RUNNING',claim_id=EXCLUDED.claim_id,
      lease_expires_at=EXCLUDED.lease_expires_at,last_started_at=EXCLUDED.last_started_at,
      updated_at=EXCLUDED.updated_at,last_failure_code=NULL
    WHERE (shipment_apv_remediation_cursor_retention_state.status <> 'RUNNING'
      OR shipment_apv_remediation_cursor_retention_state.lease_expires_at <= ${now.toISOString()}::timestamptz)
      AND NOT EXISTS (
        SELECT 1 FROM payment_test_operation_leases
         WHERE key=${SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY}
           AND expires_at > ${now.toISOString()}::timestamptz
           AND (${fixtureLeaseId ?? null}::uuid IS NULL OR lease_id <> ${fixtureLeaseId ?? null}::uuid)
      )
    RETURNING claim_id`);
  return rows[0]
    ? { acquired: true as const, claimId }
    : { acquired: false as const, claimId: null };
}

async function completeRetentionRun(
  db: Database,
  claimId: string,
  now: Date,
  maintenance: {
    deletedBuckets?: number;
    expiredBuckets: number;
    invalidBuckets: number;
    truncated: boolean;
  },
) {
  const rows = await db.execute(sql`UPDATE shipment_apv_remediation_cursor_retention_state
    SET status='SUCCEEDED',claim_id=NULL,lease_expires_at=NULL,
        last_succeeded_at=${now.toISOString()}::timestamptz,
        last_deleted_buckets=${maintenance.deletedBuckets ?? 0},
        last_expired_buckets=${maintenance.expiredBuckets},
        last_invalid_buckets=${maintenance.invalidBuckets},last_truncated=${maintenance.truncated},
        last_failure_code=NULL,updated_at=${now.toISOString()}::timestamptz
    WHERE job_key=${JOB_KEY} AND status='RUNNING' AND claim_id=${claimId}::uuid
    RETURNING status`);
  if (!rows[0]) throw new Error("APV_REMEDIATION_CURSOR_RETENTION_LEASE_LOST");
}

async function failRetentionRun(db: Database, claimId: string, now: Date) {
  await db.execute(sql`UPDATE shipment_apv_remediation_cursor_retention_state
    SET status='FAILED',claim_id=NULL,lease_expires_at=NULL,
        last_failed_at=${now.toISOString()}::timestamptz,
        last_failure_code='RETENTION_EXECUTION_FAILED',updated_at=${now.toISOString()}::timestamptz
    WHERE job_key=${JOB_KEY} AND status='RUNNING' AND claim_id=${claimId}::uuid`);
}

export async function getShipmentApvRemediationCursorRetentionJobHealth(
  db: Database,
  now = new Date(),
): Promise<ShipmentApvRemediationCursorRetentionJobHealth> {
  const rows =
    await db.execute(sql`SELECT status,lease_expires_at,first_observed_at,last_started_at,last_succeeded_at,
      last_failed_at,last_deleted_buckets,last_expired_buckets,last_invalid_buckets,last_truncated,
      last_failure_code
    FROM shipment_apv_remediation_cursor_retention_state WHERE job_key=${JOB_KEY} LIMIT 1`);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row)
    return {
      lastRunStatus: "NEVER" as const,
      leaseStale: false,
      firstObservedAt: null,
      lastStartedAt: null,
      lastSucceededAt: null,
      lastFailedAt: null,
      lastDeletedBuckets: 0,
      lastExpiredBuckets: 0,
      lastInvalidBuckets: 0,
      lastTruncated: false,
      lastFailureCode: null,
      recordedAt: now.toISOString(),
    };
  const leaseStale =
    row.status === "RUNNING" &&
    row.lease_expires_at != null &&
    new Date(String(row.lease_expires_at)).getTime() <= now.getTime();
  return {
    lastRunStatus: leaseStale
      ? ("STALE_RUNNING" as const)
      : (String(row.status) as "NEVER" | "RUNNING" | "SUCCEEDED" | "FAILED"),
    leaseStale,
    firstObservedAt: row.first_observed_at
      ? new Date(String(row.first_observed_at)).toISOString()
      : null,
    lastStartedAt: row.last_started_at ? new Date(String(row.last_started_at)).toISOString() : null,
    lastSucceededAt: row.last_succeeded_at
      ? new Date(String(row.last_succeeded_at)).toISOString()
      : null,
    lastFailedAt: row.last_failed_at ? new Date(String(row.last_failed_at)).toISOString() : null,
    lastDeletedBuckets: Number(row.last_deleted_buckets ?? 0),
    lastExpiredBuckets: Number(row.last_expired_buckets ?? 0),
    lastInvalidBuckets: Number(row.last_invalid_buckets ?? 0),
    lastTruncated: row.last_truncated === true,
    lastFailureCode: row.last_failure_code ? String(row.last_failure_code) : null,
    recordedAt: now.toISOString(),
  };
}

export function getShipmentApvRemediationCursorRetentionJobStatus() {
  return {
    jobEnabled: process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB === "true",
    configured: process.env.ENABLE_CRON === "true",
    retentionDays: boundedInteger(
      process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS,
      7,
      365,
      30,
    ),
    limit: boundedInteger(
      process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT,
      1,
      1000,
      1000,
    ),
    intervalSeconds: 24 * 60 * 60,
  };
}

export async function runShipmentApvRemediationCursorRetention(
  db: Database,
  options: {
    now?: Date;
    finishedAt?: Date;
    retentionDays?: number;
    limit?: number;
    fixtureLeaseId?: string;
  } = {},
) {
  const status = getShipmentApvRemediationCursorRetentionJobStatus();
  const now = options.now ?? new Date();
  const claim = await claimRetentionRun(db, now, options.fixtureLeaseId);
  if (!claim.acquired) return { status: "skipped" as const, reason: "in_progress" as const };
  try {
    const maintenance = await maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics(
      db,
      {
        retentionDays: options.retentionDays ?? status.retentionDays,
        limit: options.limit ?? status.limit,
        dryRun: false,
        now,
      },
    );
    await completeRetentionRun(db, claim.claimId, options.finishedAt ?? new Date(), maintenance);
    return {
      status: maintenance.deletedBuckets ? ("completed" as const) : ("skipped" as const),
      reason: maintenance.deletedBuckets ? undefined : ("healthy" as const),
      maintenance,
    };
  } catch (error) {
    await failRetentionRun(db, claim.claimId, options.finishedAt ?? new Date()).catch(
      () => undefined,
    );
    throw error;
  }
}
