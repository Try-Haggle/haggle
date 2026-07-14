CREATE TABLE IF NOT EXISTS "dispute_ai_assessment_events" (
  "id" text PRIMARY KEY,
  "dispute_id" uuid NOT NULL REFERENCES "dispute_cases"("id"),
  "event_type" text NOT NULL,
  "revision" integer,
  "version_id" text,
  "supersedes_assessment_id" text,
  "evidence_snapshot_hash" text NOT NULL,
  "policy_version" text NOT NULL,
  "model" text,
  "context_hash" text NOT NULL,
  "requested_by" text NOT NULL,
  "forced" boolean NOT NULL DEFAULT false,
  "reassessment_reason" text,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "dispute_ai_assessment_events_type_check"
    CHECK ("event_type" IN ('COMPLETED', 'FAILED')),
  CONSTRAINT "dispute_ai_assessment_events_revision_check"
    CHECK (
      ("event_type" = 'COMPLETED' AND "revision" IS NOT NULL AND "revision" > 0)
      OR ("event_type" = 'FAILED' AND "revision" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "dispute_ai_assessment_events_dispute_created_idx"
  ON "dispute_ai_assessment_events" ("dispute_id", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_ai_assessment_events_dispute_revision_unique"
  ON "dispute_ai_assessment_events" ("dispute_id", "revision")
  WHERE "revision" IS NOT NULL;

INSERT INTO "dispute_ai_assessment_events" (
  "id",
  "dispute_id",
  "event_type",
  "revision",
  "version_id",
  "supersedes_assessment_id",
  "evidence_snapshot_hash",
  "policy_version",
  "model",
  "context_hash",
  "requested_by",
  "forced",
  "reassessment_reason",
  "payload",
  "created_at"
)
SELECT
  COALESCE(history.entry->>'assessment_id', 'legacy_' || md5(cases.id::text || history.entry::text)),
  cases.id,
  'COMPLETED',
  CASE
    WHEN jsonb_typeof(history.entry->'revision') = 'number'
      THEN (history.entry->>'revision')::integer
    ELSE history.ordinality::integer
  END,
  history.entry->>'version_id',
  history.entry->>'supersedes_assessment_id',
  COALESCE(history.entry->>'evidence_snapshot_hash', 'legacy-unknown'),
  COALESCE(history.entry->>'policy_version', 'legacy-unknown'),
  history.entry->>'model',
  COALESCE(history.entry->>'context_hash', 'legacy-unknown'),
  COALESCE(history.entry->>'requested_by', 'legacy-unknown'),
  CASE WHEN history.entry->>'force' IN ('true', 'false')
    THEN (history.entry->>'force')::boolean ELSE false END,
  history.entry->>'reassessment_reason',
  history.entry,
  cases.updated_at
FROM "dispute_cases" AS cases
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(cases.metadata->'ai_resolution_assessment_history', '[]'::jsonb)
) WITH ORDINALITY AS history(entry, ordinality)
ON CONFLICT DO NOTHING;

INSERT INTO "dispute_ai_assessment_events" (
  "id",
  "dispute_id",
  "event_type",
  "evidence_snapshot_hash",
  "policy_version",
  "model",
  "context_hash",
  "requested_by",
  "forced",
  "reassessment_reason",
  "payload",
  "created_at"
)
SELECT
  COALESCE(attempt.entry->>'attempt_id', 'legacy_attempt_' || md5(cases.id::text || attempt.entry::text)),
  cases.id,
  'FAILED',
  COALESCE(attempt.entry->>'evidence_snapshot_hash', 'legacy-unknown'),
  COALESCE(attempt.entry->>'policy_version', 'legacy-unknown'),
  attempt.entry->>'model',
  COALESCE(attempt.entry->>'context_hash', 'legacy-unknown'),
  COALESCE(attempt.entry->>'requested_by', 'legacy-unknown'),
  CASE WHEN attempt.entry->>'force' IN ('true', 'false')
    THEN (attempt.entry->>'force')::boolean ELSE false END,
  attempt.entry->>'reassessment_reason',
  attempt.entry,
  cases.updated_at
FROM "dispute_cases" AS cases
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(cases.metadata->'ai_resolution_assessment_attempt_history', '[]'::jsonb)
) WITH ORDINALITY AS attempt(entry, ordinality)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION reject_dispute_ai_assessment_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'dispute_ai_assessment_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS dispute_ai_assessment_events_append_only
  ON "dispute_ai_assessment_events";

CREATE TRIGGER dispute_ai_assessment_events_append_only
BEFORE UPDATE OR DELETE ON "dispute_ai_assessment_events"
FOR EACH ROW EXECUTE FUNCTION reject_dispute_ai_assessment_event_mutation();
