ALTER TABLE "dispute_cases"
  ADD COLUMN IF NOT EXISTS "evidence_legal_hold" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "evidence_legal_hold_reason" text,
  ADD COLUMN IF NOT EXISTS "evidence_legal_hold_set_by" text,
  ADD COLUMN IF NOT EXISTS "evidence_legal_hold_set_at" timestamptz;

ALTER TABLE "dispute_evidence_uploads"
  ADD COLUMN IF NOT EXISTS "retention_status" text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "retention_until" timestamptz,
  ADD COLUMN IF NOT EXISTS "deletion_claim_id" uuid,
  ADD COLUMN IF NOT EXISTS "deletion_claimed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deletion_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deletion_next_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "deletion_last_error" text,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_retention_status_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_uploads_retention_status_chk"
  CHECK ("retention_status" IN ('ACTIVE', 'DELETING', 'DELETED', 'FAILED'));

CREATE INDEX IF NOT EXISTS "dispute_evidence_uploads_retention_status_idx"
  ON "dispute_evidence_uploads" ("retention_status", "retention_until");
