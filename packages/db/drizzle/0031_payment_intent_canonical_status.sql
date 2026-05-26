ALTER TABLE "payment_intents"
  ADD COLUMN IF NOT EXISTS "canonical_status" text NOT NULL DEFAULT 'pending';

UPDATE "payment_intents"
SET "canonical_status" = CASE "status"
  WHEN 'CREATED' THEN 'pending'
  WHEN 'QUOTED' THEN 'pending'
  WHEN 'AUTHORIZED' THEN 'authorized'
  WHEN 'SETTLEMENT_PENDING' THEN 'authorized'
  WHEN 'SETTLED' THEN 'captured'
  WHEN 'FAILED' THEN 'failed'
  WHEN 'CANCELED' THEN 'canceled'
  ELSE 'pending'
END
WHERE "canonical_status" = 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_payment_intents_canonical_status'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "chk_payment_intents_canonical_status"
      CHECK ("canonical_status" IN (
        'pending',
        'authorized',
        'captured',
        'canceled',
        'refunded',
        'partially_refunded',
        'failed',
        'disputed',
        'expired'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_payment_intents_status_compat'
  ) THEN
    ALTER TABLE "payment_intents"
      ADD CONSTRAINT "chk_payment_intents_status_compat"
      CHECK (
        ("status" IN ('CREATED', 'QUOTED') AND "canonical_status" IN ('pending', 'expired'))
        OR ("status" IN ('AUTHORIZED', 'SETTLEMENT_PENDING') AND "canonical_status" IN ('authorized', 'expired'))
        OR ("status" = 'SETTLED' AND "canonical_status" IN ('captured', 'partially_refunded', 'refunded', 'disputed'))
        OR ("status" = 'FAILED' AND "canonical_status" = 'failed')
        OR ("status" = 'CANCELED' AND "canonical_status" IN ('canceled', 'expired'))
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_payment_intents_canonical_status"
  ON "payment_intents" ("canonical_status");

CREATE INDEX IF NOT EXISTS "idx_payment_intents_order_canonical_status"
  ON "payment_intents" ("order_id", "canonical_status");
