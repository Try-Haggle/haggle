ALTER TABLE "dispute_evidence"
  ADD COLUMN IF NOT EXISTS "source_content_sha256" text;

ALTER TABLE "dispute_evidence"
  ADD COLUMN IF NOT EXISTS "derived_artifacts_provenance" jsonb;

-- Cycle 72 artifacts predate signatures. Keep the verified parent evidence but
-- remove those untrusted machine observations before enforcing the invariant.
UPDATE "dispute_evidence"
SET "derived_artifacts" = NULL
WHERE "derived_artifacts" IS NOT NULL
  AND "derived_artifacts_provenance" IS NULL;

ALTER TABLE "dispute_evidence"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_derived_artifacts_provenance_check";

ALTER TABLE "dispute_evidence"
  ADD CONSTRAINT "dispute_evidence_derived_artifacts_provenance_check" CHECK (
    (
      "derived_artifacts" IS NULL
      AND "source_content_sha256" IS NULL
      AND "derived_artifacts_provenance" IS NULL
    )
    OR (
      "derived_artifacts" IS NOT NULL
      AND "source_content_sha256" ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof("derived_artifacts_provenance") = 'object'
      AND octet_length("derived_artifacts_provenance"::text) <= 16384
    )
  );

CREATE OR REPLACE FUNCTION prevent_dispute_evidence_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'dispute_evidence is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS dispute_evidence_append_only
  ON "dispute_evidence";

CREATE TRIGGER dispute_evidence_append_only
  BEFORE UPDATE ON "dispute_evidence"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispute_evidence_update();
