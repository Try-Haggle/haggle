ALTER TABLE "dispute_evidence_uploads"
  ADD COLUMN IF NOT EXISTS "perceptual_hash" text,
  ADD COLUMN IF NOT EXISTS "similarity_status" text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "similarity_distance" integer,
  ADD COLUMN IF NOT EXISTS "similarity_reviewed_by" text,
  ADD COLUMN IF NOT EXISTS "similarity_reviewed_at" timestamptz;

ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_perceptual_hash_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_similarity_status_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_uploads_perceptual_hash_chk"
    CHECK ("perceptual_hash" IS NULL OR "perceptual_hash" ~ '^[01]{64}$'),
  ADD CONSTRAINT "dispute_evidence_uploads_similarity_status_chk"
    CHECK ("similarity_status" IN ('PENDING', 'CLEAR', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED', 'FAILED', 'SKIPPED'));

CREATE INDEX IF NOT EXISTS "dispute_evidence_uploads_similarity_status_idx"
  ON "dispute_evidence_uploads" ("similarity_status");
