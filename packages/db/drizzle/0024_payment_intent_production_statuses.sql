-- Step 84: Expand payment_intents status model for production refund/dispute/expiry states.
--
-- Existing rows use text values guarded by chk_payment_intents_status. This
-- migration widens the guard only; it does not rewrite production data.

ALTER TABLE "payment_intents"
  DROP CONSTRAINT IF EXISTS "chk_payment_intents_status";

ALTER TABLE "payment_intents"
  ADD CONSTRAINT "chk_payment_intents_status" CHECK (
    "status" IN (
      'CREATED',
      'QUOTED',
      'AUTHORIZED',
      'SETTLEMENT_PENDING',
      'SETTLED',
      'REFUNDED',
      'PARTIALLY_REFUNDED',
      'DISPUTED',
      'FAILED',
      'CANCELED',
      'EXPIRED'
    )
  );
