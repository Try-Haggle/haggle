import { randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import {
  acquireDisputeEvidenceScannerPermit,
  type DisputeEvidenceScannerCircuitConfig,
  finalizeDisputeEvidenceScannerPermit,
  getDisputeEvidenceScannerCircuitHealth,
} from "./dispute-evidence-scanner-circuit.service.js";

const FIXTURE_CONFIG: DisputeEvidenceScannerCircuitConfig = {
  failureThreshold: 3,
  openSeconds: 60,
  permitLeaseSeconds: 30,
  maxConcurrent: 4,
};

interface CircuitFixtureResult {
  schemaVersion: "dispute-evidence-scanner-circuit-fixture-v1";
  status: "pass" | "fail";
  totals: { passed: number; total: number };
  checks: Record<string, boolean>;
  execution: Record<string, number | boolean>;
  health: Record<string, unknown>;
  containsPermitTokens: false;
  containsCircuitKey: false;
}

export async function runDisputeEvidenceScannerCircuitFixture(db: Database) {
  const circuitKey = `fixture:${randomUUID()}`;
  const startedAt = new Date("2026-07-14T12:00:00.000Z");
  let stateRowsDeleted = 0;
  let result: CircuitFixtureResult | null = null;
  try {
    const initial = await Promise.all(
      Array.from({ length: 20 }, () =>
        acquireDisputeEvidenceScannerPermit(db, {
          now: startedAt,
          circuitKey,
          config: FIXTURE_CONFIG,
        }),
      ),
    );
    const initialPermits = initial.filter((permit) => permit.acquired);
    const capacityBlocked = initial.filter(
      (permit) => !permit.acquired && permit.reason === "CAPACITY_BUSY",
    );
    await Promise.all(
      initialPermits.map((permit) =>
        permit.acquired
          ? finalizeDisputeEvidenceScannerPermit(db, permit, {
              scannerOperational: false,
              now: startedAt,
              config: FIXTURE_CONFIG,
            })
          : Promise.resolve(false),
      ),
    );

    const openHealth = await getDisputeEvidenceScannerCircuitHealth(db, {
      now: startedAt,
      circuitKey,
      config: FIXTURE_CONFIG,
    });
    const whileOpen = await Promise.all(
      Array.from({ length: 20 }, () =>
        acquireDisputeEvidenceScannerPermit(db, {
          now: new Date(startedAt.getTime() + 1_000),
          circuitKey,
          config: FIXTURE_CONFIG,
        }),
      ),
    );
    const probeAt = new Date(startedAt.getTime() + 61_000);
    const halfOpen = await Promise.all(
      Array.from({ length: 20 }, () =>
        acquireDisputeEvidenceScannerPermit(db, {
          now: probeAt,
          circuitKey,
          config: FIXTURE_CONFIG,
        }),
      ),
    );
    const probes = halfOpen.filter((permit) => permit.acquired && permit.kind === "PROBE");
    const probe = probes[0];
    if (!probe?.acquired) {
      throw new Error("SCANNER_CIRCUIT_FIXTURE_PROBE_MISSING");
    }
    const probeFinalized = await finalizeDisputeEvidenceScannerPermit(db, probe, {
      scannerOperational: true,
      now: probeAt,
      config: FIXTURE_CONFIG,
    });
    const closedHealth = await getDisputeEvidenceScannerCircuitHealth(db, {
      now: probeAt,
      circuitKey,
      config: FIXTURE_CONFIG,
    });
    const infectedPermit = await acquireDisputeEvidenceScannerPermit(db, {
      now: new Date(probeAt.getTime() + 1_000),
      circuitKey,
      config: FIXTURE_CONFIG,
    });
    const infectedFinalized = infectedPermit.acquired
      ? await finalizeDisputeEvidenceScannerPermit(db, infectedPermit, {
          scannerOperational: true,
          now: new Date(probeAt.getTime() + 1_000),
          config: FIXTURE_CONFIG,
        })
      : false;

    const guardedPermit = await acquireDisputeEvidenceScannerPermit(db, {
      now: new Date(probeAt.getTime() + 2_000),
      circuitKey,
      config: FIXTURE_CONFIG,
    });
    let immutablePermitGuard = false;
    if (guardedPermit.acquired) {
      try {
        await db.execute(sql`
          UPDATE dispute_evidence_scanner_permits
             SET expires_at = expires_at + interval '1 second'
           WHERE permit_id = ${guardedPermit.permitId}::uuid
        `);
      } catch {
        immutablePermitGuard = true;
      }
      await finalizeDisputeEvidenceScannerPermit(db, guardedPermit, {
        scannerOperational: true,
        now: new Date(probeAt.getTime() + 2_000),
        config: FIXTURE_CONFIG,
      });
    }
    const checks = {
      bulkheadExactlyFour: initialPermits.length === 4 && capacityBlocked.length === 16,
      failuresOpenedCircuit: openHealth.state === "OPEN" && openHealth.consecutiveFailures === 4,
      openCircuitBlockedAll: whileOpen.every(
        (permit) => !permit.acquired && permit.reason === "CIRCUIT_OPEN",
      ),
      halfOpenSingleProbe:
        probes.length === 1 && halfOpen.filter((permit) => !permit.acquired).length === 19,
      successfulProbeClosedCircuit:
        probeFinalized && closedHealth.state === "CLOSED" && closedHealth.consecutiveFailures === 0,
      infectedResponseCountsAsOperational: infectedFinalized,
      databaseRejectedPermitMutation: immutablePermitGuard,
      identifiersExcluded:
        openHealth.containsPermitTokens === false && openHealth.containsCircuitKey === false,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    result = {
      schemaVersion: "dispute-evidence-scanner-circuit-fixture-v1" as const,
      status: passed === Object.keys(checks).length ? ("pass" as const) : ("fail" as const),
      totals: { passed, total: Object.keys(checks).length },
      checks,
      execution: {
        concurrentCallers: 20,
        permitsGranted: initialPermits.length,
        capacityBlocked: capacityBlocked.length,
        openBlocked: whileOpen.filter((permit) => !permit.acquired).length,
        halfOpenProbes: probes.length,
        halfOpenBlocked: halfOpen.filter((permit) => !permit.acquired).length,
        databaseChanged: true,
        realNetworkCalled: false,
      },
      health: { open: openHealth, recovered: closedHealth },
      containsPermitTokens: false,
      containsCircuitKey: false,
    };
    if (JSON.stringify(result).includes(circuitKey)) {
      throw new Error("SCANNER_CIRCUIT_FIXTURE_IDENTIFIER_EXPOSED");
    }
  } finally {
    const deleted = (await db.execute(sql`
      DELETE FROM dispute_evidence_scanner_circuits
       WHERE circuit_key = ${circuitKey}
      RETURNING circuit_key
    `)) as unknown as Array<{ circuit_key: string }>;
    stateRowsDeleted = deleted.length;
    if (stateRowsDeleted !== 1) {
      // biome-ignore lint/correctness/noUnsafeFinally: Fixture cleanup failure must override a pass result.
      throw new Error("SCANNER_CIRCUIT_FIXTURE_CLEANUP_FAILED");
    }
  }
  if (!result) throw new Error("SCANNER_CIRCUIT_FIXTURE_RESULT_MISSING");
  return {
    ...result,
    cleanup: { stateRows: stateRowsDeleted, succeeded: true },
  };
}
