ALTER TABLE "shipment_apv_payout_cancellation_events"
  ADD COLUMN IF NOT EXISTS "previous_event_hash" text,
  ADD COLUMN IF NOT EXISTS "event_hash" text;

ALTER TABLE "shipment_apv_payout_cancellation_events"
  ADD CONSTRAINT "shipment_apv_payout_cancel_event_previous_hash_check"
    CHECK ("previous_event_hash" IS NULL OR "previous_event_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "shipment_apv_payout_cancel_event_hash_check"
    CHECK ("event_hash" IS NULL OR "event_hash" ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS "shipment_apv_payout_cancel_event_hash_idx"
  ON "shipment_apv_payout_cancellation_events" ("event_hash")
  WHERE "event_hash" IS NOT NULL;
