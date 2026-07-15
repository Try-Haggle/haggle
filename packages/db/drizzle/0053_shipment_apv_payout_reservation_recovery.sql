ALTER TABLE "shipment_apv_payout_offsets"
  ADD COLUMN IF NOT EXISTS "signature_deadline" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "reservation_expires_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancelled_by" text,
  ADD COLUMN IF NOT EXISTS "cancellation_reason" text;

UPDATE "shipment_apv_payout_offsets"
   SET "reservation_expires_at" = COALESCE("reservation_expires_at", "created_at" + interval '15 minutes');
ALTER TABLE "shipment_apv_payout_offsets"
  ALTER COLUMN "reservation_expires_at" SET NOT NULL;

ALTER TABLE "shipment_apv_payout_offsets" DROP CONSTRAINT IF EXISTS "shipment_apv_payout_status_check";
ALTER TABLE "shipment_apv_payout_offsets"
  ADD CONSTRAINT "shipment_apv_payout_status_check" CHECK ("status" IN ('RESERVED', 'APPLIED', 'CANCELLED'));
ALTER TABLE "shipment_apv_payout_offsets"
  ADD CONSTRAINT "shipment_apv_payout_cancel_fields_check" CHECK (
    ("status" <> 'CANCELLED') OR
    ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL AND "cancellation_reason" IS NOT NULL)
  );

DROP INDEX IF EXISTS "shipment_apv_payout_offset_release_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_offset_active_release_unique"
  ON "shipment_apv_payout_offsets" ("settlement_release_id")
  WHERE "status" IN ('RESERVED', 'APPLIED');

ALTER TABLE "shipment_apv_payout_offset_allocations"
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone;
ALTER TABLE "shipment_apv_payout_offset_allocations"
  DROP CONSTRAINT IF EXISTS "shipment_apv_payout_allocation_status_check";
ALTER TABLE "shipment_apv_payout_offset_allocations"
  ADD CONSTRAINT "shipment_apv_payout_allocation_status_check"
  CHECK ("status" IN ('RESERVED', 'APPLIED', 'CANCELLED'));
