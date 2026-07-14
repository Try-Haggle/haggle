CREATE TABLE IF NOT EXISTS "shipment_apv_adjustments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "provider_invoice_id" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "shipment_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "settlement_release_id" uuid NOT NULL,
  "status" text DEFAULT 'PROCESSING' NOT NULL,
  "original_rate_minor" numeric(18, 0) NOT NULL,
  "adjusted_rate_minor" numeric(18, 0) NOT NULL,
  "adjustment_minor" numeric(18, 0) NOT NULL,
  "buffer_applied_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  "seller_liability_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  "carrier_credit_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  "buyer_effect_minor" numeric(18, 0) DEFAULT '0' NOT NULL,
  "claim_id" uuid,
  "lease_expires_at" timestamp with time zone,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "metadata" jsonb,
  "processed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "shipment_apv_status_check" CHECK ("status" IN ('PROCESSING', 'APPLIED', 'REVIEW_REQUIRED', 'CREDIT_RECORDED', 'FAILED')),
  CONSTRAINT "shipment_apv_buyer_effect_zero_check" CHECK ("buyer_effect_minor" = 0),
  CONSTRAINT "shipment_apv_nonnegative_allocations_check" CHECK (
    "buffer_applied_minor" >= 0 AND "seller_liability_minor" >= 0 AND "carrier_credit_minor" >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_apv_provider_invoice_unique"
  ON "shipment_apv_adjustments" ("provider", "provider_invoice_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_shipment_idx"
  ON "shipment_apv_adjustments" ("shipment_id");
CREATE INDEX IF NOT EXISTS "shipment_apv_status_lease_idx"
  ON "shipment_apv_adjustments" ("status", "lease_expires_at");
