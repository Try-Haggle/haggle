CREATE TABLE IF NOT EXISTS "dispute_evidence_similarity_review_audit_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "archive_key" text NOT NULL,
  "event_id" uuid NOT NULL,
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
  CONSTRAINT "dispute_similarity_review_audit_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER')),
  CONSTRAINT "dispute_similarity_review_audit_payload_hash_check"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_similarity_review_audit_receipt_hash_check"
    CHECK ("receipt_sha256" IS NULL OR "receipt_sha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "dispute_similarity_review_audit_delivery_check" CHECK (
    ("status" = 'DELIVERED' AND "delivered_at" IS NOT NULL AND "receipt_id" IS NOT NULL
      AND "receipt_sha256" = "payload_sha256")
    OR ("status" <> 'DELIVERED' AND "delivered_at" IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_similarity_review_audit_archive_key_unique"
  ON "dispute_evidence_similarity_review_audit_outbox" ("archive_key");
CREATE INDEX IF NOT EXISTS "dispute_similarity_review_audit_event_idx"
  ON "dispute_evidence_similarity_review_audit_outbox" ("event_id", "created_at");
CREATE INDEX IF NOT EXISTS "dispute_similarity_review_audit_due_idx"
  ON "dispute_evidence_similarity_review_audit_outbox" ("status", "next_attempt_at");
