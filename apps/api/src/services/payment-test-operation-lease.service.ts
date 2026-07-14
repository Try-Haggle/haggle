import { randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";

export const FINALITY_ALERT_FIXTURE_LEASE_KEY = "conditional-settlement-finality-alert-fixture";
export const SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY = "shipment-apv-chaos-fixture";
export const PAYMENT_TEST_OPERATION_LEASE_SECONDS = 300;
export const PAYMENT_TEST_OPERATION_HEARTBEAT_SECONDS = 100;

export interface PaymentTestOperationLease {
  key: string;
  leaseId: string;
  ownerId: string;
  expiresAt: Date;
}

type PaymentTestOperationLeaseExecutor = Pick<Database, "execute">;

async function acquirePaymentTestOperationLease(
  db: PaymentTestOperationLeaseExecutor,
  key: string,
  input: { leaseId: string; ownerId: string },
  now = new Date(),
): Promise<PaymentTestOperationLease | null> {
  const expiresAt = new Date(now.getTime() + PAYMENT_TEST_OPERATION_LEASE_SECONDS * 1000);
  const rows = (await db.execute(sql`
    INSERT INTO payment_test_operation_leases
      (key, lease_id, owner_id, expires_at, created_at, updated_at)
    VALUES
      (${key}, ${input.leaseId}, ${input.ownerId},
       ${expiresAt.toISOString()}::timestamptz, ${now.toISOString()}::timestamptz,
       ${now.toISOString()}::timestamptz)
    ON CONFLICT (key) DO UPDATE
       SET lease_id = EXCLUDED.lease_id, owner_id = EXCLUDED.owner_id,
           expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
     WHERE payment_test_operation_leases.expires_at <= ${now.toISOString()}::timestamptz
    RETURNING key, lease_id AS "leaseId", owner_id AS "ownerId", expires_at AS "expiresAt"
  `)) as unknown as Array<{
    key: string;
    leaseId: string;
    ownerId: string;
    expiresAt: Date | string;
  }>;
  const row = rows[0];
  return row
    ? { ...row, expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt) }
    : null;
}

export async function acquireFinalityAlertFixtureLease(
  db: Database,
  input: { leaseId: string; ownerId: string },
  now = new Date(),
): Promise<PaymentTestOperationLease | null> {
  return acquirePaymentTestOperationLease(db, FINALITY_ALERT_FIXTURE_LEASE_KEY, input, now);
}

export async function acquireShipmentApvChaosFixtureLease(
  db: Database,
  input: { leaseId: string; ownerId: string },
  now = new Date(),
): Promise<PaymentTestOperationLease | null> {
  return acquirePaymentTestOperationLease(db, SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY, input, now);
}

export async function acquireShipmentApvChaosFixtureLeaseWithin(
  executor: PaymentTestOperationLeaseExecutor,
  input: { leaseId: string; ownerId: string },
  now = new Date(),
  leaseKey = SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY,
): Promise<PaymentTestOperationLease | null> {
  return acquirePaymentTestOperationLease(executor, leaseKey, input, now);
}

async function releasePaymentTestOperationLease(db: Database, key: string, leaseId: string) {
  const rows = (await db.execute(sql`
    DELETE FROM payment_test_operation_leases
     WHERE key = ${key} AND lease_id = ${leaseId}
    RETURNING key
  `)) as unknown as Array<{ key: string }>;
  return rows.length === 1;
}

export async function releaseFinalityAlertFixtureLease(
  db: Database,
  leaseId: string,
): Promise<boolean> {
  return releasePaymentTestOperationLease(db, FINALITY_ALERT_FIXTURE_LEASE_KEY, leaseId);
}

export async function releaseShipmentApvChaosFixtureLease(
  db: Database,
  leaseId: string,
): Promise<boolean> {
  return releasePaymentTestOperationLease(db, SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY, leaseId);
}

async function renewPaymentTestOperationLease(
  db: Database,
  key: string,
  leaseId: string,
  now: Date,
) {
  const expiresAt = new Date(now.getTime() + PAYMENT_TEST_OPERATION_LEASE_SECONDS * 1000);
  const rows = (await db.execute(sql`
    UPDATE payment_test_operation_leases
       SET expires_at = ${expiresAt.toISOString()}::timestamptz,
           updated_at = ${now.toISOString()}::timestamptz
     WHERE key = ${key} AND lease_id = ${leaseId}
    RETURNING key
  `)) as unknown as Array<{ key: string }>;
  return rows.length === 1;
}

export async function renewFinalityAlertFixtureLease(
  db: Database,
  leaseId: string,
  now = new Date(),
): Promise<boolean> {
  return renewPaymentTestOperationLease(db, FINALITY_ALERT_FIXTURE_LEASE_KEY, leaseId, now);
}

export async function renewShipmentApvChaosFixtureLease(
  db: Database,
  leaseId: string,
  now = new Date(),
): Promise<boolean> {
  return renewPaymentTestOperationLease(db, SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY, leaseId, now);
}

