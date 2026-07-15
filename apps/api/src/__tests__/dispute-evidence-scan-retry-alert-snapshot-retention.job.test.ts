import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth,
  getDisputeEvidenceScanRetryAlertSnapshotRetentionJobStatus,
  runDisputeEvidenceScanRetryAlertSnapshotRetentionJob,
} from "../jobs/dispute-evidence-scan-retry-alert-snapshot-retention.js";
import { runDisputeEvidenceScanRetryAlertSnapshotRetention } from "../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js";

vi.mock("../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js", () => ({
  runDisputeEvidenceScanRetryAlertSnapshotRetention: vi.fn(),
}));

const runRetention = vi.mocked(runDisputeEvidenceScanRetryAlertSnapshotRetention);
const originalEnv = {
  ENABLE_CRON: process.env.ENABLE_CRON,
  ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB:
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB,
};

function databaseWithResults(...results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  return { db: { execute } as unknown as Database, execute };
}

afterEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("scan retry alert snapshot retention job health", () => {
  it("reports bounded schedule policy without identifiers", () => {
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    expect(getDisputeEvidenceScanRetryAlertSnapshotRetentionJobStatus()).toEqual({
      jobEnabled: true,
      cronEnabled: true,
      intervalSeconds: 86_400,
      leaseSeconds: 900,
      maxStartDelaySeconds: 93_600,
    });
  });

  it("claims, executes and records one successful run", async () => {
    const { db, execute } = databaseWithResults(
      [{ claim_id: "11111111-1111-4111-8111-111111111111" }],
      [{ status: "SUCCEEDED" }],
    );
    runRetention.mockResolvedValueOnce({
      status: "executed",
      deleted: 3,
      batchSize: 100,
      containsIdentifiers: false,
    });
    await expect(
      runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db, {
        now: new Date("2026-07-14T00:00:00.000Z"),
        finishedAt: new Date("2026-07-14T00:00:02.000Z"),
      }),
    ).resolves.toMatchObject({ status: "executed", deleted: 3 });
    expect(runRetention).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("skips before maintenance while another worker owns the lease", async () => {
    const { db } = databaseWithResults([]);
    await expect(runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db)).resolves.toEqual({
      status: "skipped",
      reason: "retention_run_in_progress",
      deleted: 0,
    });
    expect(runRetention).not.toHaveBeenCalled();
  });

  it("records a fixed failure code and rethrows the internal error", async () => {
    const { db, execute } = databaseWithResults(
      [{ claim_id: "11111111-1111-4111-8111-111111111111" }],
      [],
    );
    runRetention.mockRejectedValueOnce(new Error("database private detail must remain in logs"));
    await expect(runDisputeEvidenceScanRetryAlertSnapshotRetentionJob(db)).rejects.toThrow(
      "database private detail must remain in logs",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("classifies an expired lease as critical without returning its claim", async () => {
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    const { db } = databaseWithResults([
      {
        status: "RUNNING",
        lease_expires_at: "2026-07-14T00:14:59.000Z",
        first_observed_at: "2026-07-14T00:00:00.000Z",
        last_started_at: "2026-07-14T00:00:00.000Z",
        last_succeeded_at: null,
        last_failed_at: null,
        last_deleted_snapshots: 2,
        last_failure_code: null,
        claim_id: "secret-claim",
      },
    ]);
    const health = await getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(
      db,
      new Date("2026-07-14T00:15:00.000Z"),
    );
    expect(health).toMatchObject({
      status: "critical",
      lastRunStatus: "STALE_RUNNING",
      leaseStale: true,
      lastDeletedSnapshots: 2,
      containsIdentifiers: false,
    });
    expect(JSON.stringify(health)).not.toMatch(/secret-claim|claimId|leaseExpires/i);
  });

  it("marks an enabled job attention after the 26 hour start deadline", async () => {
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    const { db } = databaseWithResults([
      {
        status: "SUCCEEDED",
        lease_expires_at: null,
        first_observed_at: "2026-07-12T00:00:00.000Z",
        last_started_at: "2026-07-12T00:00:00.000Z",
        last_succeeded_at: "2026-07-12T00:00:00.000Z",
        last_failed_at: null,
        last_deleted_snapshots: 0,
        last_failure_code: null,
      },
    ]);
    await expect(
      getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(
        db,
        new Date("2026-07-13T02:00:00.000Z"),
      ),
    ).resolves.toMatchObject({ status: "attention", overdue: true, lastRunStatus: "SUCCEEDED" });
  });

  it("keeps old persisted state inactive while the job is disabled", async () => {
    delete process.env.ENABLE_CRON;
    delete process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB;
    const { db } = databaseWithResults([
      {
        status: "FAILED",
        lease_expires_at: null,
        first_observed_at: "2026-07-12T00:00:00.000Z",
        last_started_at: "2026-07-12T00:00:00.000Z",
        last_succeeded_at: null,
        last_failed_at: "2026-07-12T00:01:00.000Z",
        last_deleted_snapshots: 0,
        last_failure_code: "RETENTION_EXECUTION_FAILED",
      },
    ]);
    await expect(
      getDisputeEvidenceScanRetryAlertSnapshotRetentionJobHealth(
        db,
        new Date("2026-07-14T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      status: "inactive",
      overdue: true,
      lastRunStatus: "FAILED",
      lastFailureCode: "RETENTION_EXECUTION_FAILED",
    });
  });
});
