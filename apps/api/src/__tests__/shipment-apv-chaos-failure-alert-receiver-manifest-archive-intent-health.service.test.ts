import type { Database } from "@haggle/db";
import { describe, expect, it, vi } from "vitest";
import { getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth } from "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-intent-health.service.js";

function database(row: Record<string, unknown> | undefined) {
  const execute = vi.fn().mockResolvedValue(row ? [row] : []);
  return { execute } as unknown as Pick<Database, "execute">;
}

const healthy = {
  intent_count: 2,
  latest_receipt_revision: 2,
  latest_intent_revision: 2,
  current_source_entry_count: 1,
  binding_violation_count: 0,
  blocker_violation_count: 0,
  unsafe_side_effect_count: 0,
  timestamp_violation_count: 0,
  source_limit_violation_count: 0,
  current_receipt_intent_covered: true,
  latest_intent_age_seconds: 60,
  observed_at: "2026-07-13T23:30:00.000Z",
};

describe("shipment APV receiver manifest archive intent health", () => {
  it("returns healthy identifier-free coverage aggregates", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(database(healthy)),
    ).resolves.toEqual({
      schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
      status: "healthy",
      totals: {
        intents: 2,
        latestReceiptRevision: 2,
        latestIntentRevision: 2,
        currentSourceEntries: 1,
      },
      violations: { binding: 0, blockers: 0, unsafeSideEffect: 0, timestamp: 0, sourceLimit: 0 },
      criticalCount: 0,
      coverage: { currentReceiptIntentCovered: true, missingCurrentArchiveIntent: false },
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 60, stale: false },
      containsRawIdentifiers: false,
      httpRequestCreated: false,
      networkDelivered: false,
      externalReceiptVerified: false,
      productionAccepted: false,
      observedAt: "2026-07-13T23:30:00.000Z",
    });
  });

  it("warns when the current receipt has no intent or the intent is stale", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(
        database({
          ...healthy,
          intent_count: 0,
          latest_receipt_revision: null,
          latest_intent_revision: null,
          current_receipt_intent_covered: false,
          latest_intent_age_seconds: null,
        }),
      ),
    ).resolves.toMatchObject({
      status: "warning",
      coverage: { missingCurrentArchiveIntent: true },
    });
    await expect(
      getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(
        database({
          ...healthy,
          latest_intent_age_seconds: 86401,
        }),
      ),
    ).resolves.toMatchObject({ status: "warning", freshness: { stale: true } });
  });

  it("marks invariant violations critical", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(
        database({
          ...healthy,
          binding_violation_count: 1,
          blocker_violation_count: 2,
          unsafe_side_effect_count: 3,
          timestamp_violation_count: 4,
          source_limit_violation_count: 1,
        }),
      ),
    ).resolves.toMatchObject({
      status: "critical",
      criticalCount: 11,
      violations: { binding: 1, blockers: 2, unsafeSideEffect: 3, timestamp: 4, sourceLimit: 1 },
    });
  });

  it("fails closed on missing or malformed aggregates", async () => {
    await expect(
      getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(database(undefined)),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_INVALID");
    await expect(
      getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(
        database({
          ...healthy,
          intent_count: "bad",
        }),
      ),
    ).rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_INVALID");
  });
});
