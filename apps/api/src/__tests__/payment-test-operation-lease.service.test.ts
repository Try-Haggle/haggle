import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import {
  acquireFinalityAlertFixtureLease,
  acquireShipmentApvChaosFixtureLease,
  FINALITY_ALERT_FIXTURE_LEASE_KEY,
  PAYMENT_TEST_OPERATION_LEASE_SECONDS,
  releaseFinalityAlertFixtureLease,
  releaseShipmentApvChaosFixtureLease,
  renewFinalityAlertFixtureLease,
  renewShipmentApvChaosFixtureLease,
  runFinalityAlertFixtureLeaseVerification,
  SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY,
} from "../services/payment-test-operation-lease.service.js";

describe("payment test operation lease", () => {
  it("acquires the global finality fixture lease", async () => {
    const now = new Date("2026-07-12T18:00:00.000Z");
    const execute = vi.fn().mockResolvedValue([{ key: FINALITY_ALERT_FIXTURE_LEASE_KEY,
      leaseId: "11111111-1111-4111-8111-111111111111", ownerId: "admin-1",
      expiresAt: new Date(now.getTime() + PAYMENT_TEST_OPERATION_LEASE_SECONDS * 1000) }]);
    const lease = await acquireFinalityAlertFixtureLease({ execute } as unknown as Database,
      { leaseId: "11111111-1111-4111-8111-111111111111", ownerId: "admin-1" }, now);
    expect(lease).toMatchObject({ key: FINALITY_ALERT_FIXTURE_LEASE_KEY, ownerId: "admin-1" });
  });

  it("returns null while another owner holds the lease", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(acquireFinalityAlertFixtureLease({ execute } as unknown as Database,
      { leaseId: "22222222-2222-4222-8222-222222222222", ownerId: "admin-2" })).resolves.toBeNull();
  });

  it("releases only the matching lease token", async () => {
    const execute = vi.fn().mockResolvedValue([{ key: FINALITY_ALERT_FIXTURE_LEASE_KEY }]);
    await expect(releaseFinalityAlertFixtureLease({ execute } as unknown as Database,
      "11111111-1111-4111-8111-111111111111")).resolves.toBe(true);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("reports a lost lease token without claiming release success", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await expect(releaseFinalityAlertFixtureLease({ execute } as unknown as Database,
      "22222222-2222-4222-8222-222222222222")).resolves.toBe(false);
  });

  it("renews only the active global lease token", async () => {
    const execute = vi.fn().mockResolvedValue([{ key: FINALITY_ALERT_FIXTURE_LEASE_KEY }]);
    await expect(renewFinalityAlertFixtureLease({ execute } as unknown as Database,
      "11111111-1111-4111-8111-111111111111", new Date("2026-07-12T18:04:00.000Z"))).resolves.toBe(true);
  });

  it("acquires, renews, and releases the shipment APV fixture lease", async () => {
    const now = new Date("2026-07-12T18:00:00.000Z");
    const leaseId = "33333333-3333-4333-8333-333333333333";
    const execute = vi.fn()
      .mockResolvedValueOnce([{ key: SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY,
        leaseId, ownerId: "shipment-apv-fixture", expiresAt: now }])
      .mockResolvedValueOnce([{ key: SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY }])
      .mockResolvedValueOnce([{ key: SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY }]);
    const db = { execute } as unknown as Database;
    await expect(acquireShipmentApvChaosFixtureLease(db,
      { leaseId, ownerId: "shipment-apv-fixture" }, now)).resolves.toMatchObject({
      key: SHIPMENT_APV_CHAOS_FIXTURE_LEASE_KEY, leaseId,
    });
    await expect(renewShipmentApvChaosFixtureLease(db, leaseId, now)).resolves.toBe(true);
    await expect(releaseShipmentApvChaosFixtureLease(db, leaseId)).resolves.toBe(true);
  });

  it("verifies expiry takeover and old-owner fencing", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([{ key: "verification", leaseId: "first", ownerId: "fixture-owner-1", expiresAt: new Date() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "verification" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "verification", leaseId: "second", ownerId: "fixture-owner-2", expiresAt: new Date() }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ key: "verification" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: "0" }]);
    const result = await runFinalityAlertFixtureLeaseVerification({ execute } as unknown as Database, {
      keySuffix: "test", firstLeaseId: "first", secondLeaseId: "second",
      now: new Date("2026-07-12T18:00:00.000Z"),
    });
    expect(result).toMatchObject({ pass: true, firstAcquired: true, competitorBlocked: true,
      heartbeatRenewed: true, originalExpiryTakeoverBlocked: true, takeoverAcquired: true,
      oldOwnerFenced: true, newOwnerReleased: true, cleanupRemaining: 0 });
  });
});
