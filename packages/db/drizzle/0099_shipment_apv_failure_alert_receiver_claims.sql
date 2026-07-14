CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_receiver_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "delivery_id" varchar(64) NOT NULL UNIQUE,
  "delivery_intent_id" uuid NOT NULL UNIQUE
    REFERENCES "shipment_apv_failure_alert_delivery_intents"("id"),
  "payload_signature_id" uuid NOT NULL
    REFERENCES "shipment_apv_failure_alert_payload_signatures"("id"),
  "payload_sha256" varchar(64) NOT NULL,
  "key_id" varchar(24) NOT NULL,
  "status" text NOT NULL,
  "network_received" boolean NOT NULL DEFAULT false,
  "production_accepted" boolean NOT NULL DEFAULT false,
  "received_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "shipment_apv_failure_alert_receiver_claim_delivery_id_check"
    CHECK ("delivery_id" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_receiver_claim_sha_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_receiver_claim_key_check"
    CHECK ("key_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "shipment_apv_failure_alert_receiver_claim_status_check"
    CHECK ("status" = 'VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN'),
  CONSTRAINT "shipment_apv_failure_alert_receiver_claim_no_network_check"
    CHECK ("network_received" = false AND "production_accepted" = false)
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_receiver_claims_received_idx"
  ON "shipment_apv_failure_alert_receiver_claims" ("received_at");
