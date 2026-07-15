CREATE TABLE IF NOT EXISTS "dispute_operation_leases" (
  "key" text PRIMARY KEY,
  "dispute_id" uuid NOT NULL REFERENCES "dispute_cases"("id") ON DELETE CASCADE,
  "operation" text NOT NULL,
  "lease_id" uuid NOT NULL,
  "owner_id" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "dispute_operation_leases_key_check"
    CHECK ("key" = "dispute_id"::text || ':' || "operation")
);

CREATE INDEX IF NOT EXISTS "dispute_operation_leases_expires_idx"
  ON "dispute_operation_leases" ("expires_at");
