import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { getShipmentApvInvoiceRestorationRemediationHealth } from
  "../services/shipment-apv-invoice-restoration-remediation.service.js";

function dbRow(row: Record<string, unknown>) {
  return { execute: vi.fn().mockResolvedValue([{
    pending_requests: 0, applying_requests: 0, expiring_soon_requests: 0,
    overdue_pending_requests: 0, stale_applying_requests: 0,
    stale_applying_over_15_minutes: 0, stale_applying_over_60_minutes: 0,
    unacknowledged_stale_over_60_minutes: 0, incident_unlinked_stale_over_60_minutes: 0,
    acknowledged_still_applying_over_30_minutes: 0,
    incident_linked_still_applying_over_30_minutes: 0,
    incident_link_overdue_after_acknowledgment: 0,
    oldest_pending_age_seconds: null, oldest_applying_age_seconds: null, ...row,
  }]) } as unknown as Pick<Database, "execute">;
}

describe("shipment APV restoration remediation health", () => {
  it.each([
    [null, "none"], [299, "none"], [300, "5m"], [899, "5m"],
    [900, "15m"], [3599, "15m"], [3600, "60m"],
  ] as const)("maps oldest applying age %s to %s", async (age, bucket) => {
    const health = await getShipmentApvInvoiceRestorationRemediationHealth(
      dbRow({ oldest_applying_age_seconds: age }), new Date("2026-07-13T00:00:00.000Z"));
    expect(health.staleApplyingAgeBucket).toBe(bucket);
  });

  it("returns aggregate escalation counts without request identifiers", async () => {
    const health = await getShipmentApvInvoiceRestorationRemediationHealth(dbRow({
      applying_requests: 3, stale_applying_requests: 3,
      stale_applying_over_15_minutes: 2, stale_applying_over_60_minutes: 1,
      unacknowledged_stale_over_60_minutes: 1, incident_unlinked_stale_over_60_minutes: 1,
      acknowledged_still_applying_over_30_minutes: 1,
      incident_linked_still_applying_over_30_minutes: 1,
      incident_link_overdue_after_acknowledgment: 1,
      oldest_applying_age_seconds: 7200,
    }), new Date("2026-07-13T00:00:00.000Z"));
    expect(health).toMatchObject({ status: "critical", applyingRequests: 3,
      staleApplyingRequests: 3, staleApplyingOver15Minutes: 2,
      staleApplyingOver60Minutes: 1, unacknowledgedStaleOver60Minutes: 1,
      incidentUnlinkedStaleOver60Minutes: 1, acknowledgedStillApplyingOver30Minutes: 1,
      incidentLinkedStillApplyingOver30Minutes: 1, incidentLinkOverdueAfterAcknowledgment: 1,
      staleApplyingAgeBucket: "60m" });
    expect(JSON.stringify(health)).not.toMatch(/requestId|decisionRequestId|approverId|path|sha256/i);
  });

  it("fails safe when handling aggregates exist without a stale aggregate", async () => {
    const health = await getShipmentApvInvoiceRestorationRemediationHealth(dbRow({
      unacknowledged_stale_over_60_minutes: 1,
      incident_unlinked_stale_over_60_minutes: 1,
    }), new Date("2026-07-13T00:00:00.000Z"));
    expect(health).toMatchObject({ status: "critical",
      unacknowledgedStaleOver60Minutes: 1, incidentUnlinkedStaleOver60Minutes: 1 });
  });

  it("fails safe when post-acknowledgment age aggregates exist without a stale aggregate", async () => {
    const health = await getShipmentApvInvoiceRestorationRemediationHealth(dbRow({
      acknowledged_still_applying_over_30_minutes: 1,
      incident_linked_still_applying_over_30_minutes: 1,
    }), new Date("2026-07-13T00:00:00.000Z"));
    expect(health).toMatchObject({ status: "critical",
      acknowledgedStillApplyingOver30Minutes: 1, incidentLinkedStillApplyingOver30Minutes: 1 });
  });

  it("fails safe when incident-link SLA is overdue without a stale aggregate", async () => {
    const health = await getShipmentApvInvoiceRestorationRemediationHealth(dbRow({
      incident_link_overdue_after_acknowledgment: 1,
    }), new Date("2026-07-13T00:00:00.000Z"));
    expect(health).toMatchObject({ status: "critical", incidentLinkOverdueAfterAcknowledgment: 1 });
  });
});
