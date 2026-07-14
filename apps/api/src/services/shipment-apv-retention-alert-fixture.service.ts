import { createHash, randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { isProductionRuntime } from "../config/runtime.js";
import { runShipmentApvPayoutAlert } from "../jobs/shipment-apv-payout-alert.js";
import {
  getShipmentApvRemediationCursorRetentionJobHealth,
  getShipmentApvRemediationCursorRetentionJobStatus,
  runShipmentApvRemediationCursorRetention,
} from "../jobs/shipment-apv-remediation-cursor-retention.js";
import {
  acquireShipmentApvChaosFixtureLeaseWithin,
  PAYMENT_TEST_OPERATION_LEASE_SECONDS,
  releaseShipmentApvChaosFixtureLease,
  SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY,
  startShipmentApvChaosFixtureLeaseHeartbeat,
} from "./payment-test-operation-lease.service.js";
import { signWebhookClaimAlertPayload } from "./webhook-claim-alert.service.js";

interface RetentionStateRow extends Record<string, unknown> {
  status: string;
  claim_id: string | null;
  lease_expires_at: string | Date | null;
  first_observed_at: string | Date;
  last_started_at: string | Date | null;
  last_succeeded_at: string | Date | null;
  last_failed_at: string | Date | null;
  last_deleted_buckets: number;
  last_expired_buckets: number;
  last_invalid_buckets: number;
  last_truncated: boolean;
  last_failure_code: string | null;
  updated_at: string | Date;
}

function asTimestamp(value: string | Date | null) {
  return value instanceof Date ? value.toISOString() : value;
}

function timestampMillis(value: unknown) {
  if (value === null || value === undefined) return null;
  const timestamp = new Date(value as string | Date).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

interface FixtureCleanupActions {
  restoreState: () => Promise<boolean>;
  cleanupClaims: () => Promise<{ deleted: number; remaining: number }>;
  stopHeartbeat: () => void;
  releaseLease: () => Promise<boolean>;
}

async function coordinateFixtureCleanup(actions: FixtureCleanupActions) {
  let cleanupFailed = false;
  let stateRestored = false;
  let claimsDeleted = 0;
  let claimsRemaining = -1;
  let leaseReleased = false;
  try {
    stateRestored = await actions.restoreState();
    if (!stateRestored) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }
  try {
    const claims = await actions.cleanupClaims();
    claimsDeleted = claims.deleted;
    claimsRemaining = claims.remaining;
    if (claimsRemaining !== 0) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }
  try {
    actions.stopHeartbeat();
  } catch {
    cleanupFailed = true;
  }
  try {
    leaseReleased = await actions.releaseLease();
    if (!leaseReleased) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }
  return { cleanupFailed, stateRestored, claimsDeleted, claimsRemaining, leaseReleased };
}

export async function verifyShipmentApvRetentionAlertFixtureCleanupIsolation() {
  let releaseAfterRestoreFailure = false;
  const restoreFailure = await coordinateFixtureCleanup({
    restoreState: async () => {
      throw new Error("sensitive restore failure");
    },
    cleanupClaims: async () => ({ deleted: 2, remaining: 0 }),
    stopHeartbeat: () => undefined,
    releaseLease: async () => {
      releaseAfterRestoreFailure = true;
      return true;
    },
  });
  let releaseAfterClaimFailure = false;
  const claimFailure = await coordinateFixtureCleanup({
    restoreState: async () => true,
    cleanupClaims: async () => {
      throw new Error("sensitive claim failure");
    },
    stopHeartbeat: () => undefined,
    releaseLease: async () => {
      releaseAfterClaimFailure = true;
      return true;
    },
  });
  const releaseFailure = await coordinateFixtureCleanup({
    restoreState: async () => true,
    cleanupClaims: async () => ({ deleted: 2, remaining: 0 }),
    stopHeartbeat: () => undefined,
    releaseLease: async () => false,
  });
  const checks = {
    release_attempted_after_restore_failure:
      restoreFailure.cleanupFailed && releaseAfterRestoreFailure && restoreFailure.leaseReleased,
    claims_attempted_after_restore_failure:
      restoreFailure.claimsDeleted === 2 && restoreFailure.claimsRemaining === 0,
    release_attempted_after_claim_failure:
      claimFailure.cleanupFailed && releaseAfterClaimFailure && claimFailure.leaseReleased,
    release_failure_not_masked:
      releaseFailure.cleanupFailed && releaseFailure.leaseReleased === false,
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

async function getFixtureReservationRollbackSnapshot(
  db: FixtureReservationExecutor,
  leaseKey: string,
) {
  const rows = (await db.execute(sql`
    SELECT
      (SELECT row_to_json(state_row)::text
         FROM shipment_apv_remediation_cursor_retention_state state_row
        WHERE job_key='cursor_retention') AS state_snapshot,
      (SELECT count(*)::int FROM payment_test_operation_leases WHERE key=${leaseKey}) AS lease_count,
      (SELECT lease_id::text FROM payment_test_operation_leases WHERE key=${leaseKey}) AS lease_id
  `)) as unknown as Array<{
    state_snapshot: string | null;
    lease_count: number;
    lease_id: string | null;
  }>;
  return {
    stateSnapshot: rows[0]?.state_snapshot ?? null,
    leaseCount: Number(rows[0]?.lease_count ?? -1),
    leaseId: rows[0]?.lease_id ?? null,
  };
}

interface FixtureRollbackCleanupActions {
  deleteVerificationLeases: () => Promise<void>;
  readRemainingVerificationLeases: () => Promise<number>;
}

async function coordinateFixtureRollbackCleanup(actions: FixtureRollbackCleanupActions) {
  let deleteSucceeded = false;
  let readSucceeded = false;
  let remainingVerificationLeases = -1;
  try {
    await actions.deleteVerificationLeases();
    deleteSucceeded = true;
  } catch {
    deleteSucceeded = false;
  }
  try {
    remainingVerificationLeases = await actions.readRemainingVerificationLeases();
    readSucceeded = true;
  } catch {
    readSucceeded = false;
  }
  return {
    pass: deleteSucceeded && readSucceeded && remainingVerificationLeases === 0,
    deleteAttempted: true,
    deleteSucceeded,
    readAttempted: true,
    readSucceeded,
    remainingVerificationLeases,
  };
}

async function coordinateFixtureRollbackExecution<T>(
  runCases: () => Promise<T>,
  cleanupActions: FixtureRollbackCleanupActions,
) {
  let result: T | null = null;
  let caseExecutionFailed = false;
  try {
    result = await runCases();
  } catch {
    caseExecutionFailed = true;
  }
  const cleanup = await coordinateFixtureRollbackCleanup(cleanupActions);
  return {
    pass: !caseExecutionFailed && result !== null && cleanup.pass,
    caseExecutionFailed,
    result,
    cleanup,
  };
}

export async function verifyShipmentApvFixtureRollbackFailureIsolation() {
  let cleanupAfterCaseFailure = false;
  const caseFailure = await coordinateFixtureRollbackExecution(
    async () => {
      throw new Error("sensitive case database error");
    },
    {
      deleteVerificationLeases: async () => {
        cleanupAfterCaseFailure = true;
      },
      readRemainingVerificationLeases: async () => 0,
    },
  );
  let readAfterDeleteFailure = false;
  const deleteFailure = await coordinateFixtureRollbackExecution(
    async () => ({ cases: "complete" }),
    {
      deleteVerificationLeases: async () => {
        throw new Error("sensitive delete error");
      },
      readRemainingVerificationLeases: async () => {
        readAfterDeleteFailure = true;
        return 1;
      },
    },
  );
  const readFailure = await coordinateFixtureRollbackExecution(
    async () => ({ cases: "complete" }),
    {
      deleteVerificationLeases: async () => undefined,
      readRemainingVerificationLeases: async () => {
        throw new Error("sensitive read error");
      },
    },
  );
  const evidence = { caseFailure, deleteFailure, readFailure };
  const checks = {
    cleanup_attempted_after_case_failure:
      cleanupAfterCaseFailure &&
      caseFailure.cleanup.deleteAttempted &&
      caseFailure.cleanup.readAttempted,
    case_failure_not_masked: caseFailure.caseExecutionFailed && !caseFailure.pass,
    remaining_checked_after_delete_failure:
      readAfterDeleteFailure &&
      deleteFailure.cleanup.readAttempted &&
      deleteFailure.cleanup.remainingVerificationLeases === 1,
    delete_failure_not_masked: !deleteFailure.cleanup.deleteSucceeded && !deleteFailure.pass,
    read_failure_not_treated_as_zero:
      !readFailure.cleanup.readSucceeded &&
      readFailure.cleanup.remainingVerificationLeases === -1 &&
      !readFailure.pass,
    injected_errors_redacted: !JSON.stringify(evidence).includes("sensitive"),
  };
  return { pass: Object.values(checks).every(Boolean), checks };
}

export async function verifyShipmentApvFixtureReservationRollback(db: Database) {
  const verificationKey = `${SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY}-rollback-${randomUUID()}`;
  const now = new Date();
  const baseline = await getFixtureReservationRollbackSnapshot(db, verificationKey);
  if (!baseline.stateSnapshot || baseline.leaseCount !== 0) {
    throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_BASELINE_UNAVAILABLE");
  }
  const blockerLeaseId = randomUUID();
  const execution = await coordinateFixtureRollbackExecution(
    async () => {
      let busyRejected = false;
      let missingRejected = false;
      let collisionRejected = false;
      try {
        await db.transaction(async (transaction) => {
          const busyClaimId = randomUUID();
          const changed = (await transaction.execute(sql`
          UPDATE shipment_apv_remediation_cursor_retention_state
             SET status='RUNNING', claim_id=${busyClaimId}::uuid,
                 lease_expires_at=${new Date(now.getTime() + 60_000).toISOString()}::timestamptz,
                 last_started_at=${now.toISOString()}::timestamptz,
                 updated_at=${now.toISOString()}::timestamptz
           WHERE job_key='cursor_retention' AND status <> 'RUNNING'
          RETURNING status
        `)) as unknown as Array<{ status: string }>;
          if (changed.length !== 1) throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_SETUP_BUSY");
          await reserveRetentionStateWithinTransaction(transaction, {
            leaseId: randomUUID(),
            reservationClaimId: randomUUID(),
            now,
            leaseKey: verificationKey,
          });
        });
      } catch (error) {
        busyRejected =
          error instanceof Error &&
          error.message === "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_BUSY";
      }
      const busyAfter = await getFixtureReservationRollbackSnapshot(db, verificationKey);
      try {
        await db.transaction(async (transaction) => {
          const deleted = (await transaction.execute(sql`
          DELETE FROM shipment_apv_remediation_cursor_retention_state
           WHERE job_key='cursor_retention' AND status <> 'RUNNING'
          RETURNING job_key
        `)) as unknown as Array<{ job_key: string }>;
          if (deleted.length !== 1) throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_SETUP_MISSING");
          await reserveRetentionStateWithinTransaction(transaction, {
            leaseId: randomUUID(),
            reservationClaimId: randomUUID(),
            now,
            leaseKey: verificationKey,
          });
        });
      } catch (error) {
        missingRejected =
          error instanceof Error &&
          error.message === "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_MISSING";
      }
      const missingAfter = await getFixtureReservationRollbackSnapshot(db, verificationKey);
      const blocker = await acquireShipmentApvChaosFixtureLeaseWithin(
        db,
        {
          leaseId: blockerLeaseId,
          ownerId: "shipment-apv-rollback-verification",
        },
        now,
        verificationKey,
      );
      if (!blocker) throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_COLLISION_SETUP_FAILED");
      try {
        await acquireFixtureLeaseAndReserveRetentionState(db, {
          leaseId: randomUUID(),
          reservationClaimId: randomUUID(),
          now,
          leaseKey: verificationKey,
        });
      } catch (error) {
        collisionRejected =
          error instanceof Error &&
          error.message === "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_ALREADY_RUNNING";
      }
      const collisionAfter = await getFixtureReservationRollbackSnapshot(db, verificationKey);
      return {
        checks: {
          busy_rejected: busyRejected,
          busy_state_rolled_back: busyAfter.stateSnapshot === baseline.stateSnapshot,
          busy_lease_rolled_back: busyAfter.leaseCount === 0,
          missing_rejected: missingRejected,
          missing_state_rolled_back: missingAfter.stateSnapshot === baseline.stateSnapshot,
          missing_lease_rolled_back: missingAfter.leaseCount === 0,
          collision_rejected: collisionRejected,
          collision_owner_preserved:
            collisionAfter.leaseCount === 1 && collisionAfter.leaseId === blockerLeaseId,
          collision_state_unchanged: collisionAfter.stateSnapshot === baseline.stateSnapshot,
        },
      };
    },
    {
      deleteVerificationLeases: async () => {
        await db.execute(
          sql`DELETE FROM payment_test_operation_leases WHERE key=${verificationKey}`,
        );
      },
      readRemainingVerificationLeases: async () =>
        (await getFixtureReservationRollbackSnapshot(db, verificationKey)).leaseCount,
    },
  );
  if (!execution.pass || !execution.result) {
    throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_VERIFICATION_FAILED");
  }
  const checks = {
    ...execution.result.checks,
    collision_cleanup_complete: execution.cleanup.remainingVerificationLeases === 0,
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    cleanup: { remainingVerificationLeases: execution.cleanup.remainingVerificationLeases },
  };
}

const FIXTURE_READINESS_ERROR_BY_REASON = {
  production_runtime: "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_FORBIDDEN_IN_PRODUCTION",
  retention_job_active: "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_REQUIRES_DISABLED_JOB",
  retention_state_missing: "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_MISSING",
  retention_state_running: "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_BUSY",
  fixture_lease_active: "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_ALREADY_RUNNING",
} as const;
const FIXTURE_READINESS_SCHEMA_VERSION = "shipment-apv-fixture-readiness-v1";
const FIXTURE_READINESS_VALID_FOR_SECONDS = 5;

type FixtureReservationExecutor = Pick<Database, "execute">;

async function reserveRetentionStateWithinTransaction(
  transaction: FixtureReservationExecutor,
  input: { leaseId: string; reservationClaimId: string; now: Date; leaseKey?: string },
) {
  const lease = await acquireShipmentApvChaosFixtureLeaseWithin(
    transaction,
    {
      leaseId: input.leaseId,
      ownerId: "shipment-apv-retention-alert-fixture",
    },
    input.now,
    input.leaseKey,
  );
  if (!lease) throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_ALREADY_RUNNING");
  const stateRows = (await transaction.execute(sql`
    SELECT * FROM shipment_apv_remediation_cursor_retention_state
     WHERE job_key='cursor_retention' FOR UPDATE
  `)) as unknown as RetentionStateRow[];
  const saved = stateRows[0] ?? null;
  if (!saved) throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_MISSING");
  if (saved.status === "RUNNING") {
    throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_BUSY");
  }
  const reservationExpiresAt = new Date(
    input.now.getTime() + PAYMENT_TEST_OPERATION_LEASE_SECONDS * 1000,
  );
  const reserved = (await transaction.execute(sql`
    UPDATE shipment_apv_remediation_cursor_retention_state
       SET status='RUNNING', claim_id=${input.reservationClaimId}::uuid,
           lease_expires_at=${reservationExpiresAt.toISOString()}::timestamptz,
           last_started_at=${input.now.toISOString()}::timestamptz,
           updated_at=${input.now.toISOString()}::timestamptz
     WHERE job_key='cursor_retention' AND status <> 'RUNNING'
    RETURNING status
  `)) as unknown as Array<{ status: string }>;
  if (reserved.length !== 1) {
    throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_STATE_BUSY");
  }
  return { lease, saved };
}

async function acquireFixtureLeaseAndReserveRetentionState(
  db: Database,
  input: { leaseId: string; reservationClaimId: string; now: Date; leaseKey?: string },
) {
  return db.transaction((transaction) =>
    reserveRetentionStateWithinTransaction(transaction, input),
  );
}

export async function getShipmentApvRetentionAlertFixtureReadiness(db: Database) {
  const productionRuntime = isProductionRuntime();
  const scheduler = getShipmentApvRemediationCursorRetentionJobStatus();
  const stateRows = (await db.execute(sql`
    SELECT status FROM shipment_apv_remediation_cursor_retention_state
     WHERE job_key='cursor_retention' LIMIT 1
  `)) as unknown as Array<{ status: string }>;
  const singletonStatus = stateRows[0]?.status ?? null;
  const leaseRows = (await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM payment_test_operation_leases
       WHERE key=${SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY} AND expires_at > now()
    ) AS active
  `)) as unknown as Array<{ active: boolean }>;
  const fixtureLeaseActive = leaseRows[0]?.active === true;
  const checks = {
    non_production_runtime: !productionRuntime,
    retention_job_inactive: !(scheduler.jobEnabled && scheduler.configured),
    retention_state_present: singletonStatus !== null,
    retention_state_idle: singletonStatus !== null && singletonStatus !== "RUNNING",
    fixture_lease_available: !fixtureLeaseActive,
  };
  const reasons: Array<keyof typeof FIXTURE_READINESS_ERROR_BY_REASON> = [];
  if (!checks.non_production_runtime) reasons.push("production_runtime");
  if (!checks.retention_job_inactive) reasons.push("retention_job_active");
  if (!checks.retention_state_present) reasons.push("retention_state_missing");
  else if (!checks.retention_state_idle) reasons.push("retention_state_running");
  if (!checks.fixture_lease_available) reasons.push("fixture_lease_active");
  const stateFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: FIXTURE_READINESS_SCHEMA_VERSION,
        productionRuntime,
        scheduler: { jobEnabled: scheduler.jobEnabled, configured: scheduler.configured },
        singletonStatus: singletonStatus ?? "MISSING",
        fixtureLeaseAvailable: !fixtureLeaseActive,
      }),
    )
    .digest("hex");
  return {
    eligible: reasons.length === 0,
    status: reasons.length === 0 ? ("ready" as const) : ("blocked" as const),
    reasons,
    checks,
    scheduler: { jobEnabled: scheduler.jobEnabled, configured: scheduler.configured },
    singleton: { status: singletonStatus ?? "MISSING" },
    executionLease: { available: !fixtureLeaseActive },
    schemaVersion: FIXTURE_READINESS_SCHEMA_VERSION,
    stateFingerprint,
    validForSeconds: FIXTURE_READINESS_VALID_FOR_SECONDS,
    recordedAt: new Date().toISOString(),
  };
}

export async function runShipmentApvRetentionAlertFixture(db: Database) {
  const preflight = await getShipmentApvRetentionAlertFixtureReadiness(db);
  if (!preflight.eligible) {
    throw new Error(
      FIXTURE_READINESS_ERROR_BY_REASON[preflight.reasons[0]!] ??
        "SHIPMENT_APV_RETENTION_ALERT_FIXTURE_PREFLIGHT_BLOCKED",
    );
  }
  const rollbackIsolation = await verifyShipmentApvFixtureReservationRollback(db).catch(() => {
    throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_VERIFICATION_FAILED");
  });
  if (!rollbackIsolation.pass) {
    throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_VERIFICATION_FAILED");
  }
  const rollbackFailureIsolation = await verifyShipmentApvFixtureRollbackFailureIsolation();
  if (!rollbackFailureIsolation.pass) {
    throw new Error("SHIPMENT_APV_FIXTURE_ROLLBACK_FAILURE_ISOLATION_FAILED");
  }
  const liveStatus = getShipmentApvRemediationCursorRetentionJobStatus();

  const leaseId = randomUUID();
  const reservationClaimId = randomUUID();
  const now = new Date();
  const reservation = await acquireFixtureLeaseAndReserveRetentionState(db, {
    leaseId,
    reservationClaimId,
    now,
  });
  const heartbeat = startShipmentApvChaosFixtureLeaseHeartbeat(db, leaseId);
  const fixtureId = randomUUID();
  const alertSource = `haggle-shipment-apv-payout-alert-fixture-${fixtureId}`;
  const deliveries: Array<Record<string, unknown>> = [];
  const saved: RetentionStateRow = reservation.saved;
  const stateMutated = true;
  let evidence: Record<string, unknown> | null = null;
  let claimsDeleted = 0;
  let claimsRemaining = -1;
  let stateRestored = false;
  let released = false;
  let cleanupFailed = false;
  try {
    const transitioned = (await db.execute(sql`
      UPDATE shipment_apv_remediation_cursor_retention_state
         SET status='NEVER', claim_id=NULL, lease_expires_at=NULL,
             first_observed_at=${new Date(now.getTime() - 27 * 60 * 60_000).toISOString()}::timestamptz,
             last_started_at=NULL, last_succeeded_at=NULL, last_failed_at=NULL,
             last_deleted_buckets=0, last_expired_buckets=0, last_invalid_buckets=0,
             last_truncated=false, last_failure_code=NULL, updated_at=${now.toISOString()}::timestamptz
       WHERE job_key='cursor_retention' AND status='RUNNING'
         AND claim_id=${reservationClaimId}::uuid
      RETURNING status
    `)) as unknown as Array<{ status: string }>;
    if (transitioned.length !== 1) {
      throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_RESERVATION_LOST");
    }

    const config = {
      url: "https://ops.example/alerts",
      secret: "shipment-apv-retention-fixture-secret",
      timeoutMs: 5000,
      cooldownMinutes: 15,
      expiredThreshold: 1,
      approvalPendingThreshold: 1,
      approvalMaxAgeMinutes: 15,
      allowInsecureHttp: false,
      allowPrivateNetwork: false,
    };
    const cursorRetentionStatus = { ...liveStatus, jobEnabled: true, configured: true };
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const rawBody = String(init?.body ?? "{}");
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      const timestamp = headers.get("x-haggle-alert-timestamp") ?? "";
      const expectedSignature = signWebhookClaimAlertPayload(config.secret, timestamp, rawBody);
      deliveries.push({
        state: body.state,
        severity: body.severity,
        reasons: body.reasons,
        signatureValid: headers.get("x-haggle-alert-signature") === expectedSignature,
        containsInternal: /claimId|leaseExpires|claim_id|lease_expires/i.test(JSON.stringify(body)),
      });
      return new Response("accepted", { status: 202 });
    };
    const fixtureOptions = {
      fetchImpl: fetchImpl as typeof fetch,
      fixture: { alertSource, config, cursorRetentionStatus },
    };
    const firing = await runShipmentApvPayoutAlert(db, { ...fixtureOptions, now });
    const competingRetention = await runShipmentApvRemediationCursorRetention(db, {
      now: new Date(now.getTime() + 500),
      finishedAt: new Date(now.getTime() + 750),
      retentionDays: 30,
      limit: 1000,
    });
    const retention = await runShipmentApvRemediationCursorRetention(db, {
      now: new Date(now.getTime() + 1000),
      finishedAt: new Date(now.getTime() + 2000),
      retentionDays: 30,
      limit: 1000,
      fixtureLeaseId: leaseId,
    });
    const recoveredHealth = await getShipmentApvRemediationCursorRetentionJobHealth(
      db,
      new Date(now.getTime() + 2500),
    );
    const recovery = await runShipmentApvPayoutAlert(db, {
      ...fixtureOptions,
      now: new Date(now.getTime() + 3000),
    });
    const claimRows = (await db.execute(sql`
      SELECT status FROM webhook_idempotency WHERE source=${alertSource} ORDER BY created_at
    `)) as unknown as Array<{ status: string }>;
    evidence = {
      firing: { status: firing.status, assessment: firing.assessment },
      competingRetention: {
        status: competingRetention.status,
        reason: "reason" in competingRetention ? competingRetention.reason : null,
      },
      retention: {
        status: retention.status,
        reason: "reason" in retention ? retention.reason : null,
      },
      recovery: { status: recovery.status, assessment: recovery.assessment },
      recoveredHealth: {
        lastRunStatus: recoveredHealth.lastRunStatus,
        firstObservedAt: recoveredHealth.firstObservedAt,
      },
      deliveries,
      completedClaims: claimRows.filter((row) => row.status === "COMPLETED").length,
    };
  } finally {
    const cleanupResult = await coordinateFixtureCleanup({
      restoreState: async () => {
        if (!stateMutated || !saved) return true;
        await db.execute(sql`
          UPDATE shipment_apv_remediation_cursor_retention_state
             SET status=${saved.status}, claim_id=${saved.claim_id}::uuid,
                 lease_expires_at=${asTimestamp(saved.lease_expires_at)}::timestamptz,
                 first_observed_at=${asTimestamp(saved.first_observed_at)}::timestamptz,
                 last_started_at=${asTimestamp(saved.last_started_at)}::timestamptz,
                 last_succeeded_at=${asTimestamp(saved.last_succeeded_at)}::timestamptz,
                 last_failed_at=${asTimestamp(saved.last_failed_at)}::timestamptz,
                 last_deleted_buckets=${saved.last_deleted_buckets},
                 last_expired_buckets=${saved.last_expired_buckets},
                 last_invalid_buckets=${saved.last_invalid_buckets},
                 last_truncated=${saved.last_truncated}, last_failure_code=${saved.last_failure_code},
                 updated_at=${asTimestamp(saved.updated_at)}::timestamptz
           WHERE job_key='cursor_retention'
        `);
        const restored = (await db.execute(sql`
          SELECT * FROM shipment_apv_remediation_cursor_retention_state WHERE job_key='cursor_retention'
        `)) as unknown as Array<Record<string, unknown>>;
        stateRestored =
          restored[0]?.status === saved.status &&
          String(restored[0]?.claim_id ?? "") === String(saved.claim_id ?? "") &&
          timestampMillis(restored[0]?.lease_expires_at) ===
            timestampMillis(saved.lease_expires_at) &&
          timestampMillis(restored[0]?.first_observed_at) ===
            timestampMillis(saved.first_observed_at) &&
          timestampMillis(restored[0]?.last_started_at) ===
            timestampMillis(saved.last_started_at) &&
          timestampMillis(restored[0]?.last_succeeded_at) ===
            timestampMillis(saved.last_succeeded_at) &&
          timestampMillis(restored[0]?.last_failed_at) === timestampMillis(saved.last_failed_at) &&
          Number(restored[0]?.last_deleted_buckets) === Number(saved.last_deleted_buckets) &&
          Number(restored[0]?.last_expired_buckets) === Number(saved.last_expired_buckets) &&
          Number(restored[0]?.last_invalid_buckets) === Number(saved.last_invalid_buckets) &&
          Boolean(restored[0]?.last_truncated) === Boolean(saved.last_truncated) &&
          String(restored[0]?.last_failure_code ?? "") === String(saved.last_failure_code ?? "") &&
          timestampMillis(restored[0]?.updated_at) === timestampMillis(saved.updated_at);
        return stateRestored;
      },
      cleanupClaims: async () => {
        const deleted = (await db.execute(sql`
          DELETE FROM webhook_idempotency WHERE source=${alertSource} RETURNING idempotency_key
        `)) as unknown as Array<Record<string, unknown>>;
        const remaining = (await db.execute(sql`
          SELECT count(*)::int AS count FROM webhook_idempotency WHERE source=${alertSource}
        `)) as unknown as Array<{ count: number }>;
        return { deleted: deleted.length, remaining: Number(remaining[0]?.count ?? -1) };
      },
      stopHeartbeat: () => heartbeat.stop(),
      releaseLease: () => releaseShipmentApvChaosFixtureLease(db, leaseId),
    });
    cleanupFailed = cleanupResult.cleanupFailed;
    stateRestored = cleanupResult.stateRestored;
    claimsDeleted = cleanupResult.claimsDeleted;
    claimsRemaining = cleanupResult.claimsRemaining;
    released = cleanupResult.leaseReleased;
  }
  const heartbeatState = heartbeat.snapshot();
  if (cleanupFailed) throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_CLEANUP_FAILED");
  if (!released) throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_LEASE_RELEASE_FAILED");
  if (heartbeatState.lost) throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_LEASE_LOST");
  if (!evidence) throw new Error("SHIPMENT_APV_RETENTION_ALERT_FIXTURE_DID_NOT_RUN");

  const firing = evidence.firing as {
    status?: string;
    assessment?: { severity?: string; reasons?: string[] };
  };
  const competingRetention = evidence.competingRetention as {
    status?: string;
    reason?: string | null;
  };
  const retention = evidence.retention as { status?: string; reason?: string | null };
  const recovery = evidence.recovery as { status?: string; assessment?: { severity?: string } };
  const recoveredHealth = evidence.recoveredHealth as { lastRunStatus?: string };
  const cleanupIsolation = await verifyShipmentApvRetentionAlertFixtureCleanupIsolation();
  const checks = {
    ...Object.fromEntries(
      Object.entries(preflight.checks).map(([key, value]) => [`preflight_${key}`, value]),
    ),
    ...Object.fromEntries(
      Object.entries(rollbackIsolation.checks).map(([key, value]) => [`rollback_${key}`, value]),
    ),
    ...Object.fromEntries(
      Object.entries(rollbackFailureIsolation.checks).map(([key, value]) => [
        `rollback_failure_${key}`,
        value,
      ]),
    ),
    cross_instance_retention_blocked:
      competingRetention.status === "skipped" && competingRetention.reason === "in_progress",
    never_warning_delivered:
      firing.status === "delivered" &&
      firing.assessment?.severity === "warning" &&
      firing.assessment.reasons?.includes("invoice_restoration_cursor_retention_never_started") ===
        true,
    retention_first_run_completed:
      ["completed", "skipped"].includes(retention.status ?? "") &&
      (retention.status === "completed" || retention.reason === "healthy") &&
      recoveredHealth.lastRunStatus === "SUCCEEDED",
    recovery_delivered:
      recovery.status === "delivered" && recovery.assessment?.severity === "recovery",
    signed_payloads_valid:
      deliveries.length === 2 && deliveries.every((delivery) => delivery.signatureValid === true),
    internal_claims_redacted: deliveries.every((delivery) => delivery.containsInternal === false),
    db_claim_lifecycle_completed: evidence.completedClaims === 2,
    fixture_claims_cleaned: claimsDeleted === 2 && claimsRemaining === 0,
    singleton_state_restored: stateRestored,
    execution_lease_released: released && !heartbeatState.lost,
    ...Object.fromEntries(
      Object.entries(cleanupIsolation.checks).map(([key, value]) => [`cleanup_${key}`, value]),
    ),
  };
  return {
    pass: Object.values(checks).every(Boolean),
    checks,
    preflight,
    ...evidence,
    cleanupIsolation,
    rollbackIsolation,
    rollbackFailureIsolation,
    cleanup: {
      claimsDeleted,
      claimsRemaining,
      stateRestored,
      leaseReleased: released,
      heartbeatRenewals: heartbeatState.renewals,
      heartbeatFailures: heartbeatState.failures,
    },
  };
}
