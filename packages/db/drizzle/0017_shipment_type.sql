ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "shipment_type" text NOT NULL DEFAULT 'outbound';
