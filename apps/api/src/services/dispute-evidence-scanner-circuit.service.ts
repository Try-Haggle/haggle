import { randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";

export type DisputeEvidenceScannerCircuitState =
  "CLOSED" | "OPEN" | "HALF_OPEN";
export type DisputeEvidenceScannerPermitKind = "REGULAR" | "PROBE";

export interface DisputeEvidenceScannerCircuitConfig {
  failureThreshold: number;
  openSeconds: number;
  permitLeaseSeconds: number;
  maxConcurrent: number;
}

export interface DisputeEvidenceScannerPermit {
  acquired: true;
  permitId: string;
  circuitKey: string;
  kind: DisputeEvidenceScannerPermitKind;
  expiresAt: Date;
}

export interface DisputeEvidenceScannerPermitBlocked {
  acquired: false;
  reason: "CIRCUIT_OPEN" | "HALF_OPEN_PROBE_ACTIVE" | "CAPACITY_BUSY";
  retryAt: Date | null;
}

export type DisputeEvidenceScannerPermitResult =
  DisputeEvidenceScannerPermit | DisputeEvidenceScannerPermitBlocked;

export const DISPUTE_EVIDENCE_SCANNER_CIRCUIT_KEY = "malware-scanner";

const DEFAULT_CONFIG: DisputeEvidenceScannerCircuitConfig = {
  failureThreshold: 3,
  openSeconds: 60,
  permitLeaseSeconds: 30,
  maxConcurrent: 4,
};

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function resolveDisputeEvidenceScannerCircuitConfigFromEnv():
DisputeEvidenceScannerCircuitConfig {
  return {
    failureThreshold: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCANNER_CIRCUIT_FAILURE_THRESHOLD,
      DEFAULT_CONFIG.failureThreshold, 1, 20, "scanner circuit threshold",
    ),
    openSeconds: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCANNER_CIRCUIT_OPEN_SECONDS,
      DEFAULT_CONFIG.openSeconds, 5, 3_600, "scanner circuit open seconds",
    ),
    permitLeaseSeconds: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCANNER_PERMIT_LEASE_SECONDS,
      DEFAULT_CONFIG.permitLeaseSeconds, 5, 300, "scanner permit lease seconds",
    ),
    maxConcurrent: boundedInteger(
      process.env.DISPUTE_EVIDENCE_SCANNER_MAX_CONCURRENT,
      DEFAULT_CONFIG.maxConcurrent, 1, 100, "scanner max concurrency",
    ),
  };
}

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function rowState(row: Record<string, unknown>):
DisputeEvidenceScannerCircuitState {
  if (row.state === "CLOSED" || row.state === "OPEN"
    || row.state === "HALF_OPEN") return row.state;
  throw new Error("invalid scanner circuit state");
}

