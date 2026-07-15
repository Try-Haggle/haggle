import type { Database } from "@haggle/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimDisputeEvidenceScanRetries,
  type DisputeEvidenceScanRetryClaim,
  type DisputeEvidenceScanRetryConfig,
  disputeEvidenceScanRetryDelaySeconds,
  finalizeDisputeEvidenceScanRetry,
  getDisputeEvidenceScanRetryHealth,
  resolveDisputeEvidenceScanRetryConfigFromEnv,
  runDisputeEvidenceScanRetry,
} from "../services/dispute-evidence-scan-retry.service.js";

const config: DisputeEvidenceScanRetryConfig = {
  batchSize: 10,
  maxAttempts: 5,
  leaseSeconds: 60,
  baseBackoffSeconds: 30,
  maxBackoffSeconds: 3_600,
};

const claim: DisputeEvidenceScanRetryClaim = {
  uploadId: "11111111-1111-4111-8111-111111111111",
  disputeId: "22222222-2222-4222-8222-222222222222",
  storagePath: "dispute-evidence/22222222-2222-4222-8222-222222222222/evidence.png",
  contentType: "image/png",
  fileSizeBytes: 11,
  attemptCount: 1,
  leaseToken: "33333333-3333-4333-8333-333333333333",
  leaseExpiresAt: new Date("2026-07-14T00:01:00.000Z"),
};

afterEach(() => {
  for (const key of [
    "DISPUTE_EVIDENCE_SCAN_RETRY_BATCH_SIZE",
    "DISPUTE_EVIDENCE_SCAN_RETRY_MAX_ATTEMPTS",
    "DISPUTE_EVIDENCE_SCAN_RETRY_LEASE_SECONDS",
    "DISPUTE_EVIDENCE_SCAN_RETRY_BASE_BACKOFF_SECONDS",
    "DISPUTE_EVIDENCE_SCAN_RETRY_MAX_BACKOFF_SECONDS",
    "ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB",
    "ENABLE_CRON",
  ])
    delete process.env[key];
});

