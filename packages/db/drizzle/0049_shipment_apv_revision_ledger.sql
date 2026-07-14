CREATE TABLE IF NOT EXISTS "shipment_apv_adjustment_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "adjustment_id" uuid NOT NULL REFERENCES "shipment_apv_adjustments"("id") ON DELETE CASCADE,
  "provider" text NOT NULL,
  "provider_invoice_id" text NOT NULL,
  "revision_number" integer NOT NULL,
  "invoice_event" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "webhook_event_id" text NOT NULL,
  "prior_adjusted_rate_minor" numeric(18, 0) NOT NULL,
  "adjusted_rate_minor" numeric(18, 0) NOT NULL,
  "delta_minor" numeric(18, 0) NOT NULL,
  "status" text NOT NULL,
  "buyer_effect_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_apv_revision_event_check" CHECK ("invoice_event" IN ('created', 'updated')),
  CONSTRAINT "shipment_apv_revision_status_check" CHECK ("status" IN ('APPLIED', 'REVIEW_REQUIRED', 'CREDIT_RECORDED', 'PENDING_REVIEW')),
  CONSTRAINT "shipment_apv_revision_number_check" CHECK ("revision_number" > 0),
  CONSTRAINT "shipment_apv_revision_buyer_effect_zero_check" CHECK ("buyer_effect_minor" = 0),
  CONSTRAINT "shipment_apv_revision_delta_check" CHECK ("adjusted_rate_minor" - "prior_adjusted_rate_minor" = "delta_minor")
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_revision_number_unique"
  ON "shipment_apv_adjustment_revisions" ("adjustment_id", "revision_number");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_revision_payload_unique"
  ON "shipment_apv_adjustment_revisions" ("provider", "provider_invoice_id", "payload_sha256");
CREATE INDEX IF NOT EXISTS "shipment_apv_revision_invoice_idx"
  ON "shipment_apv_adjustment_revisions" ("provider", "provider_invoice_id", "revision_number");

INSERT INTO "shipment_apv_adjustment_revisions" (
  "adjustment_id", "provider", "provider_invoice_id", "revision_number", "invoice_event",
  "payload_sha256", "webhook_event_id", "prior_adjusted_rate_minor", "adjusted_rate_minor",
  "delta_minor", "status", "buyer_effect_minor", "metadata", "created_at"
)
SELECT
  "id", "provider", "provider_invoice_id", 1, 'created', "payload_sha256",
  'migration:0049', "original_rate_minor", "adjusted_rate_minor", "adjustment_minor",
  CASE WHEN "status" IN ('APPLIED', 'REVIEW_REQUIRED', 'CREDIT_RECORDED') THEN "status"
       ELSE 'PENDING_REVIEW' END,
  0, jsonb_build_object('backfilled', true), COALESCE("processed_at", "created_at")
FROM "shipment_apv_adjustments"
WHERE "status" <> 'PROCESSING'
ON CONFLICT ("provider", "provider_invoice_id", "payload_sha256") DO NOTHING;
