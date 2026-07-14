CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_cooldown_claims" (
  "state_fingerprint" varchar(64) PRIMARY KEY,
  "grant_id" uuid NOT NULL UNIQUE,
  "claimed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_cooldown_fingerprint_check"
    CHECK ("state_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_cooldown_window_check"
    CHECK ("expires_at" = "claimed_at" + interval '15 minutes')
);

CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_delivery_grants" (
  "id" uuid PRIMARY KEY,
  "client_grant_id" uuid NOT NULL UNIQUE,
  "approval_decision_id" uuid NOT NULL UNIQUE
    REFERENCES "shipment_apv_failure_alert_approval_decisions"("id"),
  "state_fingerprint" varchar(64) NOT NULL,
  "status" text NOT NULL,
  "granted_by" uuid NOT NULL,
  "granted_at" timestamptz NOT NULL,
  "cooldown_expires_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_grant_fingerprint_check"
    CHECK ("state_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_grant_status_check"
    CHECK ("status" = 'GRANTED_DRY_RUN'),
  CONSTRAINT "shipment_apv_failure_alert_grant_window_check"
    CHECK ("cooldown_expires_at" = "granted_at" + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_delivery_grants_created_idx"
  ON "shipment_apv_failure_alert_delivery_grants" ("granted_at");
