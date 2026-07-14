ALTER TABLE "dispute_evidence"
  ADD COLUMN IF NOT EXISTS "derived_artifacts" jsonb;

ALTER TABLE "dispute_evidence"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_derived_artifacts_check";

ALTER TABLE "dispute_evidence"
  ADD CONSTRAINT "dispute_evidence_derived_artifacts_check" CHECK (
    "derived_artifacts" IS NULL
    OR (
      jsonb_typeof("derived_artifacts") = 'array'
      AND jsonb_array_length("derived_artifacts") <= 20
      AND octet_length("derived_artifacts"::text) <= 16384
    )
  );
