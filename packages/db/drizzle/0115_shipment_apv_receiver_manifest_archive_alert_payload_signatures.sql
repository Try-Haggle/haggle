CREATE TABLE IF NOT EXISTS "shipment_apv_manifest_archive_alert_payload_signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_signature_id" uuid NOT NULL UNIQUE,
  "payload_outbox_id" uuid NOT NULL UNIQUE REFERENCES
    "shipment_apv_manifest_archive_alert_payload_outbox" ("id"),
  "payload_sha256" varchar(64) NOT NULL,
  "signing_domain" text NOT NULL,
  "algorithm" text NOT NULL,
  "key_id" varchar(24) NOT NULL REFERENCES
    "shipment_apv_failure_alert_signing_keys" ("key_id"),
  "public_key_spki_base64" text NOT NULL,
  "signature_base64" text NOT NULL,
  "status" text NOT NULL,
  "signed_by" uuid NOT NULL,
  "signed_at" timestamptz NOT NULL,
  CONSTRAINT "ship_apv_archive_alert_sig_payload_sha_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ship_apv_archive_alert_sig_domain_check"
    CHECK ("signing_domain" =
      'haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1'),
  CONSTRAINT "ship_apv_archive_alert_sig_algorithm_check"
    CHECK ("algorithm" = 'Ed25519'),
  CONSTRAINT "ship_apv_archive_alert_sig_key_id_check"
    CHECK ("key_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "ship_apv_archive_alert_sig_public_key_check"
    CHECK ("public_key_spki_base64" ~ '^[A-Za-z0-9+/]{59}=$'),
  CONSTRAINT "ship_apv_archive_alert_sig_value_check"
    CHECK ("signature_base64" ~ '^[A-Za-z0-9+/]{86}==$'),
  CONSTRAINT "ship_apv_archive_alert_sig_status_check"
    CHECK ("status" = 'SIGNED_DRY_RUN')
);

CREATE INDEX IF NOT EXISTS "ship_apv_archive_alert_sig_signed_idx"
  ON "shipment_apv_manifest_archive_alert_payload_signatures" ("signed_at");
