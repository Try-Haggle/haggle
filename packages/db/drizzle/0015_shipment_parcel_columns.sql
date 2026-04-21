-- Step 84: Add parcel dimension columns to shipments table
-- These columns store the seller-provided package dimensions for rate shopping
-- and label purchase. Also adds selected_rate_id to track which rate was chosen.

ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "parcel_length_in" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "parcel_width_in" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "parcel_height_in" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "parcel_weight_oz" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "selected_rate_id" text;
