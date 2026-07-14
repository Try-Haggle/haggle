import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { decideShipmentApvReceiverManifestArchiveAlertApprovalRequest } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-decision.service.js";
import { evaluateShipmentApvFailureAlertReceiverManifestArchiveAlertPreview } from
  "../services/shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T23:35:00.000Z");
const maker = "55555555-5555-4555-8555-555555555555";
const checker = "66666666-6666-4666-8666-666666666666";
const requestId = "22222222-2222-4222-8222-222222222222";
const clientDecisionId = "33333333-3333-4333-8333-333333333333";
const decisionId = "44444444-4444-4444-8444-444444444444";
const previewSchema =
  "shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1";
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

function requestRow(overrides: Record<string, unknown> = {}) {
  return { id: requestId, preview_schema_version: previewSchema,
    state_fingerprint: fingerprint, preview_action: "review_warning",
    preview_severity: "warning", preview_reasons: ["current_archive_intent_missing"],
    requested_by: maker, expires_at: "2026-07-13T23:45:00.000Z",
    decision_id: null, client_decision_id: null, decision: null,
    decision_reason: null, decided_by: null, decision_created_at: null,
    ...overrides };
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  return { id: decisionId, client_decision_id: clientDecisionId,
    approval_request_id: requestId, request_state_fingerprint: fingerprint,
    decision: "APPROVED", decision_reason: "checker_approved_snapshot",
    decided_by: checker, created_at: now.toISOString(), inserted: true,
    preview_schema_version: previewSchema, preview_action: "review_warning",
    approval_state_fingerprint: fingerprint,
    preview_severity: "warning", preview_reasons: ["current_archive_intent_missing"],
    ...overrides };
}

function database(results: unknown[][]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback) => callback({ execute }));
  return { db: { transaction } as unknown as Pick<Database, "transaction">,
    execute, transaction };
}

describe("receiver manifest archive alert maker-checker decision", () => {
  it("records an append-only approval after full current-state revalidation", async () => {
    const { db, execute, transaction } = database([
      [], [], [requestRow()], [healthRow()], [decisionRow()],
    ]);
    const result =
      await decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(db, {
        approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "APPROVED", now,
      });
    expect(result).toMatchObject({ decision: "APPROVED", replayed: false,
      request: { stateFingerprint: fingerprint, action: "review_warning",
        severity: "warning", reasons: ["current_archive_intent_missing"] },
      persistent: true, appendOnly: true, makerCheckerSeparated: true,
      makerIdentityReturned: false, checkerIdentityReturned: false,
      containsArchiveIdentifiers: false, payloadCreated: false, signed: false,
      delivery: { enabled: false, attempted: false },
      externalReceiptVerified: false, productionAccepted: false });
    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(5);
    const lock = new PgDialect().sqlToQuery(execute.mock.calls[0]![0]).sql;
    expect(lock).toContain("receiver-claim-manifest-receipt.v1");
    expect(lock).toContain("receiver-manifest-archive-approval.v1");
    expect(lock).toContain("receiver-manifest-archive-decision.v1");
    const insert = new PgDialect().sqlToQuery(execute.mock.calls[4]![0]);
    expect(insert.sql.toLowerCase()).toMatch(
      /insert into\s+shipment_apv_manifest_archive_alert_approval_decisions/);
    expect(insert.params).toContain(checker);
  });

  it("revalidates current state for rejection as well as approval", async () => {
    const { db, execute } = database([
      [], [], [requestRow()], [healthRow()], [decisionRow({ decision: "REJECTED",
        decision_reason: "checker_rejected_snapshot" })],
    ]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(db, {
      approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
      decision: "REJECTED", now,
    })).resolves.toMatchObject({ decision: "REJECTED",
      reason: "checker_rejected_snapshot", replayed: false });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("returns exact replay before request and current health reads", async () => {
    const { db, execute } = database([[], [decisionRow({ inserted: false })]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(db, {
      approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
      decision: "APPROVED", now,
    })).resolves.toMatchObject({ replayed: true, decision: "APPROVED" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects a replay key rebound to another checker or decision", async () => {
    const { db } = database([[], [decisionRow({ inserted: false,
      decided_by: maker })]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(db, {
      approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
      decision: "APPROVED", now,
    })).rejects.toThrow("DECISION_REPLAY_CONFLICT");
  });

  it("fails closed on malformed replay bindings before request or health reads", async () => {
    const { db, execute } = database([[], [decisionRow({ inserted: false,
      decision_reason: "checker_rejected_snapshot" })]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(db, {
      approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
      decision: "APPROVED", now,
    })).rejects.toThrow("DECISION_REPLAY_CONFLICT");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("blocks the maker and expired requests", async () => {
    const self = database([[], [], [requestRow()]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      self.db, { approvalRequestId: requestId, clientDecisionId, decidedBy: maker,
        decision: "APPROVED", now })).rejects.toThrow("MAKER_CHECKER_REQUIRED");
    expect(self.execute).toHaveBeenCalledTimes(3);

    const expired = database([[], [], [requestRow({
      expires_at: "2026-07-13T23:34:59.999Z" })]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      expired.db, { approvalRequestId: requestId, clientDecisionId,
        decidedBy: checker, decision: "REJECTED", now }))
      .rejects.toThrow("APPROVAL_REQUEST_EXPIRED");
    expect(expired.execute).toHaveBeenCalledTimes(3);

    const invalid = database([[], [], [requestRow({ expires_at: "invalid" })]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      invalid.db, { approvalRequestId: requestId, clientDecisionId,
        decidedBy: checker, decision: "REJECTED", now }))
      .rejects.toThrow("DECISION_INVALID");
    expect(invalid.execute).toHaveBeenCalledTimes(3);
  });

  it("rejects a terminal request decided by another client id", async () => {
    const prior = requestRow({ decision_id: decisionId,
      client_decision_id: "77777777-7777-4777-8777-777777777777",
      decision: "REJECTED", decision_reason: "checker_rejected_snapshot",
      decided_by: checker, decision_created_at: now.toISOString() });
    const { db } = database([[], [], [prior]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(db, {
      approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
      decision: "APPROVED", now,
    })).rejects.toThrow("ALREADY_DECIDED");
  });

  it("fails closed when current state or stored request binding changed", async () => {
    const healthy = database([[], [], [requestRow()], [healthRow({
      current_receipt_intent_covered: true, latest_receipt_revision: 1,
      latest_intent_revision: 1, latest_intent_age_seconds: 60 })]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      healthy.db, { approvalRequestId: requestId, clientDecisionId,
        decidedBy: checker, decision: "APPROVED", now }))
      .rejects.toThrow("STATE_CHANGED");

    const rebound = database([[], [], [requestRow({
      preview_reasons: ["archive_intent_stale"] })], [healthRow()]]);
    await expect(decideShipmentApvReceiverManifestArchiveAlertApprovalRequest(
      rebound.db, { approvalRequestId: requestId, clientDecisionId,
        decidedBy: checker, decision: "REJECTED", now }))
      .rejects.toThrow("STATE_CHANGED");
  });
});