export async function acquireDisputeEvidenceScannerPermit(
  db: Database,
  input: {
    now?: Date;
    circuitKey?: string;
    config?: DisputeEvidenceScannerCircuitConfig;
  } = {},
): Promise<DisputeEvidenceScannerPermitResult> {
  const now = input.now ?? new Date();
  const circuitKey = input.circuitKey
    ?? DISPUTE_EVIDENCE_SCANNER_CIRCUIT_KEY;
  const config = input.config
    ?? resolveDisputeEvidenceScannerCircuitConfigFromEnv();
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO dispute_evidence_scanner_circuits (circuit_key)
      VALUES (${circuitKey})
      ON CONFLICT (circuit_key) DO NOTHING
    `);
    const rows = await tx.execute(sql`
      SELECT state, consecutive_failures AS "consecutiveFailures",
        next_probe_at AS "nextProbeAt", probe_expires_at AS "probeExpiresAt"
        FROM dispute_evidence_scanner_circuits
       WHERE circuit_key = ${circuitKey}
       FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) throw new Error("scanner circuit state unavailable");

    await tx.execute(sql`
      DELETE FROM dispute_evidence_scanner_permits
       WHERE circuit_key = ${circuitKey}
         AND expires_at <= ${now.toISOString()}::timestamptz
    `);

    const state = rowState(row);
    const nextProbeAt = row.nextProbeAt == null
      ? null : asDate(row.nextProbeAt);
    const probeExpiresAt = row.probeExpiresAt == null
      ? null : asDate(row.probeExpiresAt);
    const canProbe = state === "OPEN"
      ? nextProbeAt !== null && nextProbeAt <= now
      : state === "HALF_OPEN"
        && probeExpiresAt !== null && probeExpiresAt <= now;

    if (!canProbe && state === "OPEN") {
      return { acquired: false, reason: "CIRCUIT_OPEN", retryAt: nextProbeAt };
    }
    if (!canProbe && state === "HALF_OPEN") {
      return {
        acquired: false,
        reason: "HALF_OPEN_PROBE_ACTIVE",
        retryAt: probeExpiresAt,
      };
    }

    const permitId = randomUUID();
    const expiresAt = new Date(
      now.getTime() + config.permitLeaseSeconds * 1_000,
    );
    if (canProbe) {
      await tx.execute(sql`
        UPDATE dispute_evidence_scanner_circuits
           SET state = 'HALF_OPEN', next_probe_at = NULL,
               probe_token = ${permitId}::uuid,
               probe_expires_at = ${expiresAt.toISOString()}::timestamptz,
               updated_at = ${now.toISOString()}::timestamptz
         WHERE circuit_key = ${circuitKey}
      `);
      await tx.execute(sql`
        INSERT INTO dispute_evidence_scanner_permits
          (permit_id, circuit_key, permit_kind, acquired_at, expires_at)
        VALUES (${permitId}::uuid, ${circuitKey}, 'PROBE',
          ${now.toISOString()}::timestamptz,
          ${expiresAt.toISOString()}::timestamptz)
      `);
      return {
        acquired: true, permitId, circuitKey, kind: "PROBE", expiresAt,
      };
    }

    const countRows = await tx.execute(sql`
      SELECT count(*)::int AS count
        FROM dispute_evidence_scanner_permits
       WHERE circuit_key = ${circuitKey}
         AND expires_at > ${now.toISOString()}::timestamptz
    `) as unknown as Array<{ count: number }>;
    if (Number(countRows[0]?.count ?? 0) >= config.maxConcurrent) {
      return { acquired: false, reason: "CAPACITY_BUSY", retryAt: null };
    }
    await tx.execute(sql`
      INSERT INTO dispute_evidence_scanner_permits
        (permit_id, circuit_key, permit_kind, acquired_at, expires_at)
      VALUES (${permitId}::uuid, ${circuitKey}, 'REGULAR',
        ${now.toISOString()}::timestamptz,
        ${expiresAt.toISOString()}::timestamptz)
    `);
    return {
      acquired: true, permitId, circuitKey, kind: "REGULAR", expiresAt,
    };
  });
}

