ALTER TABLE "shipment_apv_adjustments"
  ADD COLUMN IF NOT EXISTS "review_decision_request_id" text;

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_review_decision_request_unique"
  ON "shipment_apv_adjustments" ("review_decision_request_id")
  WHERE "review_decision_request_id" IS NOT NULL;
