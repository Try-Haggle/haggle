ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "last_carrier_event_at" timestamp with time zone;

ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "last_carrier_event_key" text;

CREATE INDEX IF NOT EXISTS "shipments_tracking_number_idx"
  ON "shipments" ("tracking_number")
  WHERE "tracking_number" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "shipments_carrier_event_watermark_idx"
  ON "shipments" ("last_carrier_event_at")
  WHERE "last_carrier_event_at" IS NOT NULL;
