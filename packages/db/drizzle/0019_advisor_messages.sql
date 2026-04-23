-- Step 97: AI Advisor chat messages for dispute resolution

CREATE TABLE IF NOT EXISTS "advisor_messages" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dispute_id"  uuid NOT NULL REFERENCES "dispute_cases"("id"),
  "role"        text NOT NULL,
  "content"     text NOT NULL,
  "metadata"    jsonb,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_advisor_role" CHECK (role IN ('buyer_advisor','seller_advisor','buyer_user','seller_user'))
);

CREATE INDEX IF NOT EXISTS "idx_advisor_messages_dispute"
  ON "advisor_messages" ("dispute_id", "created_at");
