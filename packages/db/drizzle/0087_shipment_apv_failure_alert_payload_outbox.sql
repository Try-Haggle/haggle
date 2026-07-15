CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_payload_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_outbox_id" uuid NOT NULL UNIQUE,
  "delivery_grant_id" uuid NOT NULL UNIQUE
    REFERENCES "shipment_apv_failure_alert_delivery_grants"("id"),
  "state_fingerprint" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "status" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_payload_fingerprint_check"
    CHECK ("state_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_payload_sha_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_payload_status_check"
    CHECK ("status" = 'UNSIGNED_DRY_RUN')
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_payload_outbox_created_idx"
  ON "shipment_apv_failure_alert_payload_outbox" ("created_at");
