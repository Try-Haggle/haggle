CREATE TABLE IF NOT EXISTS
  "shipment_apv_manifest_archive_alert_receiver_claims" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "delivery_id" varchar(64) NOT NULL UNIQUE,
    "delivery_intent_id" uuid NOT NULL UNIQUE REFERENCES
      "shipment_apv_manifest_archive_alert_delivery_intents" ("id"),
    "payload_signature_id" uuid NOT NULL REFERENCES
      "shipment_apv_manifest_archive_alert_payload_signatures" ("id"),
    "payload_outbox_id" uuid NOT NULL REFERENCES
      "shipment_apv_manifest_archive_alert_payload_outbox" ("id"),
    "payload_sha256" varchar(64) NOT NULL,
    "key_id" varchar(24) NOT NULL REFERENCES
      "shipment_apv_failure_alert_signing_keys" ("key_id"),
    "status" text NOT NULL,
    "network_received" boolean NOT NULL DEFAULT false,
    "external_receipt_verified" boolean NOT NULL DEFAULT false,
    "production_accepted" boolean NOT NULL DEFAULT false,
    "delivery_attempted" boolean NOT NULL DEFAULT false,
    "received_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "ship_apv_archive_alert_receiver_claim_delivery_id_check"
      CHECK ("delivery_id" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ship_apv_archive_alert_receiver_claim_sha_check"
      CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "ship_apv_archive_alert_receiver_claim_key_check"
      CHECK ("key_id" ~ '^[0-9a-f]{24}$'),
    CONSTRAINT "ship_apv_archive_alert_receiver_claim_status_check"
      CHECK ("status" =
        'VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN'),
    CONSTRAINT "ship_apv_archive_alert_receiver_claim_no_side_effect_check"
      CHECK ("network_received" = false
        AND "external_receipt_verified" = false
        AND "production_accepted" = false
        AND "delivery_attempted" = false)
  );

CREATE INDEX IF NOT EXISTS "ship_apv_archive_alert_receiver_claim_received_idx"
  ON "shipment_apv_manifest_archive_alert_receiver_claims" ("received_at");
