ALTER TABLE "dispute_evidence_uploads"
  ADD COLUMN IF NOT EXISTS "scan_attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "scan_next_attempt_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "scan_lease_token" uuid,
  ADD COLUMN IF NOT EXISTS "scan_lease_expires_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "scan_last_error" text;

CREATE INDEX IF NOT EXISTS "dispute_evidence_uploads_scan_retry_ready_idx"
  ON "dispute_evidence_uploads"
    ("scan_status", "scan_next_attempt_at", "scan_lease_expires_at")
  WHERE "status" = 'QUARANTINED' AND "retention_status" = 'ACTIVE';
