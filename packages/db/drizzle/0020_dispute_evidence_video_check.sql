ALTER TABLE "dispute_evidence"
  DROP CONSTRAINT IF EXISTS "chk_dispute_evidence_type";

ALTER TABLE "dispute_evidence"
  ADD CONSTRAINT "chk_dispute_evidence_type" CHECK (
    "type" IN ('text','image','video','tracking_snapshot','payment_proof','other')
  );

CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_settlements_payment_intent_id"
  ON "payment_settlements" ("payment_intent_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_settlement_releases_order_id"
  ON "settlement_releases" ("order_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_payment_intents_order_id"
  ON "payment_intents" ("order_id")
  WHERE "status" NOT IN ('FAILED','CANCELED');

CREATE UNIQUE INDEX IF NOT EXISTS "uq_outbound_shipments_order_id"
  ON "shipments" ("order_id")
  WHERE "shipment_type" = 'outbound';
