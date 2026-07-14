import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
} from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

vi.unmock("@haggle/db");

function health(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
    status: "healthy",
    totals: { intents: 1, latestReceiptRevision: 1,
      latestIntentRevision: 1, currentSourceEntries: 0 },
    violations: { binding: 0, blockers: 0, unsafeSideEffect: 0,
      timestamp: 0, sourceLimit: 0 },
    criticalCount: 0,
    coverage: { currentReceiptIntentCovered: true,
      missingCurrentArchiveIntent: false },
    freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 60, stale: false },
    containsRawIdentifiers: false,
    httpRequestCreated: false,
    networkDelivered: false,
    externalReceiptVerified: false,
    productionAccepted: false,
    observedAt: "2026-07-13T23:30:00.000Z",
    ...overrides,
  };
}

function evaluate(value: ReturnType<typeof health>) {
  return evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(
    value as never);
}

describe("shipment APV receiver manifest archive alert preview", () => {
  it("returns a non-actionable healthy preview without side effects", () => {
    expect(evaluate(health())).toMatchObject({
      mode: "preview_only", action: "none", severity: "healthy", reasons: [],
      approval: { required: false, state: "not_required" },
      delivery: { endpointConfigured: false, enabled: false, attempted: false,
        networkDelivered: false, externalReceiptVerified: false,
        productionAccepted: false },
      payload: { created: false, signed: false }, containsRawIdentifiers: false,
    });
  });

  it("separates missing and stale warning reasons", () => {
    const missing = evaluate(health({ status: "warning",
      totals: { intents: 0, latestReceiptRevision: null,
        latestIntentRevision: null, currentSourceEntries: 0 },
      coverage: { currentReceiptIntentCovered: false,
        missingCurrentArchiveIntent: true },
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: null, stale: false } }));
    expect(missing).toMatchObject({ action: "review_warning", severity: "warning",
      reasons: ["current_archive_intent_missing"],
      approval: { required: true, state: "not_requested" } });
    const stale = evaluate(health({ status: "warning",
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 86401, stale: true } }));
    expect(stale.reasons).toEqual(["archive_intent_stale"]);
  });

  it("orders every critical reason deterministically and retains warning context", () => {
    const preview = evaluate(health({ status: "critical",
      totals: { intents: 5, latestReceiptRevision: 2,
        latestIntentRevision: null, currentSourceEntries: 1001 },
      violations: { binding: 1, blockers: 1, unsafeSideEffect: 1,
        timestamp: 1, sourceLimit: 1 }, criticalCount: 5,
      coverage: { currentReceiptIntentCovered: false,
        missingCurrentArchiveIntent: true },
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: null, stale: false } }));
    expect(preview).toMatchObject({ action: "escalate_critical", severity: "critical",
      reasons: ["archive_intent_binding_violation", "archive_intent_blocker_violation",
        "archive_intent_side_effect_violation", "archive_intent_timestamp_violation",
        "archive_source_limit_violation", "current_archive_intent_missing"] });
  });

  it("fails closed on inconsistent status, counts, binding, or side-effect claims", () => {
    expect(() => evaluate(health({ status: "warning" }))).toThrow(/HEALTH_INVALID/);
    expect(() => evaluate(health({ criticalCount: 1 }))).toThrow(/HEALTH_INVALID/);
    expect(() => evaluate(health({ totals: { intents: 1, latestReceiptRevision: 2,
      latestIntentRevision: 1, currentSourceEntries: 0 } }))).toThrow(/HEALTH_INVALID/);
    expect(() => evaluate(health({ networkDelivered: true }))).toThrow(/HEALTH_INVALID/);
  });

  it("fails closed on unsupported source schema or malformed timestamps", () => {
    expect(() => evaluate(health({ schemaVersion: "future" }))).toThrow(/HEALTH_INVALID/);
    expect(() => evaluate(health({ observedAt: "not-a-time" }))).toThrow(/HEALTH_INVALID/);
  });

  it("fingerprints public state but ignores clock-only age changes before a transition", () => {
    const first = evaluate(health());
    const later = evaluate(health({ observedAt: "2026-07-13T23:31:00.000Z",
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 120, stale: false } }));
    const stale = evaluate(health({ status: "warning",
      freshness: { slaSeconds: 86400, latestIntentAgeSeconds: 86401, stale: true } }));
    expect(first.stateFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(later.stateFingerprint).toBe(first.stateFingerprint);
    expect(stale.stateFingerprint).not.toBe(first.stateFingerprint);
    expect(JSON.stringify(first)).not.toMatch(
      /"(?:intent_id|receipt_id|user_id|request_id|token|credential)"/i);
  });

  it("loads one read-only aggregate statement and performs no archive mutation", async () => {
    const execute = vi.fn().mockResolvedValue([{
      intent_count: 1, latest_receipt_revision: 1, latest_intent_revision: 1,
      current_source_entry_count: 0, binding_violation_count: 0,
      blocker_violation_count: 0, unsafe_side_effect_count: 0,
      timestamp_violation_count: 0, source_limit_violation_count: 0,
      current_receipt_intent_covered: true, latest_intent_age_seconds: 60,
      observed_at: "2026-07-13T23:30:00.000Z",
    }]);
    const preview = await getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(
      { execute } as unknown as Pick<Database, "execute">);
    expect(preview).toMatchObject({ action: "none", mode: "preview_only" });
    expect(execute).toHaveBeenCalledOnce();
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[0]![0])
      .sql.trim().toLowerCase();
    expect(statement).toMatch(/^with\b/);
    expect(statement).not.toMatch(/\b(insert|update|delete|truncate|alter|drop)\b/);
  });
});
