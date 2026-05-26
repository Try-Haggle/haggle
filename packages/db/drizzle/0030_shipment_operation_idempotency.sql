CREATE TABLE IF NOT EXISTS "shipments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "seller_id" uuid NOT NULL,
  "buyer_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'LABEL_PENDING',
  "carrier" text,
  "tracking_number" text,
  "label_created_at" timestamp with time zone,
  "shipped_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "shipment_input_due_at" timestamp with time zone,
  "shipping_fee_minor" numeric(18, 0),
  "currency" text NOT NULL DEFAULT 'USD',
  "declared_weight_oz" numeric(10, 2),
  "label_url" text,
  "rate_minor" numeric(18, 0),
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "shipment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shipment_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "raw_status" text,
  "canonical_status" text NOT NULL,
  "payload" jsonb,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "shipments"
  ADD COLUMN IF NOT EXISTS "shipment_type" text NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS "parcel_length_in" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "parcel_width_in" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "parcel_height_in" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "parcel_weight_oz" numeric(10, 2),
  ADD COLUMN IF NOT EXISTS "selected_rate_id" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_shipments_status'
  ) THEN
    ALTER TABLE "shipments"
      ADD CONSTRAINT "chk_shipments_status"
      CHECK ("status" IN (
        'LABEL_PENDING',
        'LABEL_CREATED',
        'IN_TRANSIT',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'DELIVERY_EXCEPTION',
        'RETURN_IN_TRANSIT',
        'RETURNED'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_shipments_tracking'
  ) THEN
    ALTER TABLE "shipments"
      ADD CONSTRAINT "chk_shipments_tracking"
      CHECK ("status" = 'LABEL_PENDING' OR ("carrier" IS NOT NULL AND "tracking_number" IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_shipments_order_id"
  ON "shipments" ("order_id");

CREATE INDEX IF NOT EXISTS "idx_shipments_seller_id"
  ON "shipments" ("seller_id");

CREATE INDEX IF NOT EXISTS "idx_shipments_buyer_id"
  ON "shipments" ("buyer_id");

CREATE INDEX IF NOT EXISTS "idx_shipments_order_status"
  ON "shipments" ("order_id", "status");

CREATE INDEX IF NOT EXISTS "idx_shipment_events_shipment_id"
  ON "shipment_events" ("shipment_id");

CREATE INDEX IF NOT EXISTS "idx_shipment_events_shipment_occurred"
  ON "shipment_events" ("shipment_id", "occurred_at");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_outbound_shipments_order_id"
  ON "shipments" ("order_id")
  WHERE "shipment_type" = 'outbound';

CREATE TABLE IF NOT EXISTS "shipment_operation_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "shipment_id" uuid REFERENCES "shipments"("id"),
  "request_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'IN_PROGRESS',
  "response_status" integer,
  "response_body" jsonb,
  "locked_until" timestamp with time zone DEFAULT now() + interval '2 minutes' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
  CONSTRAINT "chk_shipment_operation_idem_status" CHECK (
    "status" IN ('IN_PROGRESS','SUCCEEDED','FAILED')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_operation_idem_operation_key_unique"
  ON "shipment_operation_idempotency" ("operation", "idempotency_key");

CREATE INDEX IF NOT EXISTS "shipment_operation_idem_shipment_idx"
  ON "shipment_operation_idempotency" ("shipment_id");

CREATE INDEX IF NOT EXISTS "shipment_operation_idem_expires_at_idx"
  ON "shipment_operation_idempotency" ("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "shipment_events_shipment_type_time_unique"
  ON "shipment_events" ("shipment_id", "event_type", "occurred_at");

CREATE INDEX IF NOT EXISTS "shipments_tracking_number_idx"
  ON "shipments" ("tracking_number");
