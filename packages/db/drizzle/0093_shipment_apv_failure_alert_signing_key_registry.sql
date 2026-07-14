CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_signing_keys" (
  "key_id" varchar(24) PRIMARY KEY,
  "algorithm" text NOT NULL,
  "public_key_spki_base64" text NOT NULL UNIQUE,
  "registered_by" uuid NOT NULL,
  "registered_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_signing_key_id_check"
    CHECK ("key_id" ~ '^[0-9a-f]{24}$'),
  CONSTRAINT "shipment_apv_failure_alert_signing_key_algorithm_check"
    CHECK ("algorithm" = 'Ed25519'),
  CONSTRAINT "shipment_apv_failure_alert_signing_key_public_check"
    CHECK ("public_key_spki_base64" ~ '^[A-Za-z0-9+/]{59}=$')
);

CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_signing_key_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_event_id" uuid NOT NULL UNIQUE,
  "key_id" varchar(24) NOT NULL
    REFERENCES "shipment_apv_failure_alert_signing_keys"("key_id"),
  "event_type" text NOT NULL,
  "reason" text NOT NULL,
  "changed_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_failure_alert_signing_key_event_type_check"
    CHECK ("event_type" IN ('REGISTERED', 'RETIRED', 'REVOKED')),
  CONSTRAINT "shipment_apv_failure_alert_signing_key_event_reason_check"
    CHECK ("reason" IN ('ephemeral_test_key_registered',
      'ephemeral_test_key_retired', 'ephemeral_test_key_revoked')),
  CONSTRAINT "shipment_apv_failure_alert_signing_key_event_once"
    UNIQUE ("key_id", "event_type")
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_signing_key_events_order_idx"
  ON "shipment_apv_failure_alert_signing_key_events" ("key_id", "created_at", "id");
