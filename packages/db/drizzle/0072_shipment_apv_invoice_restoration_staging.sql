ALTER TABLE "shipment_apv_invoice_restoration_requests"
  ADD COLUMN IF NOT EXISTS "staging_status" text NOT NULL DEFAULT 'STAGED',
  ADD COLUMN IF NOT EXISTS "staging_disposed_at" timestamptz;

ALTER TABLE "shipment_apv_invoice_restoration_requests"
  ADD CONSTRAINT "shipment_apv_invoice_restore_staging_status_check"
  CHECK ("staging_status" IN ('STAGED', 'MOVING', 'MOVED', 'CONSUMED'));

ALTER TABLE "shipment_apv_invoice_restoration_events"
  DROP CONSTRAINT "shipment_apv_invoice_restore_event_type_check";
ALTER TABLE "shipment_apv_invoice_restoration_events"
  ADD CONSTRAINT "shipment_apv_invoice_restore_event_type_check"
  CHECK ("event_type" IN (
    'REQUESTED', 'APPLYING', 'RESTORED', 'PRESERVED', 'REJECTED', 'EXPIRED', 'STAGING_PRESERVED'
  ));

CREATE INDEX IF NOT EXISTS "shipment_apv_invoice_restore_staging_maintenance_idx"
  ON "shipment_apv_invoice_restoration_requests" ("staging_status", "status", "expires_at", "created_at");
