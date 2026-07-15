import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { getShipmentApvFailureAlertReceiverClaimManifestHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-claim-manifest-health.service.js";

function database(row: Record<string, unknown> | undefined) {
  const execute = vi.fn().mockResolvedValue(row ? [row] : []);
  return { execute } as unknown as Pick<Database, "execute">;
}

const healthy = {
  receipt_count: 2,
  latest_revision: 2,
  latest_entry_count: 1,
  current_source_entry_count: 1,
  revision_gap_count: 0,
  previous_mismatch_count: 0,
  manifest_digest_mismatch_count: 0,
  receipt_set_mismatch_count: 0,
  unsafe_side_effect_count: 0,
  timestamp_violation_count: 0,
  source_limit_violation_count: 0,
  source_covered: true,
  latest_receipt_age_seconds: 60,
  observed_at: "2026-07-13T22:00:00.000Z",
};

describe("shipment APV receiver claim manifest health", () => {
  it("returns healthy identifier-free chain and coverage aggregates", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverClaimManifestHealth(database(healthy)),
    ).resolves.toEqual({
      schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-health-v1",
      status: "healthy",
      totals: { receipts: 2, latestRevision: 2, latestReceiptEntries: 1, currentSourceEntries: 1 },
      violations: {
        revisionGap: 0,
        previousMismatch: 0,
        manifestDigest: 0,
        receiptSet: 0,
        unsafeSideEffect: 0,
        timestamp: 0,
        sourceLimit: 0,
      },
      criticalCount: 0,
      coverage: { currentSourceCovered: true, missingCurrentReceipt: false },
      freshness: { slaSeconds: 86400, latestReceiptAgeSeconds: 60, stale: false },
      containsRawIdentifiers: false,
      externalArchive: false,
      networkDelivered: false,
      productionAccepted: false,
      observedAt: "2026-07-13T22:00:00.000Z",
    });
  });

  it("warns for an uncovered or stale but intact source snapshot", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverClaimManifestHealth(
        database({
          ...healthy,
          receipt_count: 0,
          latest_revision: null,
          latest_entry_count: null,
          source_covered: false,
          latest_receipt_age_seconds: null,
        }),
      ),
    ).resolves.toMatchObject({
      status: "warning",
      coverage: { currentSourceCovered: false, missingCurrentReceipt: true },
    });
    await expect(
      getShipmentApvFailureAlertReceiverClaimManifestHealth(
        database({
          ...healthy,
          latest_receipt_age_seconds: 86401,
        }),
      ),
    ).resolves.toMatchObject({
      status: "warning",
      freshness: { latestReceiptAgeSeconds: 86401, stale: true },
    });
  });

  it("marks any chain or source invariant violation critical", async () => {
    const result = await getShipmentApvFailureAlertReceiverClaimManifestHealth(
      database({
        ...healthy,
        revision_gap_count: 1,
        previous_mismatch_count: 2,
        manifest_digest_mismatch_count: 3,
        receipt_set_mismatch_count: 4,
        unsafe_side_effect_count: 5,
        timestamp_violation_count: 6,
        source_limit_violation_count: 1,
      }),
    );
    expect(result).toMatchObject({
      status: "critical",
      criticalCount: 22,
      violations: {
        revisionGap: 1,
        previousMismatch: 2,
        manifestDigest: 3,
        receiptSet: 4,
        unsafeSideEffect: 5,
        timestamp: 6,
        sourceLimit: 1,
      },
    });
  });

  it("fails closed on missing or malformed aggregates", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverClaimManifestHealth(database(undefined)),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_HEALTH_INVALID");
    await expect(
      getShipmentApvFailureAlertReceiverClaimManifestHealth(
        database({
          ...healthy,
          receipt_count: "invalid",
        }),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_HEALTH_INVALID");
  });
});
