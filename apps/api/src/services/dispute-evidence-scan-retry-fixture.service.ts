import { createHash, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import type { DisputeEvidenceScannerConfig } from
  "./dispute-evidence-scan.service.js";
import { scanDisputeEvidence } from "./dispute-evidence-scan.service.js";
import {
  finalizeDisputeEvidenceScanRetry,
  getDisputeEvidenceScanRetryHealth,
  runDisputeEvidenceScanRetry,
  type DisputeEvidenceScanRetryClaim,
  type DisputeEvidenceScanRetryConfig,
} from "./dispute-evidence-scan-retry.service.js";
import { runDisputeEvidenceScannerCircuitFixture } from
  "./dispute-evidence-scanner-circuit-fixture.service.js";

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

const RETRY_CONFIG: DisputeEvidenceScanRetryConfig = {
  batchSize: 10,
  maxAttempts: 5,
  leaseSeconds: 60,
  baseBackoffSeconds: 30,
  maxBackoffSeconds: 3_600,
};

const SCANNER_CONFIG: DisputeEvidenceScannerConfig = {
  url: "https://scanner.fixture.invalid/v1/scan",
  token: "fixture-retry-scanner-secret-123",
  timeoutMs: 1_000,
  maxResponseBytes: 16_384,
  allowInsecureHttp: false,
  allowPrivateNetwork: false,
};

function countDelta(
  after: { totals: Record<string, number> },
  before: { totals: Record<string, number> },
  key: string,
): number {
  return Number(after.totals[key] ?? 0) - Number(before.totals[key] ?? 0);
}

export async function runDisputeEvidenceScanRetryFixture(db: Database) {
  const disputeId = randomUUID();
  const cleanId = randomUUID();
  const infectedId = randomUUID();
  const exhaustedId = randomUUID();
  const staleId = randomUUID();
  const ids = [cleanId, infectedId, exhaustedId, staleId];
  const baseline = await getDisputeEvidenceScanRetryHealth(db, {
    config: RETRY_CONFIG,
  });
  let cleanupRows = 0;
  let guardRejected = false;
  let fixtureResult: Record<string, unknown> | null = null;
  try {
    const circuit = await runDisputeEvidenceScannerCircuitFixture(db);
    await db.execute(sql`
      INSERT INTO dispute_evidence_uploads
        (id, dispute_id, uploaded_by, evidence_type, content_type,
         file_size_bytes, storage_path, status, scan_status,
         scan_attempt_count, scan_next_attempt_at, scan_lease_token,
         scan_lease_expires_at, expires_at, created_at, updated_at)
      VALUES
        (${cleanId}::uuid, ${disputeId}::uuid, 'buyer', 'image', 'image/png',
         ${PNG.length}, ${`dispute-evidence/${disputeId}/${cleanId}.png`},
         'QUARANTINED', 'PENDING', 0, now() - interval '1 minute',
         NULL, NULL, now() + interval '1 hour', now() - interval '5 minutes',
         now() - interval '1 minute'),
        (${infectedId}::uuid, ${disputeId}::uuid, 'seller', 'image', 'image/png',
         ${PNG.length}, ${`dispute-evidence/${disputeId}/${infectedId}.png`},
         'QUARANTINED', 'FAILED', 1, now() - interval '1 minute',
         NULL, NULL, now() + interval '1 hour', now() - interval '4 minutes',
         now() - interval '1 minute'),
        (${exhaustedId}::uuid, ${disputeId}::uuid, 'buyer', 'image', 'image/png',
         ${PNG.length}, ${`dispute-evidence/${disputeId}/${exhaustedId}.png`},
         'QUARANTINED', 'FAILED', 4, now() - interval '1 minute',
         NULL, NULL, now() + interval '1 hour', now() - interval '3 minutes',
         now() - interval '1 minute'),
        (${staleId}::uuid, ${disputeId}::uuid, 'seller', 'image', 'image/png',
         ${PNG.length}, ${`dispute-evidence/${disputeId}/${staleId}.png`},
         'QUARANTINED', 'SCANNING', 1, NULL, ${randomUUID()}::uuid,
         now() - interval '1 minute', now() + interval '1 hour',
         now() - interval '2 minutes', now() - interval '1 minute')
    `);

    const scan: typeof scanDisputeEvidence = async (input) => {
      const sha256 = createHash("sha256").update(input.bytes).digest("hex");
      if (input.filename.startsWith(infectedId)) {
        return {
          status: "INFECTED", sha256,
          provider: "fixture-scanner", detail: "FIXTURE_MALWARE_DETECTED",
        };
      }
      if (input.filename.startsWith(exhaustedId)) {
        return {
          status: "FAILED", sha256,
          provider: "fixture-scanner", detail: "FIXTURE_SCANNER_TIMEOUT",
        };
      }
      return {
        status: "CLEAN", sha256,
        provider: "fixture-scanner", detail: "CLEAN",
      };
    };
    const download = async () => Buffer.from(PNG);
    const runs = await Promise.all(Array.from({ length: 20 }, () =>
      runDisputeEvidenceScanRetry(db, {
        retryConfig: RETRY_CONFIG,
        scannerConfig: SCANNER_CONFIG,
        download,
        scan,
      })));
    const claimed = runs.reduce((sum, run) => sum + run.claimed, 0);
    const clean = runs.reduce((sum, run) => sum + run.clean, 0);
    const infected = runs.reduce((sum, run) => sum + run.infected, 0);
    const exhausted = runs.reduce((sum, run) => sum + run.exhausted, 0);
    const realNetworkCalled = runs.some((run) => run.realNetworkCalled);
    const realStorageRead = runs.some((run) => run.storageRead);

    const stored = await db.execute(sql`
      SELECT id::text, status, scan_status AS "scanStatus",
        scan_attempt_count AS "attemptCount",
        scan_next_attempt_at AS "nextAttemptAt",
        scan_lease_token AS "leaseToken",
        scan_lease_expires_at AS "leaseExpiresAt", scan_detail AS "scanDetail"
       FROM dispute_evidence_uploads
       WHERE id IN (${cleanId}::uuid, ${infectedId}::uuid,
         ${exhaustedId}::uuid, ${staleId}::uuid)
    `) as unknown as Array<Record<string, unknown>>;
    const byId = new Map(stored.map((row) => [String(row.id), row]));
    const staleClaim: DisputeEvidenceScanRetryClaim = {
      uploadId: cleanId,
      disputeId,
      storagePath: `dispute-evidence/${disputeId}/${cleanId}.png`,
      contentType: "image/png",
      fileSizeBytes: PNG.length,
      attemptCount: 1,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    };
    const staleFinalizerAccepted = await finalizeDisputeEvidenceScanRetry(
      db,
      staleClaim,
      { status: "CLEAN", provider: "stale-fixture", detail: "CLEAN" },
      { config: RETRY_CONFIG },
    );
    try {
      await db.execute(sql`
        UPDATE dispute_evidence_uploads
           SET scan_status = 'SCANNING', scan_lease_token = NULL,
               scan_lease_expires_at = NULL
         WHERE id = ${exhaustedId}::uuid
      `);
    } catch {
      guardRejected = true;
    }
    const health = await getDisputeEvidenceScanRetryHealth(db, {
      config: RETRY_CONFIG,
    });
    const cleanRow = byId.get(cleanId);
    const staleRow = byId.get(staleId);
    const infectedRow = byId.get(infectedId);
    const exhaustedRow = byId.get(exhaustedId);
    const checks = {
      distributedClaimExactlyOnce: claimed === 4,
      cleanRowsRecovered: clean === 2
        && cleanRow?.scanStatus === "CLEAN"
        && staleRow?.scanStatus === "CLEAN",
      staleLeaseReclaimed: Number(staleRow?.attemptCount) === 2,
      infectedRejected: infected === 1
        && infectedRow?.status === "REJECTED"
        && infectedRow?.scanStatus === "INFECTED",
      maxAttemptsEnforced: exhausted === 1
        && exhaustedRow?.scanStatus === "FAILED"
        && exhaustedRow?.nextAttemptAt === null
        && String(exhaustedRow?.scanDetail).startsWith("SCAN_RETRY_EXHAUSTED:"),
      leasesCleared: stored.every((row) => row.leaseToken === null
        && row.leaseExpiresAt === null),
      staleFinalizerRejected: staleFinalizerAccepted === false,
      databaseGuardRejectedInvalidLease: guardRejected,
      healthDetectedExhausted: countDelta(health, baseline, "exhausted") === 1,
      healthNoStaleProcessing:
        countDelta(health, baseline, "staleProcessing") === 0,
      noRealNetwork: realNetworkCalled === false,
      noRealStorageRead: realStorageRead === false,
      identifiersExcluded: health.containsIdentifiers === false
        && health.containsStoragePaths === false
        && health.containsLeaseTokens === false,
      scannerCircuitProtected: circuit.status === "pass"
        && circuit.totals.passed === circuit.totals.total,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    const result = {
      schemaVersion: "dispute-evidence-scan-retry-fixture-v1" as const,
      status: passed === Object.keys(checks).length
        ? "pass" as const : "fail" as const,
      totals: { passed, total: Object.keys(checks).length },
      checks,
      execution: {
        concurrentWorkers: 20,
        claimed,
        clean,
        infected,
        exhausted,
        realNetworkCalled,
        realStorageRead,
        databaseChanged: true,
      },
      health,
      circuit,
      containsIdentifiers: false,
      containsStoragePaths: false,
      containsLeaseTokens: false,
    };
    const serialized = JSON.stringify(result);
    if (ids.some((id) => serialized.includes(id))
      || serialized.includes(SCANNER_CONFIG.token)) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_FIXTURE_DATA_EXPOSED");
    }
    fixtureResult = result;
  } finally {
    const deleted = await db.execute(sql`
      DELETE FROM dispute_evidence_uploads
       WHERE id IN (${cleanId}::uuid, ${infectedId}::uuid,
         ${exhaustedId}::uuid, ${staleId}::uuid)
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    cleanupRows = deleted.length;
    if (cleanupRows !== ids.length) {
      throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_FIXTURE_CLEANUP_FAILED");
    }
  }
  if (!fixtureResult) {
    throw new Error("DISPUTE_EVIDENCE_SCAN_RETRY_FIXTURE_RESULT_MISSING");
  }
  return {
    ...fixtureResult,
    cleanup: { rows: cleanupRows, succeeded: cleanupRows === ids.length },
  };
}
