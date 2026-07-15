CREATE TABLE IF NOT EXISTS "dispute_evidence_similarity_review_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "upload_id" uuid NOT NULL,
  "dispute_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "actor_id" uuid,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dispute_evidence_similarity_review_event_type_check"
    CHECK ("event_type" IN ('AUTO_EXPIRED')),
  CONSTRAINT "dispute_evidence_similarity_review_event_actor_check"
    CHECK ("event_type" <> 'AUTO_EXPIRED' OR "actor_id" IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_evidence_similarity_review_event_transition_unique"
  ON "dispute_evidence_similarity_review_events" ("upload_id", "event_type");
CREATE INDEX IF NOT EXISTS "dispute_evidence_similarity_review_event_timeline_idx"
  ON "dispute_evidence_similarity_review_events" ("upload_id", "created_at", "id");
