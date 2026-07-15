CREATE TABLE IF NOT EXISTS "shipment_apv_failure_alert_receiver_manifest_archive_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_archive_intent_id" uuid NOT NULL UNIQUE,
  "manifest_receipt_id" uuid NOT NULL UNIQUE REFERENCES
    "shipment_apv_failure_alert_receiver_claim_manifest_receipts"("id"),
  "manifest_revision" integer NOT NULL,
  "manifest_digest" varchar(64) NOT NULL,
  "status" text NOT NULL,
  "blocking_reasons" text[] NOT NULL,
  "http_request_created" boolean NOT NULL DEFAULT false,
  "delivery_attempted" boolean NOT NULL DEFAULT false,
  "external_receipt_verified" boolean NOT NULL DEFAULT false,
  "production_accepted" boolean NOT NULL DEFAULT false,
  "requested_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT "ship_apv_receiver_manifest_archive_revision_ck"
    CHECK ("manifest_revision" >= 1),
  CONSTRAINT "ship_apv_receiver_manifest_archive_digest_ck"
    CHECK ("manifest_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ship_apv_receiver_manifest_archive_status_ck"
    CHECK ("status" = 'BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN'),
  CONSTRAINT "ship_apv_receiver_manifest_archive_side_effect_ck"
    CHECK ("http_request_created" = false
      AND "delivery_attempted" = false
      AND "external_receipt_verified" = false
      AND "production_accepted" = false)
);

CREATE INDEX IF NOT EXISTS "ship_apv_receiver_manifest_archive_created_idx"
  ON "shipment_apv_failure_alert_receiver_manifest_archive_intents" ("created_at");
