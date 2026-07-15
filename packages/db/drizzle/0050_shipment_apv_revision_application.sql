ALTER TABLE "shipment_apv_adjustment_revisions"
  ADD COLUMN IF NOT EXISTS "decision_request_id" text,
  ADD COLUMN IF NOT EXISTS "decision" text,
  ADD COLUMN IF NOT EXISTS "buffer_applied_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "seller_liability_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "platform_liability_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "carrier_credit_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  ADD COLUMN IF NOT EXISTS "applied_by" uuid,
  ADD COLUMN IF NOT EXISTS "decision_reason" text,
  ADD COLUMN IF NOT EXISTS "applied_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "apply_version" integer DEFAULT 0 NOT NULL;

UPDATE "shipment_apv_adjustment_revisions" AS revision
   SET "buffer_applied_minor" = adjustment."buffer_applied_minor",
       "seller_liability_minor" = adjustment."seller_liability_minor",
       "platform_liability_minor" = adjustment."platform_liability_minor",
       "carrier_credit_minor" = adjustment."carrier_credit_minor",
       "apply_version" = 1,
       "applied_at" = COALESCE(adjustment."processed_at", adjustment."created_at")
  FROM "shipment_apv_adjustments" AS adjustment
 WHERE revision."adjustment_id" = adjustment."id"
   AND revision."revision_number" = 1;

ALTER TABLE "shipment_apv_adjustment_revisions"
  DROP CONSTRAINT IF EXISTS "shipment_apv_revision_status_check";
ALTER TABLE "shipment_apv_adjustment_revisions"
  ADD CONSTRAINT "shipment_apv_revision_status_check"
    CHECK ("status" IN ('APPLIED', 'REVIEW_REQUIRED', 'CREDIT_RECORDED', 'PENDING_REVIEW', 'WAIVED_TO_PLATFORM', 'CREDIT_APPLIED', 'ACKNOWLEDGED')),
  ADD CONSTRAINT "shipment_apv_revision_decision_check"
    CHECK ("decision" IS NULL OR "decision" IN ('UPHELD', 'WAIVED', 'APPLY_CREDIT', 'ACKNOWLEDGE')),
  ADD CONSTRAINT "shipment_apv_revision_nonnegative_allocation_check"
    CHECK (
      "buffer_applied_minor" >= 0 AND "seller_liability_minor" >= 0
      AND "platform_liability_minor" >= 0 AND "carrier_credit_minor" >= 0
    ),
  ADD CONSTRAINT "shipment_apv_revision_application_balance_check"
    CHECK (
      "status" IN ('PENDING_REVIEW', 'REVIEW_REQUIRED')
      OR ("delta_minor" > 0 AND "buffer_applied_minor" + "seller_liability_minor" + "platform_liability_minor" = "delta_minor" AND "carrier_credit_minor" = 0)
      OR ("delta_minor" < 0 AND "carrier_credit_minor" = -"delta_minor" AND "buffer_applied_minor" = 0 AND "seller_liability_minor" = 0 AND "platform_liability_minor" = 0)
      OR ("delta_minor" = 0 AND "buffer_applied_minor" = 0 AND "seller_liability_minor" = 0 AND "platform_liability_minor" = 0 AND "carrier_credit_minor" = 0)
    );

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_revision_decision_request_unique"
  ON "shipment_apv_adjustment_revisions" ("decision_request_id")
  WHERE "decision_request_id" IS NOT NULL;
