ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "label_refund_status" text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "label_refund_claim_id" uuid,
  ADD COLUMN IF NOT EXISTS "label_refund_lease_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "label_refund_attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "label_refund_requested_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "label_refund_updated_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "shipments_label_refund_status_lease_idx"
  ON "shipments" ("label_refund_status", "label_refund_lease_expires_at");

ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_label_refund_status_check"
  CHECK ("label_refund_status" IN (
    'NONE', 'REQUESTING', 'SUBMITTED', 'REFUNDED', 'REJECTED', 'NOT_APPLICABLE', 'FAILED'
  ));