describe("dispute evidence scan retry", () => {
  it("validates retry policy and caps exponential backoff", () => {
    expect(resolveDisputeEvidenceScanRetryConfigFromEnv()).toEqual(config);
    expect(disputeEvidenceScanRetryDelaySeconds(1, config)).toBe(30);
    expect(disputeEvidenceScanRetryDelaySeconds(5, config)).toBe(480);
    expect(disputeEvidenceScanRetryDelaySeconds(20, config)).toBe(3_600);
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BATCH_SIZE = "0";
    expect(() => resolveDisputeEvidenceScanRetryConfigFromEnv()).toThrow(/batch size/);
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BATCH_SIZE = "10";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_BASE_BACKOFF_SECONDS = "120";
    process.env.DISPUTE_EVIDENCE_SCAN_RETRY_MAX_BACKOFF_SECONDS = "60";
    expect(() => resolveDisputeEvidenceScanRetryConfigFromEnv()).toThrow(/max backoff/);
  });

  it("maps an atomic database claim without exposing SQL state", async () => {
    const execute = vi.fn().mockResolvedValue([
      {
        uploadId: claim.uploadId,
        disputeId: claim.disputeId,
        storagePath: claim.storagePath,
        contentType: claim.contentType,
        fileSizeBytes: claim.fileSizeBytes,
        attemptCount: 2,
        leaseToken: claim.leaseToken,
        leaseExpiresAt: claim.leaseExpiresAt.toISOString(),
      },
    ]);
    const db = {
      transaction: vi.fn(async (callback) => callback({ execute })),
    } as unknown as Database;
    const claims = await claimDisputeEvidenceScanRetries(db, {
      now: new Date("2026-07-14T00:00:00.000Z"),
      config,
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      uploadId: claim.uploadId,
      attemptCount: 2,
    });
    expect(claims[0]?.leaseExpiresAt).toBeInstanceOf(Date);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("fences stale finalizers and accepts only the current lease owner", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: claim.uploadId }]);
    const db = { execute } as unknown as Database;
    const result = {
      status: "CLEAN" as const,
      provider: "scanner.test",
      detail: "CLEAN",
      sha256: "a".repeat(64),
    };
    expect(await finalizeDisputeEvidenceScanRetry(db, claim, result, { config })).toBe(false);
    expect(await finalizeDisputeEvidenceScanRetry(db, claim, result, { config })).toBe(true);
  });

  it("does not consume the retry budget while the shared circuit is open", async () => {
    const execute = vi.fn().mockResolvedValue([{ id: claim.uploadId }]);
    const db = { execute } as unknown as Database;
    expect(
      await finalizeDisputeEvidenceScanRetry(
        db,
        claim,
        {
          status: "PENDING",
          provider: "haggle-scanner-circuit",
          detail: "SCANNER_CIRCUIT_OPEN",
        },
        { config },
      ),
    ).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("returns identifier-free aggregate retry health", async () => {
    process.env.ENABLE_DISPUTE_EVIDENCE_SCAN_RETRY_JOB = "true";
    process.env.ENABLE_CRON = "true";
    const db = {
      execute: vi.fn().mockResolvedValue([
        {
          quarantined: 4,
          pending: 1,
          failed: 1,
          processing: 1,
          staleProcessing: 1,
          retryReady: 2,
          exhausted: 1,
          expiredQuarantined: 0,
          oldestUnresolvedAgeSeconds: 300,
        },
      ]),
    } as unknown as Database;
    const health = await getDisputeEvidenceScanRetryHealth(db, {
      now: new Date("2026-07-14T00:00:00.000Z"),
      config,
    });
    expect(health).toMatchObject({
      status: "attention",
      job: { enabled: true, cronEnabled: true },
      totals: { quarantined: 4, staleProcessing: 1, exhausted: 1 },
      oldestUnresolvedAgeSeconds: 300,
      containsIdentifiers: false,
      containsStoragePaths: false,
      containsLeaseTokens: false,
    });
    expect(JSON.stringify(health)).not.toContain(claim.uploadId);
  });

  it("skips without scanner configuration before claiming database work", async () => {
    const transaction = vi.fn();
    const result = await runDisputeEvidenceScanRetry({ transaction } as unknown as Database, {
      retryConfig: config,
      scannerConfig: null,
    });
    expect(result).toMatchObject({
      status: "skipped",
      reason: "SCANNER_NOT_CONFIGURED",
      claimed: 0,
      realNetworkCalled: false,
      storageRead: false,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("runs an injected retry without real network or storage", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        {
          uploadId: claim.uploadId,
          disputeId: claim.disputeId,
          storagePath: claim.storagePath,
          contentType: claim.contentType,
          fileSizeBytes: claim.fileSizeBytes,
          attemptCount: 1,
          leaseToken: claim.leaseToken,
          leaseExpiresAt: claim.leaseExpiresAt,
        },
      ])
      .mockResolvedValueOnce([{ id: claim.uploadId }]);
    const db = {
      execute,
      transaction: vi.fn(async (callback) => callback({ execute })),
    } as unknown as Database;
    const scannerConfig = {
      url: "https://scanner.test/scan",
      token: "scanner-secret-123",
      timeoutMs: 1_000,
      maxResponseBytes: 16_384,
      allowInsecureHttp: false,
      allowPrivateNetwork: false,
    };
    const result = await runDisputeEvidenceScanRetry(db, {
      retryConfig: config,
      scannerConfig,
      download: vi.fn().mockResolvedValue(Buffer.alloc(11)),
      scan: vi.fn().mockResolvedValue({
        status: "CLEAN",
        provider: "scanner.test",
        detail: "CLEAN",
        sha256: "a".repeat(64),
      }),
    });
    expect(result).toMatchObject({
      status: "completed",
      claimed: 1,
      clean: 1,
      realNetworkCalled: false,
      storageRead: false,
    });
  });
});
