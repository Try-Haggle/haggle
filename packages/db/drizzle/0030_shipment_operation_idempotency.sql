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
