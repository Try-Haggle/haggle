CREATE TABLE IF NOT EXISTS "dispute_ai_assessment_leases" (
  "dispute_id" uuid PRIMARY KEY REFERENCES "dispute_cases"("id") ON DELETE CASCADE,
  "lease_id" uuid NOT NULL,
  "owner_id" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "dispute_ai_assessment_leases_expires_idx"
  ON "dispute_ai_assessment_leases" ("expires_at");
