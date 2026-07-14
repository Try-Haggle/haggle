import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import {
  acquireDisputeEvidenceScannerPermit,
  getDisputeEvidenceScannerCircuitHealth,
  resolveDisputeEvidenceScannerCircuitConfigFromEnv,
} from "../services/dispute-evidence-scanner-circuit.service.js";

afterEach(() => {
  for (const key of [
    "DISPUTE_EVIDENCE_SCANNER_CIRCUIT_FAILURE_THRESHOLD",
    "DISPUTE_EVIDENCE_SCANNER_CIRCUIT_OPEN_SECONDS",
    "DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS",
    "DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT",
  ]) delete process.env[key];
});

describe("dispute evidence scanner circuit", () => {
  it("validates bounded circuit and bulkhead policy", () => {
    expect(resolveDisputeEvidenceScannerCircuitConfigFromEnv()).toEqual({
      failureThreshold: 3,
      openSeconds: 60,
      permitLeaseSeconds: 30,
      maxConcurrent: 4,
    });
    process.env.DISPUTE_EVIDENCE_SCANNER_CIRCUIT_FAILURE_THRESHOLD = "0";
    expect(() => resolveDisputeEvidenceScannerCircuitConfigFromEnv())
      .toThrow(/threshold/);
    process.env.DISPUTE_EVIDENCE_SCANNER_CIRCUIT_FAILURE_THRESHOLD = "3";
    process.env.DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT = "101";
    expect(() => resolveDisputeEvidenceScannerCircuitConfigFromEnv())
      .toThrow(/concurrency/);
  });

  it("blocks an open circuit without allocating a permit", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        state: "OPEN", consecutiveFailures: 3,
        nextProbeAt: "2026-07-14T00:01:00.000Z", probeExpiresAt: null,
      }])
      .mockResolvedValueOnce([]);
    const db = {
      transaction: vi.fn(async (callback) => callback({ execute })),
    } as unknown as Database;
    await expect(acquireDisputeEvidenceScannerPermit(db, {
      now: new Date("2026-07-14T00:00:00.000Z"),
    })).resolves.toEqual({
      acquired: false,
      reason: "CIRCUIT_OPEN",
      retryAt: new Date("2026-07-14T00:01:00.000Z"),
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("returns an identifier-free aggregate circuit health contract", async () => {
    const db = { execute: vi.fn().mockResolvedValue([{
      state: "HALF_OPEN", consecutiveFailures: 3, activePermits: 1,
      nextProbeAt: null, probeExpiresAt: "2026-07-14T00:00:30.000Z",
      lastSuccessAt: null, lastFailureAt: "2026-07-13T23:59:00.000Z",
    }]) } as unknown as Database;
    const health = await getDisputeEvidenceScannerCircuitHealth(db, {
      now: new Date("2026-07-14T00:00:00.000Z"),
    });
    expect(health).toMatchObject({
      schemaVersion: "dispute-evidence-scanner-circuit-health-v1",
      status: "attention", state: "HALF_OPEN",
      consecutiveFailures: 3, activePermits: 1,
      policy: { failureThreshold: 3, maxConcurrent: 4 },
      containsPermitTokens: false, containsCircuitKey: false,
    });
    expect(JSON.stringify(health)).not.toContain("malware-scanner");
  });
});
