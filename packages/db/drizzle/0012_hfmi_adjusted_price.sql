-- Add adjusted_price_usd column to hfmi_price_observations.
-- This stores the fee-normalized price: what the seller actually receives
-- on the Haggle platform (1.5% fee) equivalent.
--
-- observed_price_usd = raw platform price (eBay listing, BackMarket, etc.)
-- adjusted_price_usd = fee-normalized to Haggle's fee structure
--
-- Formula: adjusted = observed × (1 - source_fee) / (1 - haggle_fee)
-- Example: eBay $596 → $596 × 0.87 / 0.985 = $526.70

ALTER TABLE "hfmi_price_observations"
  ADD COLUMN IF NOT EXISTS "adjusted_price_usd" numeric(10, 2);

-- Backfill existing rows with fee adjustment
-- Verified rates (2026-04):
--   eBay: 13.25% FVF (Cell Phones, Computers, Gaming — non-store ≤$7500)
--   BackMarket: 10% flat
--   Swappa: ~6.5% (3% + PayPal 3.49%)
--   Gazelle: ~20% buyback discount
--   Haggle: 1.5%

-- ebay_sold/ebay_browse: 13.25% fee
UPDATE "hfmi_price_observations"
  SET "adjusted_price_usd" = ROUND("observed_price_usd" * 0.8675 / 0.985, 2)
  WHERE source IN ('ebay_sold', 'ebay_browse')
    AND "adjusted_price_usd" IS NULL;

-- terapeak_manual/marketplace_insights: eBay-sourced data (13.25%)
UPDATE "hfmi_price_observations"
  SET "adjusted_price_usd" = ROUND("observed_price_usd" * 0.8675 / 0.985, 2)
  WHERE source IN ('terapeak_manual', 'marketplace_insights')
    AND "adjusted_price_usd" IS NULL;

-- backmarket: 10% fee
UPDATE "hfmi_price_observations"
  SET "adjusted_price_usd" = ROUND("observed_price_usd" * 0.90 / 0.985, 2)
  WHERE source = 'backmarket'
    AND "adjusted_price_usd" IS NULL;

-- gazelle: ~20% buyback discount
UPDATE "hfmi_price_observations"
  SET "adjusted_price_usd" = ROUND("observed_price_usd" * 0.80 / 0.985, 2)
  WHERE source = 'gazelle'
    AND "adjusted_price_usd" IS NULL;

-- haggle_internal: no adjustment (already at Haggle fee structure)
UPDATE "hfmi_price_observations"
  SET "adjusted_price_usd" = "observed_price_usd"
  WHERE source = 'haggle_internal'
    AND "adjusted_price_usd" IS NULL;
