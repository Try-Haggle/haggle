ALTER TABLE "webhook_idempotency"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'COMPLETED',
  ADD COLUMN IF NOT EXISTS "claim_id" uuid,
  ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "payload_sha256" text,
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "completed_at" timestamptz;

UPDATE "webhook_idempotency"
   SET "status" = 'COMPLETED',
       "completed_at" = COALESCE("completed_at", "processed_at"),
       "attempt_count" = GREATEST("attempt_count", 1)
 WHERE "status" = 'COMPLETED';

ALTER TABLE "webhook_idempotency"
  DROP CONSTRAINT IF EXISTS "webhook_idempotency_idempotency_key_unique",
  DROP CONSTRAINT IF EXISTS "webhook_idempotency_idempotency_key_key",
  DROP CONSTRAINT IF EXISTS "webhook_idempotency_status_chk",
  DROP CONSTRAINT IF EXISTS "webhook_idempotency_payload_sha256_chk";

ALTER TABLE "webhook_idempotency"
  ADD CONSTRAINT "webhook_idempotency_status_chk"
    CHECK ("status" IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  ADD CONSTRAINT "webhook_idempotency_payload_sha256_chk"
    CHECK ("payload_sha256" IS NULL OR "payload_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "webhook_idempotency_source_event_unique"
    UNIQUE ("source", "idempotency_key");

CREATE INDEX IF NOT EXISTS "webhook_idempotency_status_lease_idx"
  ON "webhook_idempotency" ("status", "lease_expires_at");
