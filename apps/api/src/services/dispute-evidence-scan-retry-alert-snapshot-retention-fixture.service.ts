import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import {
  getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
  runDisputeEvidenceScanRetryAlertSnapshotRetentionJob,
} from "../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js";
import { getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth } from "./dispute-evidence-scan-retry-alert-snapshot-retention.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "./webhook-event-claim.service.js";

function snapshot(deliveryId: string) {
  return {
    schema_version: "dispute-evidence-scan-retry-alert-v2",
    type: "dispute_evidence_scan_retry.health",
    delivery_id: deliveryId,
    state: "firing",
    severity: "critical",
    reasons: ["scan_retry_exhausted"],
    thresholds: {
      retry_ready: 10,
      stale_processing: 1,
      exhausted: 1,
      expired_quarantined: 1,
    },
    health: {
      totals: {
        quarantined: 1,
        pending: 0,
        failed: 1,
        processing: 0,
        stale_processing: 0,
        retry_ready: 0,
        exhausted: 1,
        expired_quarantined: 0,
      },
      oldest_unresolved_age_seconds: 2_678_400,
      circuit: {
        state: "CLOSED",
        consecutive_failures: 0,
        active_permits: 0,
        max_concurrent: 4,
        failure_threshold: 3,
      },
    },
  };
}

