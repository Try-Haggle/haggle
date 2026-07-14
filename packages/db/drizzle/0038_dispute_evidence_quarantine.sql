ALTER TABLE "dispute_evidence_uploads"
  ADD COLUMN IF NOT EXISTS "scan_status" text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "content_sha256" text,
  ADD COLUMN IF NOT EXISTS "scan_provider" text,
  ADD COLUMN IF NOT EXISTS "scan_detail" text,
  ADD COLUMN IF NOT EXISTS "scanned_at" timestamptz;

ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_status_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_uploads_status_chk"
  CHECK ("status" IN ('PENDING', 'QUARANTINED', 'COMMITTED', 'REJECTED', 'EXPIRED'));

ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_uploads_scan_status_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_uploads_scan_status_chk"
  CHECK ("scan_status" IN ('PENDING', 'SCANNING', 'CLEAN', 'INFECTED', 'FAILED', 'SKIPPED'));

CREATE INDEX IF NOT EXISTS "dispute_evidence_uploads_dispute_scan_status_idx"
  ON "dispute_evidence_uploads" ("dispute_id", "scan_status");
