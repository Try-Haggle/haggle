import { type Database, sql } from "@haggle/db";
import { getShipmentApvChaosFailureAlertPreview } from "./shipment-apv-chaos-failure-alert-preview.service.js";

export type ShipmentApvFailureAlertDecision = "APPROVED" | "REJECTED";

type DecisionRow = {
  id: unknown;
  client_decision_id: unknown;
  approval_request_id: unknown;
  request_state_fingerprint: unknown;
  decision: unknown;
  decision_reason: unknown;
  decided_by: unknown;
  created_at: unknown;
  inserted: unknown;
};

type RequestRow = {
  id: unknown;
  state_fingerprint: unknown;
  requested_by: unknown;
  expires_at: unknown;
  decision_id: unknown;
  client_decision_id: unknown;
  decision: unknown;
  decided_by: unknown;
  decision_created_at: unknown;
};

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicDecision(row: DecisionRow) {
  return {
    id: String(row.id),
    clientDecisionId: String(row.client_decision_id),
    approvalRequestId: String(row.approval_request_id),
    stateFingerprint: String(row.request_state_fingerprint),
    decision: String(row.decision) as ShipmentApvFailureAlertDecision,
    reason: String(row.decision_reason),
    decidedAt: iso(row.created_at),
    replayed: row.inserted === false,
    makerCheckerSeparated: true,
    executable: false,
    delivery: { enabled: false, attempted: false },
  };
}

function decisionMatches(
  row: DecisionRow,
  input: {
    clientDecisionId: string;
    approvalRequestId: string;
    decidedBy: string;
    decision: ShipmentApvFailureAlertDecision;
  },
) {
  return (
    String(row.client_decision_id) === input.clientDecisionId &&
    String(row.approval_request_id) === input.approvalRequestId &&
    String(row.decided_by) === input.decidedBy &&
    String(row.decision) === input.decision
  );
}

function existingDecisionFromRequest(row: RequestRow): DecisionRow | null {
  if (!row.decision_id) return null;
  return {
    id: row.decision_id,
    client_decision_id: row.client_decision_id,
    approval_request_id: row.id,
    request_state_fingerprint: row.state_fingerprint,
    decision: row.decision,
    decision_reason:
      row.decision === "APPROVED" ? "checker_approved_snapshot" : "checker_rejected_snapshot",
    decided_by: row.decided_by,
    created_at: row.decision_created_at,
    inserted: false,
  };
}

export async function decideShipmentApvFailureAlertApprovalRequest(
  db: Pick<Database, "execute">,
  input: {
    approvalRequestId: string;
    clientDecisionId: string;
    decidedBy: string;
    decision: ShipmentApvFailureAlertDecision;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_approval_decisions
    WHERE client_decision_id = ${input.clientDecisionId}::uuid
    LIMIT 1`);
  const existing = (existingRows as unknown as DecisionRow[])[0];
  if (existing) {
    if (!decisionMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_DECISION_REPLAY_CONFLICT");
    }
    return publicDecision(existing);
  }

  const requestRows = await db.execute(sql`SELECT request.id, request.state_fingerprint,
      request.requested_by, request.expires_at, decision.id AS decision_id,
      decision.client_decision_id, decision.decision, decision.decided_by,
      decision.created_at AS decision_created_at
    FROM shipment_apv_failure_alert_approval_requests request
    LEFT JOIN shipment_apv_failure_alert_approval_decisions decision
      ON decision.approval_request_id = request.id
    WHERE request.id = ${input.approvalRequestId}::uuid
    LIMIT 1`);
  const request = (requestRows as unknown as RequestRow[])[0];
  if (!request) throw new Error("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_NOT_FOUND");
  if (String(request.requested_by) === input.decidedBy) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_MAKER_CHECKER_REQUIRED");
  }
  const priorDecision = existingDecisionFromRequest(request);
  if (priorDecision) {
    if (decisionMatches(priorDecision, input)) return publicDecision(priorDecision);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_ALREADY_DECIDED");
  }
  if (Date.parse(String(request.expires_at)) <= now.getTime()) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_EXPIRED");
  }

  if (input.decision === "APPROVED") {
    const preview = await getShipmentApvChaosFailureAlertPreview(db, now);
    if (
      preview.action === "none" ||
      !preview.approval.required ||
      preview.stateFingerprint !== String(request.state_fingerprint)
    ) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
    }
  }

  const reason =
    input.decision === "APPROVED" ? "checker_approved_snapshot" : "checker_rejected_snapshot";
  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_failure_alert_approval_decisions
        (client_decision_id, approval_request_id, request_state_fingerprint,
          decision, decision_reason, decided_by, created_at)
      SELECT ${input.clientDecisionId}::uuid, request.id, request.state_fingerprint,
        ${input.decision}, ${reason}, ${input.decidedBy}::uuid, ${now.toISOString()}::timestamptz
      FROM shipment_apv_failure_alert_approval_requests request
      WHERE request.id = ${input.approvalRequestId}::uuid
        AND request.requested_by <> ${input.decidedBy}::uuid
        AND request.expires_at > ${now.toISOString()}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM shipment_apv_failure_alert_approval_decisions existing
          WHERE existing.approval_request_id = request.id)
      ON CONFLICT DO NOTHING
      RETURNING *, true AS inserted
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT existing.*, false AS inserted
    FROM shipment_apv_failure_alert_approval_decisions existing
    WHERE (existing.client_decision_id = ${input.clientDecisionId}::uuid
      OR existing.approval_request_id = ${input.approvalRequestId}::uuid)
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1`);
  const row = (rows as unknown as DecisionRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_DECISION_UNAVAILABLE");
  if (!decisionMatches(row, input)) {
    if (String(row.approval_request_id) === input.approvalRequestId) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_ALREADY_DECIDED");
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_DECISION_REPLAY_CONFLICT");
  }
  return publicDecision(row);
}
