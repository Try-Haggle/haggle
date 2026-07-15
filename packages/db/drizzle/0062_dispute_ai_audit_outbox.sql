CREATE TABLE IF NOT EXISTS "dispute_ai_audit_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "archive_key" text NOT NULL,
  "dispute_id" uuid NOT NULL,
  "event_count" integer NOT NULL,
  "events_sha256" text NOT NULL,
  "chain_head_event_hash" text,
  "payload" jsonb NOT NULL,
  "payload_sha256" text NOT NULL,
  "status" text DEFAULT 'PENDING' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "http_status" integer,
  "receipt_id" text,
  "receipt_sha256" text,
  "delivered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispute_ai_audit_event_count_check" CHECK ("event_count" > 0),
  CONSTRAINT "dispute_ai_audit_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')),
  CONSTRAINT "dispute_ai_audit_events_hash_check" CHECK ("events_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_ai_audit_chain_head_check" CHECK ("chain_head_event_hash" IS NULL OR "chain_head_event_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_ai_audit_payload_hash_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_ai_audit_receipt_hash_check" CHECK ("receipt_sha256" IS NULL OR "receipt_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_ai_audit_delivery_check" CHECK (
    ("status" = 'DELIVERED' AND "delivered_at" IS NOT NULL AND "receipt_id" IS NOT NULL AND "receipt_sha256" = "payload_sha256")
    OR ("status" <> 'DELIVERED' AND "delivered_at" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_ai_audit_archive_key_unique" ON "dispute_ai_audit_outbox" ("archive_key");
CREATE INDEX IF NOT EXISTS "dispute_ai_audit_dispute_idx" ON "dispute_ai_audit_outbox" ("dispute_id", "created_at");
CREATE INDEX IF NOT EXISTS "dispute_ai_audit_due_idx" ON "dispute_ai_audit_outbox" ("status", "next_attempt_at");
