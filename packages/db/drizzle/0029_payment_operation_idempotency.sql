CREATE TABLE IF NOT EXISTS "payment_operation_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "operation" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "payment_intent_id" uuid REFERENCES "payment_intents"("id"),
  "request_hash" text NOT NULL,
  "response_status" integer NOT NULL,
  "response_body" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "payment_operation_idem_operation_key_unique"
  ON "payment_operation_idempotency" ("operation", "idempotency_key");

CREATE INDEX IF NOT EXISTS "payment_operation_idem_payment_intent_idx"
  ON "payment_operation_idempotency" ("payment_intent_id");

CREATE INDEX IF NOT EXISTS "payment_operation_idem_expires_at_idx"
  ON "payment_operation_idempotency" ("expires_at");
