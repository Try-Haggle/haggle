-- Repair older HIL deployments where conversation_market_signals existed
-- before signal_key was added. CREATE TABLE IF NOT EXISTS in 0021 cannot
-- add missing columns to an already-existing table.

ALTER TABLE "conversation_market_signals"
  ADD COLUMN IF NOT EXISTS "signal_key" text;

UPDATE "conversation_market_signals"
SET "signal_key" = 'legacy:' || "id"::text
WHERE "signal_key" IS NULL OR "signal_key" = '';

ALTER TABLE "conversation_market_signals"
  ALTER COLUMN "signal_key" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "conversation_market_signals_signal_key_idx"
  ON "conversation_market_signals" ("signal_key");
