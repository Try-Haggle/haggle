import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initCronJobs, stopCronJobs } from "../jobs/runner.js";
import {
  getShipmentApvRemediationCursorRetentionJobHealth,
  getShipmentApvRemediationCursorRetentionJobStatus,
  runShipmentApvRemediationCursorRetention,
} from "../jobs/shipment-apv-remediation-cursor-retention.js";
import { maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics } from "../services/shipment-apv-invoice-restoration-remediation.service.js";

vi.mock("../services/shipment-apv-invoice-restoration-remediation.service.js", () => ({
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics: vi.fn(),
}));

vi.mock("../jobs/websocket-auth-ticket-retention.js", () => ({
  runWebSocketAuthTicketRetention: vi.fn().mockResolvedValue({
    acquired: true,
    deleted: 0,
    batchSize: 1_000,
  }),
}));

const mockMaintain = vi.mocked(
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics,
);
const claimRow = [{ claim_id: "11111111-1111-4111-8111-111111111111" }];

function databaseWithResults(...results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  return { db: { execute } as unknown as Database, execute };
}
const originalEnv = {
  ENABLE_CRON: process.env.ENABLE_CRON,
  ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB:
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB,
  SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS:
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS,
  SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT:
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT,
};

afterEach(() => {
  stopCronJobs();
  vi.resetAllMocks();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("shipment APV remediation cursor retention job", () => {
  it("reports only bounded non-secret job configuration", () => {
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_DAYS = "45";
    process.env.SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_LIMIT = "250";
    expect(getShipmentApvRemediationCursorRetentionJobStatus()).toEqual({
      jobEnabled: true,
      configured: true,
      retentionDays: 45,
      limit: 250,
      intervalSeconds: 86_400,
    });
  });

  it("runs one apply batch and reports completion", async () => {
    const { db, execute } = databaseWithResults(claimRow, [{ status: "SUCCEEDED" }]);
    mockMaintain.mockResolvedValueOnce({
      dryRun: false,
      retentionDays: 30,
      limit: 1000,
      eligibleBuckets: undefined,
      deletedBuckets: 2,
      expiredBuckets: 1,
      invalidBuckets: 1,
      truncated: false,
      cutoffAt: "2026-06-13T00:00:00.000Z",
      recordedAt: "2026-07-13T00:00:00.000Z",
    });
    const now = new Date("2026-07-13T00:00:00.000Z");
    const finishedAt = new Date("2026-07-13T00:00:02.000Z");
    await expect(
      runShipmentApvRemediationCursorRetention(db, {
        now,
        finishedAt,
        retentionDays: 30,
        limit: 1000,
      }),
    ).resolves.toMatchObject({ status: "completed", maintenance: { deletedBuckets: 2 } });
    expect(mockMaintain).toHaveBeenCalledWith(expect.anything(), {
      retentionDays: 30,
      limit: 1000,
      dryRun: false,
      now,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns a healthy no-op when no old buckets exist", async () => {
    const { db } = databaseWithResults(claimRow, [{ status: "SUCCEEDED" }]);
    mockMaintain.mockResolvedValueOnce({
      dryRun: false,
      retentionDays: 30,
      limit: 1000,
      eligibleBuckets: undefined,
      deletedBuckets: 0,
      expiredBuckets: 0,
      invalidBuckets: 0,
      truncated: false,
      cutoffAt: "2026-06-13T00:00:00.000Z",
      recordedAt: "2026-07-13T00:00:00.000Z",
    });
    await expect(runShipmentApvRemediationCursorRetention(db)).resolves.toMatchObject({
      status: "skipped",
      reason: "healthy",
    });
  });

  it("skips before maintenance when another instance owns the live lease", async () => {
    const { db } = databaseWithResults([]);
    await expect(runShipmentApvRemediationCursorRetention(db)).resolves.toEqual({
      status: "skipped",
      reason: "in_progress",
    });
    expect(mockMaintain).not.toHaveBeenCalled();
  });

  it("records a fixed failure state and rethrows the maintenance error", async () => {
    const { db, execute } = databaseWithResults(claimRow, []);
    mockMaintain.mockRejectedValueOnce(new Error("database unavailable with private detail"));
    await expect(runShipmentApvRemediationCursorRetention(db)).rejects.toThrow(
      "database unavailable with private detail",
    );
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("returns aggregate stale-run health without exposing claim identifiers", async () => {
    const { db } = databaseWithResults([
      {
        status: "RUNNING",
        lease_expires_at: "2026-07-13T00:14:59.000Z",
        last_started_at: "2026-07-13T00:00:00.000Z",
        last_succeeded_at: null,
        last_failed_at: null,
        last_deleted_buckets: 2,
        last_expired_buckets: 1,
        last_invalid_buckets: 1,
        last_truncated: false,
        last_failure_code: null,
      },
    ]);
    const health = await getShipmentApvRemediationCursorRetentionJobHealth(
      db,
      new Date("2026-07-13T00:15:00.000Z"),
    );
    expect(health).toMatchObject({
      lastRunStatus: "STALE_RUNNING",
      leaseStale: true,
      lastDeletedBuckets: 2,
      lastExpiredBuckets: 1,
      lastInvalidBuckets: 1,
    });
    expect(JSON.stringify(health)).not.toMatch(/claim|leaseExpires/i);
  });

  it("returns the persisted first observation for a job that has never started", async () => {
    const { db } = databaseWithResults([
      {
        status: "NEVER",
        lease_expires_at: null,
        first_observed_at: "2026-07-12T00:00:00.000Z",
        last_started_at: null,
        last_succeeded_at: null,
        last_failed_at: null,
        last_deleted_buckets: 0,
        last_expired_buckets: 0,
        last_invalid_buckets: 0,
        last_truncated: false,
        last_failure_code: null,
      },
    ]);
    await expect(
      getShipmentApvRemediationCursorRetentionJobHealth(db, new Date("2026-07-13T00:00:00.000Z")),
    ).resolves.toMatchObject({
      lastRunStatus: "NEVER",
      firstObservedAt: "2026-07-12T00:00:00.000Z",
      lastStartedAt: null,
    });
  });

  it("runs once at startup before the first daily interval", async () => {
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_SHIPMENT_APV_REMEDIATION_CURSOR_RETENTION_JOB = "true";
    mockMaintain.mockResolvedValueOnce({
      dryRun: false,
      retentionDays: 30,
      limit: 1000,
      eligibleBuckets: undefined,
      deletedBuckets: 0,
      expiredBuckets: 0,
      invalidBuckets: 0,
      truncated: false,
      cutoffAt: "2026-06-13T00:00:00.000Z",
      recordedAt: "2026-07-13T00:00:00.000Z",
    });
    const { db } = databaseWithResults(claimRow, [{ status: "SUCCEEDED" }]);
    initCronJobs(db);
    await vi.waitFor(() => expect(mockMaintain).toHaveBeenCalledTimes(1));
  });
});
