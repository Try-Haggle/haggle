CREATE TABLE IF NOT EXISTS "payment_test_operation_leases" (
  "key" text PRIMARY KEY,
  "lease_id" uuid NOT NULL,
  "owner_id" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "payment_test_operation_leases_expires_idx"
  ON "payment_test_operation_leases" ("expires_at");
