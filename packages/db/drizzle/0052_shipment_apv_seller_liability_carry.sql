CREATE TABLE IF NOT EXISTS "shipment_apv_seller_liabilities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seller_id" uuid NOT NULL,
  "source_settlement_release_id" uuid NOT NULL,
  "source_order_id" uuid NOT NULL,
  "currency" text DEFAULT 'USDC' NOT NULL,
  "original_amount_minor" numeric(18, 0) NOT NULL,
  "remaining_amount_minor" numeric(18, 0) NOT NULL,
  "evidence_manifest_sha256" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone,
  CONSTRAINT "shipment_apv_seller_liability_status_check" CHECK ("status" IN ('OPEN', 'PARTIAL', 'SETTLED')),
  CONSTRAINT "shipment_apv_seller_liability_amount_check" CHECK (
    "original_amount_minor" >= 0 AND "remaining_amount_minor" >= 0
    AND "remaining_amount_minor" <= "original_amount_minor"
  ),
  CONSTRAINT "shipment_apv_seller_liability_manifest_check" CHECK ("evidence_manifest_sha256" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "shipment_apv_payout_offsets"
  ADD COLUMN IF NOT EXISTS "allocation_version" integer DEFAULT 0 NOT NULL;

ALTER TABLE "shipment_apv_payout_offsets"
  DROP CONSTRAINT IF EXISTS "shipment_apv_payout_offset_allocation_version_check";
ALTER TABLE "shipment_apv_payout_offsets"
  ADD CONSTRAINT "shipment_apv_payout_offset_allocation_version_check"
  CHECK ("allocation_version" IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_seller_liability_source_release_unique"
  ON "shipment_apv_seller_liabilities" ("source_settlement_release_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_seller_liability_queue_idx"
  ON "shipment_apv_seller_liabilities" ("seller_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "shipment_apv_payout_offset_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payout_offset_id" uuid NOT NULL REFERENCES "shipment_apv_payout_offsets"("id") ON DELETE CASCADE,
  "seller_liability_id" uuid NOT NULL REFERENCES "shipment_apv_seller_liabilities"("id") ON DELETE CASCADE,
  "amount_minor" numeric(18, 0) NOT NULL,
  "status" text DEFAULT 'RESERVED' NOT NULL,
  "applied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_apv_payout_allocation_status_check" CHECK ("status" IN ('RESERVED', 'APPLIED')),
  CONSTRAINT "shipment_apv_payout_allocation_amount_check" CHECK ("amount_minor" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_payout_allocation_offset_liability_unique"
  ON "shipment_apv_payout_offset_allocations" ("payout_offset_id", "seller_liability_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_payout_allocation_liability_status_idx"
  ON "shipment_apv_payout_offset_allocations" ("seller_liability_id", "status");

INSERT INTO "shipment_apv_seller_liabilities" (
  "seller_id", "source_settlement_release_id", "source_order_id", "currency",
  "original_amount_minor", "remaining_amount_minor", "evidence_manifest_sha256",
  "status", "version", "created_at", "updated_at"
)
SELECT "seller_id", "settlement_release_id", "order_id", "currency",
       "unapplied_liability_minor", "unapplied_liability_minor", "evidence_manifest_sha256",
       'OPEN', 0, "created_at", now()
  FROM "shipment_apv_payout_offsets"
 WHERE "unapplied_liability_minor" > 0
ON CONFLICT ("source_settlement_release_id") DO NOTHING;
