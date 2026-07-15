ALTER TABLE "dispute_evidence_similarity_review_events"
  ADD COLUMN IF NOT EXISTS "event_hash" text;

ALTER TABLE "dispute_evidence_similarity_review_events"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_similarity_review_event_hash_check";
ALTER TABLE "dispute_evidence_similarity_review_events"
  ADD CONSTRAINT "dispute_evidence_similarity_review_event_hash_check"
    CHECK ("event_hash" IS NULL OR "event_hash" ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS "dispute_evidence_similarity_review_event_hash_idx"
  ON "dispute_evidence_similarity_review_events" ("event_hash")
  WHERE "event_hash" IS NOT NULL;
