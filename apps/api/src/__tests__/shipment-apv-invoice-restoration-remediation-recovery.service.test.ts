import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import {
  getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth,
  listStaleShipmentApvInvoiceRestorationRemediationRecoveries,
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics,
  recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection,
} from "../services/shipment-apv-invoice-restoration-remediation.service.js";

const checkerId = "11111111-1111-4111-8111-111111111111";

function row(id: string, updatedAt: string) {
  return {
    id,
    decision_request_id: "22222222-2222-4222-8222-222222222222",
    issue_type: "SOURCE_MISSING",
    version: 1,
    updated_at: updatedAt,
    apply_error: null,
    acknowledged: false,
    incident_connected: false,
    acknowledged_at: null,
    incident_connected_at: null,
  };
}

describe("shipment APV restoration remediation recovery pagination", () => {
  it("returns a bounded cursor and continues after the exact updated-at and id tuple", async () => {
    const firstId = "33333333-3333-4333-8333-333333333333";
    const secondId = "44444444-4444-4444-8444-444444444444";
    const execute = vi.fn()
      .mockResolvedValueOnce([
        row(firstId, "2026-07-13T00:00:00.000Z"),
        row(secondId, "2026-07-13T00:00:00.000Z"),
      ])
      .mockResolvedValueOnce([row(secondId, "2026-07-13T00:00:00.000Z")]);
    const db = { execute } as unknown as Pick<Database, "execute">;

    const first = await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
      approverId: checkerId, limit: 1, now: new Date("2026-07-13T01:00:00.000Z"),
    });
    expect(first).toMatchObject({ items: [{ requestId: firstId }], truncated: true,
      nextCursor: expect.any(String), recordedAt: "2026-07-13T01:00:00.000Z" });
    expect(first.nextCursor).not.toContain(firstId);

    const second = await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
      approverId: checkerId, limit: 1, cursor: first.nextCursor!,
      now: new Date("2026-07-13T01:05:00.000Z"),
    });
    expect(second).toMatchObject({ items: [{ requestId: secondId }], truncated: false,
      nextCursor: null, recordedAt: "2026-07-13T01:00:00.000Z" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    "%%%",
    Buffer.from(JSON.stringify({ asOf: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z", id: "not-a-uuid" })).toString("base64url"),
    Buffer.from(JSON.stringify({ asOf: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T02:00:00.000Z", id: checkerId })).toString("base64url"),
    Buffer.from(JSON.stringify({ asOf: "2026-07-13T01:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z", id: checkerId, extra: true })).toString("base64url"),
  ])("rejects malformed cursor %s before querying the database", async (cursor) => {
    const execute = vi.fn();
    await expect(listStaleShipmentApvInvoiceRestorationRemediationRecoveries(
      { execute } as unknown as Pick<Database, "execute">,
      { approverId: checkerId, cursor },
    )).rejects.toThrow("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR");
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an empty bounded page for an invalid checker without querying", async () => {
    const execute = vi.fn();
    await expect(listStaleShipmentApvInvoiceRestorationRemediationRecoveries(
      { execute } as unknown as Pick<Database, "execute">,
      { approverId: "not-a-checker", now: new Date("2026-07-13T01:00:00.000Z") },
    )).resolves.toEqual({ items: [], truncated: false, nextCursor: null,
      recordedAt: "2026-07-13T01:00:00.000Z" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects expired and far-future snapshots before querying", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([
        row("33333333-3333-4333-8333-333333333333", "2026-07-13T00:00:00.000Z"),
        row("44444444-4444-4444-8444-444444444444", "2026-07-13T00:01:00.000Z"),
      ]);
    const db = { execute } as unknown as Pick<Database, "execute">;
    const first = await listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
      approverId: checkerId, limit: 1, now: new Date("2026-07-13T01:00:00.000Z"),
    });
    await expect(listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
      approverId: checkerId, cursor: first.nextCursor!, now: new Date("2026-07-13T01:15:00.001Z"),
    })).rejects.toThrow("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR_EXPIRED");
    await expect(listStaleShipmentApvInvoiceRestorationRemediationRecoveries(db, {
      approverId: checkerId, cursor: first.nextCursor!, now: new Date("2026-07-13T00:59:29.999Z"),
    })).rejects.toThrow("INVALID_APV_INVOICE_RESTORATION_REMEDIATION_RECOVERY_CURSOR");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("increments only an aggregate hourly rejection bucket", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    await recordShipmentApvInvoiceRestorationRemediationRecoveryCursorRejection(
      { execute } as unknown as Pick<Database, "execute">,
      { reason: "EXPIRED", now: new Date("2026-07-13T01:02:03.000Z") },
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns identifier-free cursor rejection health for the latest 24 hourly buckets", async () => {
    const execute = vi.fn().mockResolvedValue([{ expired: "3", invalid: "2",
      last_seen_at: "2026-07-13T01:02:03.000Z" }]);
    await expect(getShipmentApvInvoiceRestorationRemediationRecoveryCursorHealth(
      { execute } as unknown as Pick<Database, "execute">,
      new Date("2026-07-13T02:00:00.000Z"),
    )).resolves.toEqual({ windowHours: 24, expired: 3, invalid: 2, total: 5,
      lastSeenAt: "2026-07-13T01:02:03.000Z", recordedAt: "2026-07-13T02:00:00.000Z" });
  });

  it("dry-runs a bounded oldest-first retention batch without deleting", async () => {
    const execute = vi.fn().mockResolvedValue([
      { reason: "EXPIRED" }, { reason: "INVALID" }, { reason: "EXPIRED" },
    ]);
    await expect(maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics(
      { execute } as unknown as Pick<Database, "execute">,
      { retentionDays: 30, limit: 2, dryRun: true, now: new Date("2026-07-13T02:00:00.000Z") },
    )).resolves.toEqual({ dryRun: true, retentionDays: 30, limit: 2, eligibleBuckets: 2,
      deletedBuckets: undefined, expiredBuckets: 1, invalidBuckets: 1, truncated: true,
      cutoffAt: "2026-06-13T02:00:00.000Z", recordedAt: "2026-07-13T02:00:00.000Z" });
  });

  it("deletes only the bounded candidate batch and reports aggregate reasons", async () => {
    const execute = vi.fn().mockResolvedValue([{ reason: "EXPIRED" }]);
    await expect(maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics(
      { execute } as unknown as Pick<Database, "execute">,
      { retentionDays: 30, limit: 2, dryRun: false, now: new Date("2026-07-13T02:00:00.000Z") },
    )).resolves.toMatchObject({ dryRun: false, deletedBuckets: 1, expiredBuckets: 1,
      invalidBuckets: 0, truncated: false });
  });
});
