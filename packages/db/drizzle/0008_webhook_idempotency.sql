CREATE TABLE IF NOT EXISTS "webhook_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL UNIQUE,
  "source" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL,
  "response_status" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "webhook_idempotency_expires_at_idx" ON "webhook_idempotency" ("expires_at");
