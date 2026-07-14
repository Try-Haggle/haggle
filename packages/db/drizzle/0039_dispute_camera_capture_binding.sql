ALTER TABLE "dispute_evidence_uploads"
  ADD COLUMN IF NOT EXISTS "camera_session_id" text,
  ADD COLUMN IF NOT EXISTS "capture_declared_sha256" text;

ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_capture_sha256_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_uploads_capture_sha256_chk"
  CHECK (
    "capture_declared_sha256" IS NULL
    OR "capture_declared_sha256" ~ '^[0-9a-f]{64}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS "dispute_evidence_uploads_committed_camera_sha256_unique"
  ON "dispute_evidence_uploads" ("content_sha256")
  WHERE "status" = 'COMMITTED'
    AND "camera_session_id" IS NOT NULL
    AND "content_sha256" IS NOT NULL;
