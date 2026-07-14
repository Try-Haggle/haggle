ALTER TABLE "shipment_apv_adjustment_revisions"
  ADD COLUMN IF NOT EXISTS "evidence_sha256" text,
  ADD COLUMN IF NOT EXISTS "provider_document_id" text,
  ADD COLUMN IF NOT EXISTS "surcharge_category" text,
  ADD COLUMN IF NOT EXISTS "surcharge_type" text,
  ADD COLUMN IF NOT EXISTS "evidence_amount_minor" numeric(18, 0),
  ADD COLUMN IF NOT EXISTS "evidence_currency" text,
  ADD COLUMN IF NOT EXISTS "evidence_bound_by" uuid,
  ADD COLUMN IF NOT EXISTS "evidence_bound_at" timestamp with time zone;

ALTER TABLE "shipment_apv_adjustment_revisions"
  ADD CONSTRAINT "shipment_apv_revision_evidence_sha_check"
    CHECK ("evidence_sha256" IS NULL OR "evidence_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "shipment_apv_revision_evidence_amount_check"
    CHECK ("evidence_amount_minor" IS NULL OR "evidence_amount_minor" >= 0),
  ADD CONSTRAINT "shipment_apv_revision_evidence_complete_check"
    CHECK (
      ("evidence_sha256" IS NULL AND "provider_document_id" IS NULL AND "surcharge_category" IS NULL
       AND "surcharge_type" IS NULL AND "evidence_amount_minor" IS NULL AND "evidence_currency" IS NULL
       AND "evidence_bound_by" IS NULL AND "evidence_bound_at" IS NULL)
      OR
      ("evidence_sha256" IS NOT NULL AND "provider_document_id" IS NOT NULL AND "surcharge_category" IS NOT NULL
       AND "surcharge_type" IS NOT NULL AND "evidence_amount_minor" IS NOT NULL AND "evidence_currency" IS NOT NULL
       AND "evidence_bound_by" IS NOT NULL AND "evidence_bound_at" IS NOT NULL)
    );

CREATE TABLE IF NOT EXISTS "shipment_apv_payout_offsets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "settlement_release_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "currency" text DEFAULT 'USDC' NOT NULL,
  "seller_liability_minor" numeric(18, 0) NOT NULL,
  "applied_offset_minor" numeric(18, 0) NOT NULL,
  "unapplied_liability_minor" numeric(18, 0) NOT NULL,
  "evidence_manifest_sha256" text NOT NULL,
  "request_id" text NOT NULL,
  "status" text DEFAULT 'RESERVED' NOT NULL,
  "release_tx_hash" text,
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_apv_payout_status_check" CHECK ("status" IN ('RESERVED', 'APPLIED')),
  CONSTRAINT "shipment_apv_payout_nonnegative_check" CHECK (
    "seller_liability_minor" >= 0 AND "applied_offset_minor" >= 0 AND "unapplied_liability_minor" >= 0
  ),
  CONSTRAINT "shipment_apv_payout_balance_check" CHECK (
    "applied_offset_minor" + "unapplied_liability_minor" = "seller_liability_minor"
  ),
  CONSTRAINT "shipment_apv_payout_manifest_check" CHECK ("evidence_manifest_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_offset_release_unique"
  ON "shipment_apv_payout_offsets" ("settlement_release_id");
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_offset_request_unique"
  ON "shipment_apv_payout_offsets" ("request_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_payout_offset_order_idx"
  ON "shipment_apv_payout_offsets" ("order_id", "status");