export async function finalizeDisputeEvidenceScannerPermit(
  db: Database,
  permit: DisputeEvidenceScannerPermit,
  input: {
    scannerOperational: boolean;
    now?: Date;
    config?: DisputeEvidenceScannerCircuitConfig;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const config = input.config
    ?? resolveDisputeEvidenceScannerCircuitConfigFromEnv();
  return db.transaction(async (tx) => {
    const stateRows = await tx.execute(sql`
      SELECT state, consecutive_failures AS "consecutiveFailures",
        probe_token AS "probeToken"
        FROM dispute_evidence_scanner_circuits
       WHERE circuit_key = ${permit.circuitKey}
       FOR UPDATE
    `) as unknown as Array<Record<string, unknown>>;
    const state = stateRows[0];
    if (!state) return false;
    const permitRows = await tx.execute(sql`
      DELETE FROM dispute_evidence_scanner_permits
       WHERE permit_id = ${permit.permitId}::uuid
         AND circuit_key = ${permit.circuitKey}
      RETURNING permit_kind AS "permitKind"
    `) as unknown as Array<{ permitKind: string }>;
    if (permitRows.length !== 1) return false;

    const probeOwner = permit.kind === "PROBE"
      && state.probeToken === permit.permitId;
    if (input.scannerOperational) {
      await tx.execute(sql`
        UPDATE dispute_evidence_scanner_circuits
           SET state = 'CLOSED', consecutive_failures = 0,
               next_probe_at = NULL, probe_token = NULL,
               probe_expires_at = NULL,
               last_success_at = ${now.toISOString()}::timestamptz,
               updated_at = ${now.toISOString()}::timestamptz
         WHERE circuit_key = ${permit.circuitKey}
           AND (${permit.kind} <> 'PROBE' OR probe_token = ${permit.permitId}::uuid)
      `);
      return true;
    }

    const failures = Math.min(
      1000, Number(state.consecutiveFailures ?? 0) + 1,
    );
    const shouldOpen = probeOwner || failures >= config.failureThreshold;
    if (shouldOpen) {
      const nextProbeAt = new Date(now.getTime() + config.openSeconds * 1_000);
      await tx.execute(sql`
        UPDATE dispute_evidence_scanner_circuits
           SET state = 'OPEN', consecutive_failures = ${failures},
               next_probe_at = ${nextProbeAt.toISOString()}::timestamptz,
               probe_token = NULL, probe_expires_at = NULL,
               last_failure_at = ${now.toISOString()}::timestamptz,
               updated_at = ${now.toISOString()}::timestamptz
         WHERE circuit_key = ${permit.circuitKey}
           AND (${permit.kind} <> 'PROBE' OR probe_token = ${permit.permitId}::uuid)
      `);
    } else {
      await tx.execute(sql`
        UPDATE dispute_evidence_scanner_circuits
           SET consecutive_failures = ${failures},
               last_failure_at = ${now.toISOString()}::timestamptz,
               updated_at = ${now.toISOString()}::timestamptz
         WHERE circuit_key = ${permit.circuitKey}
      `);
    }
    return true;
  });
}

export async function getDisputeEvidenceScannerCircuitHealth(
  db: Database,
  input: { now?: Date; circuitKey?: string;
    config?: DisputeEvidenceScannerCircuitConfig } = {},
) {
  const now = input.now ?? new Date();
  const circuitKey = input.circuitKey
    ?? DISPUTE_EVIDENCE_SCANNER_CIRCUIT_KEY;
  const config = input.config
    ?? resolveDisputeEvidenceScannerCircuitConfigFromEnv();
  const rows = await db.execute(sql`
    SELECT circuit.state,
      circuit.consecutive_failures AS "consecutiveFailures",
      circuit.next_probe_at AS "nextProbeAt",
      circuit.probe_expires_at AS "probeExpiresAt",
      circuit.last_success_at AS "lastSuccessAt",
      circuit.last_failure_at AS "lastFailureAt",
      count(permit.permit_id) FILTER (
        WHERE permit.expires_at > ${now.toISOString()}::timestamptz
      )::int AS "activePermits"
      FROM dispute_evidence_scanner_circuits circuit
      LEFT JOIN dispute_evidence_scanner_permits permit
        ON permit.circuit_key = circuit.circuit_key
     WHERE circuit.circuit_key = ${circuitKey}
     GROUP BY circuit.circuit_key
  `) as unknown as Array<Record<string, unknown>>;
  const row = rows[0];
  const state = row ? rowState(row) : "CLOSED";
  const timestamp = (value: unknown) => value == null
    ? null : asDate(value).toISOString();
  return {
    schemaVersion: "dispute-evidence-scanner-circuit-health-v1" as const,
    status: state === "CLOSED" ? "healthy" as const : "attention" as const,
    state,
    consecutiveFailures: Number(row?.consecutiveFailures ?? 0),
    activePermits: Number(row?.activePermits ?? 0),
    policy: config,
    nextProbeAt: timestamp(row?.nextProbeAt),
    probeExpiresAt: timestamp(row?.probeExpiresAt),
    lastSuccessAt: timestamp(row?.lastSuccessAt),
    lastFailureAt: timestamp(row?.lastFailureAt),
    containsPermitTokens: false,
    containsCircuitKey: false,
    observedAt: now.toISOString(),
  };
}
