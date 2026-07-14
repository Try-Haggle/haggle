ALTER TABLE "dispute_ai_assessment_events"
  ADD COLUMN IF NOT EXISTS "previous_event_hash" text,
  ADD COLUMN IF NOT EXISTS "event_hash" text;

CREATE INDEX IF NOT EXISTS "dispute_ai_assessment_events_event_hash_idx"
  ON "dispute_ai_assessment_events" ("event_hash")
  WHERE "event_hash" IS NOT NULL;
