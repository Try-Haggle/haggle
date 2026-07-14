import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";

vi.mock("../services/dispute-evidence-scanner-circuit.service.js", async (
  importOriginal,
) => {
  const actual = await importOriginal<typeof import(
    "../services/dispute-evidence-scanner-circuit.service.js"
  )>();
  return {
    ...actual,
    acquireDisputeEvidenceScannerPermit: vi.fn(),
    finalizeDisputeEvidenceScannerPermit: vi.fn(),
  };
});

import { scanDisputeEvidence } from
  "../services/dispute-evidence-scan.service.js";
import {
  acquireDisputeEvidenceScannerPermit,
  finalizeDisputeEvidenceScannerPermit,
} from "../services/dispute-evidence-scanner-circuit.service.js";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const config = {
  url: "https://scanner.example.test/scan",
  token: "scanner-secret-123",
  timeoutMs: 1_000,
  maxResponseBytes: 16_384,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};
const db = {} as Database;
const permit = {
  acquired: true as const,
  permitId: "11111111-1111-4111-8111-111111111111",
  circuitKey: "malware-scanner",
  kind: "REGULAR" as const,
  expiresAt: new Date("2026-07-14T00:00:30.000Z"),
};

beforeEach(() => {
  vi.mocked(acquireDisputeEvidenceScannerPermit).mockReset();
  vi.mocked(finalizeDisputeEvidenceScannerPermit).mockReset();
});

describe("scanner circuit integration", () => {
  it("acquires and finalizes a permit around a valid scanner response", async () => {
    vi.mocked(acquireDisputeEvidenceScannerPermit)
      .mockResolvedValue(permit);
    vi.mocked(finalizeDisputeEvidenceScannerPermit).mockResolvedValue(true);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: "clean" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(scanDisputeEvidence({
      bytes: PNG, contentType: "image/png",
      expectedSizeBytes: PNG.length, filename: "evidence.png",
    }, { config, db, fetchImpl })).resolves.toMatchObject({
      status: "CLEAN", provider: "scanner.example.test",
    });
    expect(acquireDisputeEvidenceScannerPermit).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(finalizeDisputeEvidenceScannerPermit).toHaveBeenCalledWith(
      db, permit, expect.objectContaining({ scannerOperational: true }),
    );
  });

  it("keeps evidence pending without network when the circuit is open", async () => {
    vi.mocked(acquireDisputeEvidenceScannerPermit).mockResolvedValue({
      acquired: false, reason: "CIRCUIT_OPEN",
      retryAt: new Date("2026-07-14T00:01:00.000Z"),
    });
    const fetchImpl = vi.fn();
    await expect(scanDisputeEvidence({
      bytes: PNG, contentType: "image/png",
      expectedSizeBytes: PNG.length, filename: "evidence.png",
    }, { config, db, fetchImpl })).resolves.toMatchObject({
      status: "PENDING", provider: "haggle-scanner-circuit",
      detail: "SCANNER_CIRCUIT_OPEN",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(finalizeDisputeEvidenceScannerPermit).not.toHaveBeenCalled();
  });

  it("fails closed when permit finalization cannot be persisted", async () => {
    vi.mocked(acquireDisputeEvidenceScannerPermit)
      .mockResolvedValue(permit);
    vi.mocked(finalizeDisputeEvidenceScannerPermit).mockResolvedValue(false);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: "clean" }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    await expect(scanDisputeEvidence({
      bytes: PNG, contentType: "image/png",
      expectedSizeBytes: PNG.length, filename: "evidence.png",
    }, { config, db, fetchImpl })).rejects.toThrow(
      "SCANNER_CIRCUIT_FINALIZE_FAILED",
    );
  });
});
