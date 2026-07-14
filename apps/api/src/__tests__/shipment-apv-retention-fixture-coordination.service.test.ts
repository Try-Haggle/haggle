import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics } from
  "../services/shipment-apv-invoice-restoration-remediation.service.js";
import { runShipmentApvRemediationCursorRetention } from
  "../jobs/shipment-apv-remediation-cursor-retention.js";

vi.unmock("@haggle/db");
vi.mock("../services/shipment-apv-invoice-restoration-remediation.service.js", () => ({
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics: vi.fn(),
}));

const mockMaintain = vi.mocked(
  maintainShipmentApvInvoiceRestorationRemediationRecoveryCursorMetrics);
const now = new Date("2026-07-13T00:00:00.000Z");

describe("shipment APV retention fixture coordination", () => {
  it("gates both singleton insert and conflict-update claims on the fixture lease", async () => {
    const execute = vi.fn().mockResolvedValueOnce([]);
    await expect(runShipmentApvRemediationCursorRetention(
      { execute } as unknown as Database, { now }))
      .resolves.toEqual({ status: "skipped", reason: "in_progress" });
    expect(mockMaintain).not.toHaveBeenCalled();
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.sql.match(/payment_test_operation_leases/g)).toHaveLength(2);
    expect(query.params.filter((value) => value === "shipment-apv-chaos-fixture"))
      .toHaveLength(2);
    expect(query.params.filter((value) => value === null)).toHaveLength(4);
  });

  it("binds the exact fixture lease id for the owner-only retention run", async () => {
    const fixtureLeaseId = "77777777-7777-4777-8777-777777777777";
    const execute = vi.fn()
      .mockResolvedValueOnce([{ claim_id: "11111111-1111-4111-8111-111111111111" }])
      .mockResolvedValueOnce([{ status: "SUCCEEDED" }]);
    mockMaintain.mockResolvedValueOnce({ dryRun: false, retentionDays: 30, limit: 1000,
      eligibleBuckets: undefined, deletedBuckets: 0, expiredBuckets: 0, invalidBuckets: 0,
      truncated: false, cutoffAt: "2026-06-13T00:00:00.000Z",
      recordedAt: now.toISOString() });
    await expect(runShipmentApvRemediationCursorRetention(
      { execute } as unknown as Database, { now, fixtureLeaseId }))
      .resolves.toMatchObject({ status: "skipped", reason: "healthy" });
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]);
    expect(query.params.filter((value) => value === fixtureLeaseId)).toHaveLength(4);
  });
});
