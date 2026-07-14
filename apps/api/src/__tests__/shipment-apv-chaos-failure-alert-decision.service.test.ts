import { describe, expect, it, vi } from "vitest";
import type { Database } from "@haggle/db";
import { PgDialect } from "drizzle-orm/pg-core";
import { decideShipmentApvFailureAlertApprovalRequest } from
  "../services/shipment-apv-chaos-failure-alert-decision.service.js";

vi.unmock("@haggle/db");

const now = new Date("2026-07-13T12:30:00.000Z");
const maker = "99999999-9999-4999-8999-999999999999";
const checker = "66666666-6666-4666-8666-666666666666";
const requestId = "77777777-7777-4777-8777-777777777777";
const clientDecisionId = "55555555-5555-4555-8555-555555555555";
const fingerprint = "39bd711222a81681011ab563de9792d57d1fe98f509c2675b6285be528ab0b8b";

const warningHealthRows = [{
  stage: "rollback_verification", failure_count: "1",
  first_failure_at: "2026-07-13T10:00:00.000Z",
  warning_observed_at: "2026-07-13T10:00:00.000Z",
  critical_observed_at: null,
  last_failure_at: "2026-07-13T10:05:00.000Z",
  retained_first_failure_at: "2026-07-13T10:00:00.000Z",
  retained_warning_observed_at: "2026-07-13T10:00:00.000Z",
  retained_critical_observed_at: null,
  retained_latest_bucket_start: "2026-07-13T10:00:00.000Z",
  retained_last_failure_at: "2026-07-13T10:05:00.000Z",
}];

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: requestId,
    state_fingerprint: fingerprint,
    requested_by: maker,
    expires_at: "2026-07-13T12:45:00.000Z",
    decision_id: null,
    client_decision_id: null,
    decision: null,
    decided_by: null,
    decision_created_at: null,
    ...overrides,
  };
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    client_decision_id: clientDecisionId,
    approval_request_id: requestId,
    request_state_fingerprint: fingerprint,
    decision: "APPROVED",
    decision_reason: "checker_approved_snapshot",
    decided_by: checker,
    created_at: now.toISOString(),
    inserted: true,
    ...overrides,
  };
}

describe("shipment APV failure alert maker-checker decisions", () => {
  it("records a non-executable approval after current-state revalidation", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([requestRow()])
      .mockResolvedValueOnce(warningHealthRows)
      .mockResolvedValueOnce([decisionRow()]);
    const result = await decideShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "APPROVED", now });
    expect(result).toMatchObject({ decision: "APPROVED", replayed: false,
      makerCheckerSeparated: true, executable: false,
      delivery: { enabled: false, attempted: false } });
    expect(execute).toHaveBeenCalledTimes(4);
    const statement = new PgDialect().sqlToQuery(execute.mock.calls[3]![0]);
    expect(statement.sql.toLowerCase()).toContain(
      "insert into shipment_apv_failure_alert_approval_decisions");
    expect(statement.sql.toLowerCase()).toContain("request.requested_by <>");
    expect(statement.params).toContain(checker);
  });

  it("records a rejection without requiring the current failure state", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([requestRow()])
      .mockResolvedValueOnce([decisionRow({ decision: "REJECTED",
        decision_reason: "checker_rejected_snapshot" })]);
    const result = await decideShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "REJECTED", now });
    expect(result).toMatchObject({ decision: "REJECTED", replayed: false,
      reason: "checker_rejected_snapshot", executable: false });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("blocks the maker and expired requests before decision insert", async () => {
    const makerExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([requestRow()]);
    await expect(decideShipmentApvFailureAlertApprovalRequest(
      { execute: makerExecute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: maker,
        decision: "APPROVED", now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_MAKER_CHECKER_REQUIRED");
    expect(makerExecute).toHaveBeenCalledTimes(2);

    const expiredExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      requestRow({ expires_at: "2026-07-13T12:29:59.999Z" }),
    ]);
    await expect(decideShipmentApvFailureAlertApprovalRequest(
      { execute: expiredExecute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "REJECTED", now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_EXPIRED");
    expect(expiredExecute).toHaveBeenCalledTimes(2);
  });

  it("blocks approval when the current public state no longer matches", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([requestRow()]).mockResolvedValueOnce([]);
    await expect(decideShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "APPROVED", now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("returns exact client decision replay before consulting request or current state", async () => {
    const execute = vi.fn().mockResolvedValueOnce([decisionRow({ inserted: false })]);
    const result = await decideShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "APPROVED", now });
    expect(result).toMatchObject({ decision: "APPROVED", replayed: true });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects reused client ids and conflicting terminal decisions", async () => {
    const replayExecute = vi.fn().mockResolvedValueOnce([decisionRow({
      decided_by: "33333333-3333-4333-8333-333333333333", inserted: false,
    })]);
    await expect(decideShipmentApvFailureAlertApprovalRequest(
      { execute: replayExecute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "APPROVED", now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_DECISION_REPLAY_CONFLICT");

    const decidedExecute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([
      requestRow({ decision_id: "44444444-4444-4444-8444-444444444444",
        client_decision_id: "22222222-2222-4222-8222-222222222222",
        decision: "REJECTED", decided_by: checker, decision_created_at: now.toISOString() }),
    ]);
    await expect(decideShipmentApvFailureAlertApprovalRequest(
      { execute: decidedExecute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "APPROVED", now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_ALREADY_DECIDED");
  });

  it("turns a concurrent losing insert into an already-decided conflict", async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
      .mockResolvedValueOnce([requestRow()])
      .mockResolvedValueOnce([decisionRow({
        client_decision_id: "22222222-2222-4222-8222-222222222222",
        decision: "REJECTED", decision_reason: "checker_rejected_snapshot",
        inserted: false,
      })]);
    await expect(decideShipmentApvFailureAlertApprovalRequest(
      { execute } as unknown as Pick<Database, "execute">,
      { approvalRequestId: requestId, clientDecisionId, decidedBy: checker,
        decision: "REJECTED", now }))
      .rejects.toThrow("SHIPMENT_APV_FAILURE_ALERT_ALREADY_DECIDED");
  });
});
