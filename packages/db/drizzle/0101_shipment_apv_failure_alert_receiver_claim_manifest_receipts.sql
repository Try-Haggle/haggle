CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_receiver_claim_manifest_receipts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "revision" integer NOT NULL UNIQUE,
  "manifest_digest" varchar(64) NOT NULL UNIQUE,
  "previous_manifest_digest" varchar(64),
  "entry_count" integer NOT NULL,
  "receipt_digests" text[] NOT NULL,
  "status" text NOT NULL,
  "health_status" text NOT NULL,
  "contains_raw_identifiers" boolean NOT NULL DEFAULT false,
  "external_archive" boolean NOT NULL DEFAULT false,
  "network_delivered" boolean NOT NULL DEFAULT false,
  "production_accepted" boolean NOT NULL DEFAULT false,
  "generated_at" timestamptz NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "shipment_apv_failure_alert_receiver_manifest_revision_check"
    CHECK ("revision" >= 1),
  CONSTRAINT "shipment_apv_failure_alert_receiver_manifest_digest_check"
    CHECK ("manifest_digest" ~ '^[0-9a-f]{64}$'
      AND ("previous_manifest_digest" IS NULL
        OR "previous_manifest_digest" ~ '^[0-9a-f]{64}$')),
  CONSTRAINT "shipment_apv_failure_alert_receiver_manifest_entries_check"
    CHECK ("entry_count" >= 0 AND "entry_count" <= 1000
      AND cardinality("receipt_digests") = "entry_count"),
  CONSTRAINT "shipment_apv_failure_alert_receiver_manifest_status_check"
    CHECK ("status" = 'PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN'
      AND "health_status" = 'healthy'),
  CONSTRAINT "shipment_apv_failure_alert_receiver_manifest_no_side_effect_check"
    CHECK ("contains_raw_identifiers" = false
      AND "external_archive" = false
      AND "network_delivered" = false
      AND "production_accepted" = false)
);

CREATE INDEX IF NOT EXISTS "shipment_apv_failure_alert_receiver_manifest_recorded_idx"
  ON "shipment_apv_failure_alert_receiver_claim_manifest_receipts" ("recorded_at");
