CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_payload_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_signature_id" uuid NOT NULL UNIQUE,
  "payload_outbox_id" uuid NOT NULL UNIQUE
    REFERENCES "shipment_apv_failure_alert_payload_outbox"("id"),
  "payload_sha256" varchar(64) NOT NULL,
  "signing_domain" text NOT NULL,
  "algorithm" text NOT NULL,
  "key_id" varchar(24) NOT NULL,
  "public_key_spki_base64" text NOT NULL,
  "signature_base64" text NOT NULL,
  "status" text NOT NULL,
  "signed_by" uuid NOT NULL,
  "signed_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_signature_payload_sha_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "shipment_apv_failure_alert_signature_domain_check"
    CHECK ("signing_domain" = 'haggle.shipment-apv-failure-alert.payload-sha256.v1'),
  CONSTRAINT "shipment_apv_failure_alert_signature_algorithm_check"
    CHECK ("algorithm" = 'Ed25519'),
  CONSTRAINT "shipment_apv_failure_alert_signature_key_id_check"
    CHECK ("key_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "shipment_apv_failure_alert_signature_public_key_check"
    CHECK ("public_key_spki_base64" ~ '^[A-Za-z0-9+/]{59}=$'),
  CONSTRAINT "shipment_apv_failure_alert_signature_value_check"
    CHECK ("signature_base64" ~ '^[A-Za-z0-9+/]{86}==$'),
  CONSTRAINT "shipment_apv_failure_alert_signature_status_check"
    CHECK ("status" = 'SIGNED_DRY_RUN')
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_payload_signatures_signed_idx"
  ON "shipment_apv_failure_alert_payload_signatures" ("signed_at");
