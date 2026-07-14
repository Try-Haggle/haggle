CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_request_id" uuid NOT NULL UNIQUE,
  "state_fingerprint" varchar(64) NOT NULL,
  "preview_action" text NOT NULL,
  "preview_severity" text NOT NULL,
  "preview_reasons" text[] NOT NULL,
  "requested_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_request_fingerprint_check"
    CHECK ("state_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_request_action_check"
    CHECK ("preview_action" IN ('review_warning', 'escalate_critical', 'review_recovery')),
  CONSTRAINT "shipment_apv_failure_alert_request_severity_check"
    CHECK ("preview_severity" IN ('warning', 'critical')),
  CONSTRAINT "shipment_apv_failure_alert_request_reasons_check"
    CHECK (
      cardinality("preview_reasons") BETWEEN 1 AND 3
      AND "preview_reasons" <@ ARRAY[
        'rollback_verification_warning', 'rollback_verification_critical',
        'rollback_failure_isolation_warning', 'rollback_failure_isolation_critical',
        'fixture_execution_warning', 'fixture_execution_critical',
        'recovered_from_warning', 'recovered_from_critical'
      ]::text[]
    ),
  CONSTRAINT "shipment_apv_failure_alert_request_expiry_check"
    CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_approval_requests_expiry_idx"
  ON "shipment_apv_failure_alert_approval_requests" ("expires_at");
