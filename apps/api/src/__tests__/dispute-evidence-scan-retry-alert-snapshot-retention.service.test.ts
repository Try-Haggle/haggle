import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth,
  getDisputeEvidenceScanRetryAlertSnapshotRetentionPolicy,
  runDisputeEvidenceScanRetryAlertSnapshotRetention,
} from "../services/dispute-evidence-scan-retry-alert-snapshot-retention.service.js";

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});
describe("scan retry alert snapshot retention", () => {
  it("uses bounded policy and follows the alert job enablement", () => {
    process.env.ENABLE_CRON = "true";
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_JOB = "true";
    expect(getDisputeEvidenceScanRetryAlertSnapshotRetentionPolicy()).toEqual({
      retentionDays: 30,
      batchSize: 100,
      jobEnabled: true,
      cronEnabled: true,
    });
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_ALERT_SNAPSHOT_RETENTION_BATCH_SIZE = "1001";
    expect(() => getDisputeEvidenceScanRetryAlertSnapshotRetentionPolicy()).toThrow("1..1000");
  });

  it("returns aggregate-only eligible and blocked expiry health", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        eligibleExpired: 2,
        blockedExpired: 3,
        oldestBlockedExpiredAgeSeconds: 120,
      },
    ]);
    await expect(
      getDisputeEvidenceScanRetryAlertSnapshotRetentionHealth({ execute } as unknown as Database),
    ).resolves.toMatchObject({
      status: "attention",
      eligibleExpired: 2,
      blockedExpired: 3,
      oldestBlockedExpiredAgeSeconds: 120,
      containsIdentifiers: false,
    });
  });

  it("skips when another instance owns the transaction lock", async () => {
    const tx = { execute: vi.fn().mockResolvedValue([{ acquired: false }]) };
    const db = {
      transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as Database;
    await expect(runDisputeEvidenceScanRetryAlertSnapshotRetention(db)).resolves.toEqual({
      status: "skipped",
      reason: "retention_lock_held",
      deleted: 0,
    });
    expect(tx.execute).toHaveBeenCalledOnce();
  });

  it("deletes only the bounded rows returned by the guarded transaction", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: crypto.randomUUID() }]);
    const db = {
      transaction: vi.fn(async (callback) => callback({ execute })),
    } as unknown as Database;
    await expect(
      runDisputeEvidenceScanRetryAlertSnapshotRetention(db, { batchSize: 10 }),
    ).resolves.toEqual({
      status: "executed",
      deleted: 1,
      batchSize: 10,
      containsIdentifiers: false,
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
