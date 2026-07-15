import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { getShipmentApvFailureAlertReceiverClaimHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-health.service.js";

function database(row: Record<string, unknown> | undefined) {
  const execute = vi.fn().mockResolvedValue(row ? [row] : []);
  return { execute } as unknown as Pick<Database, "execute">;
}

const healthy = {
  total_claims: "3",
  claims_last_24h: "2",
  claims_older_30d: "1",
  binding_failure_count: "0",
  delivery_id_mismatch_count: "0",
  freshness_violation_count: "0",
  unsafe_side_effect_count: "0",
  observed_at: "2026-07-13T20:00:00.000Z",
};

describe("shipment APV local receiver claim health", () => {
  it("returns identifier-free healthy aggregates without deleting old claims", async () => {
    await expect(getShipmentApvFailureAlertReceiverClaimHealth(database(healthy))).resolves.toEqual(
      {
        schemaVersion: "shipment-apv-failure-alert-receiver-claim-health-v1",
        status: "healthy",
        totals: { claims: 3, last24Hours: 2, olderThan30Days: 1 },
        violations: { binding: 0, deliveryId: 0, freshness: 0, unsafeSideEffect: 0 },
        criticalCount: 0,
        retention: { policy: "UNSET_PRESERVE", automaticDeletion: false },
        networkReceipt: false,
        productionAccepted: false,
        observedAt: "2026-07-13T20:00:00.000Z",
      },
    );
  });

  it("marks any persisted invariant violation critical", async () => {
    const result = await getShipmentApvFailureAlertReceiverClaimHealth(
      database({
        ...healthy,
        binding_failure_count: "1",
        delivery_id_mismatch_count: "2",
        freshness_violation_count: "3",
        unsafe_side_effect_count: "4",
      }),
    );
    expect(result).toMatchObject({
      status: "critical",
      criticalCount: 10,
      violations: { binding: 1, deliveryId: 2, freshness: 3, unsafeSideEffect: 4 },
    });
  });

  it("fails closed on missing or malformed aggregate rows", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverClaimHealth(database(undefined)),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_HEALTH_INVALID");
    await expect(
      getShipmentApvFailureAlertReceiverClaimHealth(
        database({
          ...healthy,
          total_claims: "not-a-count",
        }),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_HEALTH_INVALID");
  });
});
