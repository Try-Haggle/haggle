ALTER TABLE "shipment_apv_adjustments"
  ADD COLUMN IF NOT EXISTS "assessed_seller_liability_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "platform_liability_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "review_status" text DEFAULT 'NONE' NOT NULL,
  ADD COLUMN IF NOT EXISTS "review_request_id" text,
  ADD COLUMN IF NOT EXISTS "seller_review_reason" text,
  ADD COLUMN IF NOT EXISTS "seller_review_submitted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reviewed_by" uuid,
  ADD COLUMN IF NOT EXISTS "review_decision_reason" text,
  ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "review_version" integer DEFAULT 0 NOT NULL;

UPDATE "shipment_apv_adjustments"
   SET "assessed_seller_liability_minor" = "seller_liability_minor"
 WHERE "assessed_seller_liability_minor" = 0
   AND "seller_liability_minor" > 0;

ALTER TABLE "shipment_apv_adjustments"
  ADD CONSTRAINT "shipment_apv_review_status_check"
  CHECK ("review_status" IN ('NONE', 'PENDING', 'UPHELD', 'WAIVED')),
  ADD CONSTRAINT "shipment_apv_review_accounting_check"
  CHECK (
    "assessed_seller_liability_minor" >= 0
    AND "platform_liability_minor" >= 0
    AND "seller_liability_minor" >= 0
    AND "seller_liability_minor" + "platform_liability_minor" = "assessed_seller_liability_minor"
  );

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_review_request_unique"
  ON "shipment_apv_adjustments" ("review_request_id")
  WHERE "review_request_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "shipment_apv_review_status_idx"
  ON "shipment_apv_adjustments" ("review_status", "seller_review_submitted_at");