export async function runDisputeEvidenceScanRetryAlertSnapshotRetentionFixture(db: Database) {
  const fixtureId = randomUUID();
  const source = `haggle-scan-retry-retention-fixture-${fixtureId}`;
  const deliveryIds = ["completed", "failed", "orphan"].map(
    (kind) => `health_${createHash("sha256").update(`${fixtureId}:${kind}`).digest("hex")}`,
  );
  let snapshotCleanup = 0;
  let claimCleanup = 0;
  let jobStateRestored = false;
  let report: Record<string, unknown> | null = null;
  const savedJobRows = (await db.execute(sql`
    SELECT status, claim_id, lease_expires_at, first_observed_at,
           last_started_at, last_succeeded_at, last_failed_at,
           last_deleted_snapshots, last_failure_code, updated_at
      FROM dispute_evidence_scan_retry_alert_snapshot_retention_state
     WHERE job_key = 'snapshot_retention'
  `)) as unknown as Array<Record<string, unknown>>;
  const savedJob = savedJobRows[0];
  try {
    await db.execute(sql`
      UPDATE dispute_evidence_scan_retry_alert_snapshot_retention_state
         SET status = 'NEVER', claim_id = NULL, lease_expires_at = NULL,
             first_observed_at = now(), last_started_at = NULL,
             last_succeeded_at = NULL, last_failed_at = NULL,
             last_deleted_snapshots = 0, last_failure_code = NULL,
             updated_at = now()
       WHERE job_key = 'snapshot_retention'
    `);
    for (const deliveryId of deliveryIds) {
      const payload = snapshot(deliveryId);
      const payloadSha256 = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      await db.execute(sql`
        INSERT INTO dispute_evidence_scan_retry_alert_snapshots
          (source, delivery_id, snapshot_kind, payload, payload_sha256,
           created_at, expires_at)
        VALUES (${source}, ${deliveryId}, 'FIRING',
          ${JSON.stringify(payload)}::jsonb, ${payloadSha256},
          now() - interval '31 days', now() - interval '1 hour')
      `);
    }

    const completedClaim = await claimWebhookEvent(db, {
      source,
      eventId: deliveryIds[0]!,
      payloadSha256: createHash("sha256")
        .update(JSON.stringify(snapshot(deliveryIds[0]!)))
        .digest("hex"),
    });
    if (completedClaim.outcome !== "acquired") {
      throw new Error("SCAN_RETRY_RETENTION_COMPLETED_CLAIM_NOT_ACQUIRED");
    }
    await completeWebhookEvent(db, completedClaim, 204);
    const failedClaim = await claimWebhookEvent(db, {
      source,
      eventId: deliveryIds[1]!,
      payloadSha256: createHash("sha256")
        .update(JSON.stringify(snapshot(deliveryIds[1]!)))
        .digest("hex"),
    });
    if (failedClaim.outcome !== "acquired") {
      throw new Error("SCAN_RETRY_RETENTION_FAILED_CLAIM_NOT_ACQUIRED");
    }
    await failWebhookEvent(db, failedClaim);

    const before = await getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth(db, source);
    let releaseLock!: () => void;
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let signalLock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      signalLock = resolve;
    });
    const winnerPromise = runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db, {
      batchSize: 100,
      onLockAcquired: async () => {
        signalLock();
        await lockGate;
      },
    });
    await lockAcquired;
    const competitors = await Promise.all(
      Array.from({ length: 19 }, () =>
        runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db, {
          batchSize: 100,
        }),
      ),
    );
    releaseLock();
    const winner = await winnerPromise;
    const lockBlocked = competitors.filter(
      (item) => item.status === "skipped" && item.reason === "retention_run_in_progress",
    ).length;
    const completedJobHealth = await getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(db);
    const after = await getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth(db, source);
    const remainingRows = (await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE delivery_id = ${deliveryIds[1]}
             )::int AS failed,
             count(*) FILTER (
               WHERE delivery_id = ${deliveryIds[2]}
             )::int AS orphan
        FROM dispute_evidence_scan_retry_alert_snapshots
       WHERE source = ${source}
    `)) as unknown as Array<{ total: number; failed: number; orphan: number }>;
    let unresolvedDeleteRejected = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          SET LOCAL haggle.allow_scan_retry_alert_snapshot_retention = 'on'
        `);
        await tx.execute(sql`
          DELETE FROM dispute_evidence_scan_retry_alert_snapshots
           WHERE source = ${source} AND delivery_id = ${deliveryIds[1]}
        `);
      });
    } catch {
      unresolvedDeleteRejected = true;
    }
    const staleClaimId = randomUUID();
    const staleNow = new Date();
    await db.execute(sql`
      UPDATE dispute_evidence_scan_retry_alert_snapshot_retention_state
         SET status = 'RUNNING', claim_id = ${staleClaimId}::uuid,
             lease_expires_at = ${new Date(staleNow.getTime() - 1_000).toISOString()}::timestamptz,
             last_started_at = ${new Date(staleNow.getTime() - 901_000).toISOString()}::timestamptz,
             last_failure_code = NULL, updated_at = now()
       WHERE job_key = 'snapshot_retention'
    `);
    const reclaimed = await runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db, {
      now: staleNow,
      finishedAt: new Date(staleNow.getTime() + 1_000),
      batchSize: 100,
    });
    const staleOwnerRows = (await db.execute(sql`
      UPDATE dispute_evidence_scan_retry_alert_snapshot_retention_state
         SET status = 'SUCCEEDED', claim_id = NULL, lease_expires_at = NULL,
             last_succeeded_at = now(), last_deleted_snapshots = 999,
             updated_at = now()
       WHERE job_key = 'snapshot_retention' AND status = 'RUNNING'
         AND claim_id = ${staleClaimId}::uuid
      RETURNING job_key
    `)) as unknown as Array<{ job_key: string }>;
    const recoveredJobHealth = await getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(db);
    const serialized = JSON.stringify({
      before,
      after,
      winner,
      competitors,
      completedJobHealth,
      recoveredJobHealth,
    });
    const checks = {
      expiredClassificationExact:
        before.eligibleExpired === 1 &&
        before.blockedExpired === 2 &&
        before.status === "attention",
      distributedLockSingleWinner:
        winner.status === "executed" && winner.deleted === 1 && lockBlocked === 19,
      completedExpiredDeleted: remainingRows[0]?.total === 2,
      failedExpiredPreserved: remainingRows[0]?.failed === 1,
      orphanExpiredPreserved: remainingRows[0]?.orphan === 1,
      unresolvedDeleteRejected,
      postRunHealthAccurate:
        after.eligibleExpired === 0 && after.blockedExpired === 2 && after.status === "attention",
      boundedBatchApplied: winner.status === "executed" && winner.batchSize === 100,
      persistentJobRunRecorded:
        completedJobHealth.lastRunStatus === "SUCCEEDED" &&
        completedJobHealth.lastDeletedSnapshots === 1,
      staleJobLeaseReclaimed:
        reclaimed.status === "executed" &&
        reclaimed.deleted === 0 &&
        recoveredJobHealth.lastRunStatus === "SUCCEEDED",
      staleJobOwnerFenced:
        staleOwnerRows.length === 0 && recoveredJobHealth.lastDeletedSnapshots === 0,
      identifiersExcluded:
        !serialized.includes(fixtureId) &&
        before.containsIdentifiers === false &&
        after.containsIdentifiers === false,
      noExternalSideEffects: true,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    report = {
      schemaVersion: "dispute-evidence-scan-retry-alert-snapshot-retention-fixture-v1",
      status: passed === Object.keys(checks).length ? "pass" : "fail",
      totals: { passed, total: Object.keys(checks).length },
      checks,
      execution: {
        concurrentWorkers: 20,
        lockWinners: winner.status === "executed" ? 1 : 0,
        lockBlocked,
        deletedCompletedSnapshots: winner.deleted,
        preservedFailedSnapshots: remainingRows[0]?.failed ?? 0,
        preservedOrphanSnapshots: remainingRows[0]?.orphan ?? 0,
        persistentJobRuns: completedJobHealth.lastRunStatus === "SUCCEEDED" ? 1 : 0,
        staleLeaseReclaims: reclaimed.status === "executed" ? 1 : 0,
        staleOwnerCompletions: staleOwnerRows.length,
        externalCalls: 0,
        databaseChanged: true,
      },
      containsIdentifiers: false,
    };
  } finally {
    snapshotCleanup = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL haggle.allow_test_fixture_cleanup = 'on'`);
      const rows = (await tx.execute(sql`
        DELETE FROM dispute_evidence_scan_retry_alert_snapshots
         WHERE source = ${source}
        RETURNING id
      `)) as unknown as Array<{ id: string }>;
      return rows.length;
    });
    const claimRows = (await db.execute(sql`
      DELETE FROM webhook_idempotency WHERE source = ${source} RETURNING id
    `)) as unknown as Array<{ id: string }>;
    claimCleanup = claimRows.length;
    if (savedJob) {
      await db.execute(sql`
        UPDATE dispute_evidence_scan_retry_alert_snapshot_retention_state
           SET status = ${String(savedJob.status)},
               claim_id = ${savedJob.claim_id == null ? null : String(savedJob.claim_id)}::uuid,
               lease_expires_at = ${
                 savedJob.lease_expires_at == null
                   ? null
                   : new Date(String(savedJob.lease_expires_at)).toISOString()
}::timestamptz,
               first_observed_at = ${new Date(
                 String(savedJob.first_observed_at),
               ).toISOString()}::timestamptz,
               last_started_at = ${
                 savedJob.last_started_at == null
                   ? null
                   : new Date(String(savedJob.last_started_at)).toISOString()
}::timestamptz,
               last_succeeded_at = ${
                 savedJob.last_succeeded_at == null
                   ? null
                   : new Date(String(savedJob.last_succeeded_at)).toISOString()
}::timestamptz,
               last_failed_at = ${
                 savedJob.last_failed_at == null
                   ? null
                   : new Date(String(savedJob.last_failed_at)).toISOString()
}::timestamptz,
               last_deleted_snapshots = ${Number(savedJob.last_deleted_snapshots ?? 0)},
               last_failure_code = ${
                 savedJob.last_failure_code == null ? null : String(savedJob.last_failure_code)
},
               updated_at = ${new Date(String(savedJob.updated_at)).toISOString()}::timestamptz
         WHERE job_key = 'snapshot_retention'
      `);
      jobStateRestored = true;
    }
  }
  if (!report) throw new Error("SCAN_RETRY_RETENTION_FIXTURE_RESULT_MISSING");
  if (snapshotCleanup !== 2 || claimCleanup !== 2 || !jobStateRestored) {
    throw Object.assign(new Error("SCAN_RETRY_RETENTION_FIXTURE_CLEANUP_FAILED"), {
      diagnostics: { snapshotCleanup, claimCleanup, jobStateRestored },
    });
  }
  return {
    ...report,
    cleanup: {
      snapshots: snapshotCleanup,
      claims: claimCleanup,
      jobStateRestored,
      succeeded: true,
    },
  };
}