function startPaymentTestOperationLeaseHeartbeat(renew: () => Promise<boolean>) {
  let stopped = false;
  let inFlight = false;
  const state = { renewals: 0, failures: 0, lost: false };
  const timer = setInterval(async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      if (await renew()) state.renewals += 1;
      else state.lost = true;
    } catch {
      state.failures += 1;
    } finally {
      inFlight = false;
    }
  }, PAYMENT_TEST_OPERATION_HEARTBEAT_SECONDS * 1000);
  timer.unref();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    snapshot: () => ({ ...state }),
  };
}

export function startFinalityAlertFixtureLeaseHeartbeat(db: Database, leaseId: string) {
  return startPaymentTestOperationLeaseHeartbeat(() => renewFinalityAlertFixtureLease(db, leaseId));
}

export function startShipmentApvChaosFixtureLeaseHeartbeat(db: Database, leaseId: string) {
  return startPaymentTestOperationLeaseHeartbeat(() =>
    renewShipmentApvChaosFixtureLease(db, leaseId),
  );
}

export async function runFinalityAlertFixtureLeaseVerification(
  db: Database,
  options: { keySuffix?: string; firstLeaseId?: string; secondLeaseId?: string; now?: Date } = {},
) {
  const key = `${FINALITY_ALERT_FIXTURE_LEASE_KEY}-verification-${options.keySuffix ?? randomUUID()}`;
  const firstLeaseId = options.firstLeaseId ?? randomUUID();
  const secondLeaseId = options.secondLeaseId ?? randomUUID();
  const now = options.now ?? new Date();
  let result: Record<string, unknown> | null = null;
  let cleanupRemaining = -1;
  try {
    const first = await acquirePaymentTestOperationLease(
      db,
      key,
      { leaseId: firstLeaseId, ownerId: "fixture-owner-1" },
      now,
    );
    const blocked = await acquirePaymentTestOperationLease(
      db,
      key,
      { leaseId: secondLeaseId, ownerId: "fixture-owner-2" },
      new Date(now.getTime() + 1000),
    );
    const heartbeatAt = new Date(now.getTime() + 240 * 1000);
    const heartbeatExpiresAt = new Date(
      heartbeatAt.getTime() + PAYMENT_TEST_OPERATION_LEASE_SECONDS * 1000,
    );
    const heartbeatRows = (await db.execute(sql`
      UPDATE payment_test_operation_leases
         SET expires_at = ${heartbeatExpiresAt.toISOString()}::timestamptz,
             updated_at = ${heartbeatAt.toISOString()}::timestamptz
       WHERE key = ${key} AND lease_id = ${firstLeaseId}
      RETURNING key
    `)) as unknown as Array<{ key: string }>;
    const originalExpiryTakeover = await acquirePaymentTestOperationLease(
      db,
      key,
      { leaseId: secondLeaseId, ownerId: "fixture-owner-2" },
      new Date(now.getTime() + (PAYMENT_TEST_OPERATION_LEASE_SECONDS + 1) * 1000),
    );
    const takeover = await acquirePaymentTestOperationLease(
      db,
      key,
      { leaseId: secondLeaseId, ownerId: "fixture-owner-2" },
      new Date(heartbeatExpiresAt.getTime() + 1000),
    );
    const oldOwnerReleased = (await db.execute(sql`
      DELETE FROM payment_test_operation_leases WHERE key = ${key} AND lease_id = ${firstLeaseId} RETURNING key
    `)) as unknown as Array<{ key: string }>;
    const newOwnerReleased = (await db.execute(sql`
      DELETE FROM payment_test_operation_leases WHERE key = ${key} AND lease_id = ${secondLeaseId} RETURNING key
    `)) as unknown as Array<{ key: string }>;
    result = {
      pass:
        Boolean(first) &&
        blocked === null &&
        heartbeatRows.length === 1 &&
        originalExpiryTakeover === null &&
        takeover?.leaseId === secondLeaseId &&
        oldOwnerReleased.length === 0 &&
        newOwnerReleased.length === 1,
      firstAcquired: Boolean(first),
      competitorBlocked: blocked === null,
      heartbeatRenewed: heartbeatRows.length === 1,
      originalExpiryTakeoverBlocked: originalExpiryTakeover === null,
      takeoverAcquired: takeover?.leaseId === secondLeaseId,
      oldOwnerFenced: oldOwnerReleased.length === 0,
      newOwnerReleased: newOwnerReleased.length === 1,
      heartbeatAtSeconds: 240,
      takeoverAfterSeconds: 541,
    };
  } finally {
    await db.execute(sql`DELETE FROM payment_test_operation_leases WHERE key = ${key}`);
    const remaining = (await db.execute(sql`
      SELECT count(*) AS count FROM payment_test_operation_leases WHERE key = ${key}
    `)) as unknown as Array<{ count: string | number }>;
    cleanupRemaining = Number(remaining[0]?.count ?? -1);
  }
  if (!result) throw new Error("PAYMENT_TEST_OPERATION_LEASE_FIXTURE_DID_NOT_RUN");
  return { ...result, cleanupRemaining, pass: result.pass === true && cleanupRemaining === 0 };
}
