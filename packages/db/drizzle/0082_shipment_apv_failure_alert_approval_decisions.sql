CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_approval_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_decision_id" uuid NOT NULL UNIQUE,
  "approval_request_id" uuid NOT NULL UNIQUE
    REFERENCES "shipment_apv_failure_alert_approval_requests"("id"),
  "request_state_fingerprint" varchar(64) NOT NULL,
  "decision" text NOT NULL,
  "decision_reason" text NOT NULL,
  "decided_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_decision_fingerprint_check"
    CHECK ("request_state_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_decision_value_check"
    CHECK ("decision" IN ('APPROVED', 'REJECTED')),
  CONSTRAINT "shipment_apv_failure_alert_decision_reason_check"
    CHECK (
      ("decision" = 'APPROVED' AND "decision_reason" = 'checker_approved_snapshot')
      OR ("decision" = 'REJECTED' AND "decision_reason" = 'checker_rejected_snapshot')
    )
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_approval_decisions_created_idx"
  ON "shipment_apv_failure_alert_approval_decisions" ("created_at");
