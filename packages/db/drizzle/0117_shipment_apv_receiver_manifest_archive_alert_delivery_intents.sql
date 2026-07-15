CREATE TABLE IF NOT EXISTS "shipment_apv_manifest_archive_alert_delivery_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_delivery_intent_id" uuid NOT NULL UNIQUE,
  "payload_signature_id" uuid NOT NULL UNIQUE REFERENCES
    "shipment_apv_manifest_archive_alert_payload_signatures" ("id"),
  "payload_outbox_id" uuid NOT NULL REFERENCES
    "shipment_apv_manifest_archive_alert_payload_outbox" ("id"),
  "payload_sha256" varchar(64) NOT NULL,
  "key_id" varchar(24) NOT NULL REFERENCES
    "shipment_apv_failure_alert_signing_keys" ("key_id"),
  "status" text NOT NULL,
  "blocking_reasons" text[] NOT NULL,
  "http_request_created" boolean NOT NULL DEFAULT false,
  "delivery_attempted" boolean NOT NULL DEFAULT false,
  "requested_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "ship_apv_archive_alert_intent_payload_sha_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ship_apv_archive_alert_intent_key_id_check"
    CHECK ("key_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "ship_apv_archive_alert_intent_status_check"
    CHECK ("status" = 'BLOCKED_CONFIGURATION_DRY_RUN'),
  CONSTRAINT "ship_apv_archive_alert_intent_reasons_check"
    CHECK ("blocking_reasons" = ARRAY[
      'independent_trust_anchor_missing',
      'receiver_endpoint_missing',
      'receiver_credential_missing'
    ]::text[]),
  CONSTRAINT "ship_apv_archive_alert_intent_no_http_check"
    CHECK ("http_request_created" = false AND "delivery_attempted" = false)
);

CREATE INDEX IF NOT EXISTS "ship_apv_archive_alert_intent_created_idx"
  ON "shipment_apv_manifest_archive_alert_delivery_intents" ("created_at");
