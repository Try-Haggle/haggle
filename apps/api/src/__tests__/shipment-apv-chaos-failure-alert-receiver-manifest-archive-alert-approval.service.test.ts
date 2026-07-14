import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { createShipmentApvReceiverManifestArchiveAlertApprovalRequest } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-approval.service.js";
import { evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T23:30:00.000Z");
const actor = "66666666-6666-4666-8666-666666666666";
const clientRequestId = "11111111-1111-4111-8111-111111111111";
const fingerprint = evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview({
  schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-health-v1",
  status: "warning", totals: { intents: 0, latestReceiptRevision: null,
    latestIntentRevision: null, currentSourceEntries: 0 },
  violations: { binding: 0, blockers: 0, unsafeSideEffect: 0,
    timestamp: 0, sourceLimit: 0 }, criticalCount: 0,
  coverage: { currentReceiptIntentCovered: false,
    missingCurrentArchiveIntent: true },
  freshness: { slaSeconds: 86400, latestIntentAgeSeconds: null, stale: false },
  containsRawIdentifiers: false, httpRequestCreated: false,
  networkDelivered: false, externalReceiptVerified: false,
  productionAccepted: false, observedAt: now.toISOString(),
}).stateFingerprint;

function healthRow(overrides: Record<string, unknown> = {}) {
  return { intent_count: 0, latest_receipt_revision: null,
    latest_intent_revision: null, current_source_entry_count: 0,
    binding_violation_count: 0, blocker_violation_count: 0,
    unsafe_side_effect_count: 0, timestamp_violation_count: 0,
    source_limit_violation_count: 0, current_receipt_intent_covered: false,
    latest_intent_age_seconds: null, observed_at: now.toISOString(), ...overrides };
}

function approvalRow(overrides: Record<string, unknown> = {}) {
  return { id: "22222222-2222-4222-8222-222222222222",
    client_request_id: clientRequestId,
    preview_schema_version:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1",
    state_fingerprint: fingerprint, preview_action: "review_warning",
    preview_severity: "warning", preview_reasons: ["current_archive_intent_missing"],
    requested_by: actor, created_at: now.toISOString(),
    expires_at: "2026-07-13T23:45:00.000Z", inserted: true, ...overrides };
}

function database(results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { db: { transaction } as unknown as Pick<Database, "transaction">,
    execute, transaction };
}

describe("shipment APV receiver manifest archive alert approval request", () => {
  it("persists one append-only maker request bound to the current warning preview", async () => {
    const { db, execute, transaction } = database([
      [], [], [healthRow()], [approvalRow()],
    ]);
    const result = await createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      db, { clientRequestId, stateFingerprint: fingerprint, requestedBy: actor, now });
    expect(result).toMatchObject({ status: "PENDING", replayed: false,
      preview: { action: "review_warning", severity: "warning",
        reasons: ["current_archive_intent_missing"] },
      appendOnly: true, containsArchiveIdentifiers: false,
      makerIdentityReturned: false, checkerDecisionCreated: false,
      payloadCreated: false, signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false, productionAccepted: false });
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(4);
    const lock = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
    expect(lock).toContain(
      "receiver-claim-manifest-receipt.v1");
    expect(lock).toContain("receiver-manifest-archive-approval.v1");
    const insert = new PgDialect().sqlToQuery(execute.mock.calls[3]![0]);
    expect(insert.sql.toLowerCase()).toMatch(
      /insert into\s+shipment_apv_manifest_archive_alert_approval_requests/);
    expect(insert.params).toContain(actor);
    expect(insert.params).not.toContain("archive credential");
  });

  it("returns exact replay before consulting current health", async () => {
    const { db, execute } = database([[], [approvalRow({ inserted: false })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      db, { clientRequestId, stateFingerprint: fingerprint, requestedBy: actor, now }))
      .resolves.toMatchObject({ replayed: true, status: "PENDING" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects a replay key rebound to another maker or state", async () => {
    const { db } = database([[], [approvalRow({
      requested_by: "33333333-3333-4333-8333-333333333333", inserted: false })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      db, { clientRequestId, stateFingerprint: fingerprint, requestedBy: actor, now }))
      .rejects.toThrow("APPROVAL_REPLAY_CONFLICT");
  });

  it("rejects a healthy state and a changed warning fingerprint before writing", async () => {
    const healthy = database([[], [], [healthRow({ current_receipt_intent_covered: true,
      latest_receipt_revision: 1, latest_intent_revision: 1,
      latest_intent_age_seconds: 60 })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      healthy.db, { clientRequestId, stateFingerprint: fingerprint,
        requestedBy: actor, now })).rejects.toThrow("ALERT_NOT_ACTIONABLE");
    expect(healthy.execute).toHaveBeenCalledTimes(3);

    const changed = database([[], [], [healthRow()]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      changed.db, { clientRequestId, stateFingerprint: "a".repeat(64),
        requestedBy: actor, now })).rejects.toThrow("ALERT_STATE_CHANGED");
    expect(changed.execute).toHaveBeenCalledTimes(3);
  });

  it("derives expiry without mutating a replayed request", async () => {
    const { db } = database([[], [approvalRow({ inserted: false,
      created_at: "2026-07-13T23:00:00.000Z",
      expires_at: "2026-07-13T23:15:00.000Z" })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      db, { clientRequestId, stateFingerprint: fingerprint, requestedBy: actor, now }))
      .resolves.toMatchObject({ status: "EXPIRED", replayed: true });
  });

  it("fails closed if the inserted row does not match the live preview", async () => {
    const { db } = database([[], [], [healthRow()], [approvalRow({
      preview_reasons: ["archive_intent_stale"] })]]);
    await expect(createShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      db, { clientRequestId, stateFingerprint: fingerprint, requestedBy: actor, now }))
      .rejects.toThrow("APPROVAL_REPLAY_CONFLICT");
  });
});
