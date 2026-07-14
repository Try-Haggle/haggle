ALTER TABLE "dispute_evidence_uploads"
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scan_attempt_count_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scan_lease_pair_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scan_processing_lease_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scan_terminal_retry_chk",
  DROP CONSTRAINT IF EXISTS "dispute_evidence_scan_last_error_chk";

ALTER TABLE "dispute_evidence_uploads"
  ADD CONSTRAINT "dispute_evidence_scan_attempt_count_chk"
    CHECK ("scan_attempt_count" BETWEEN 0 AND 20),
  ADD CONSTRAINT "dispute_evidence_scan_lease_pair_chk"
    CHECK (("scan_lease_token" IS NULL) = ("scan_lease_expires_at" IS NULL)),
  ADD CONSTRAINT "dispute_evidence_scan_processing_lease_chk"
    CHECK (
      ("scan_status" = 'SCANNING' AND "scan_lease_token" IS NOT NULL)
      OR
      ("scan_status" <> 'SCANNING' AND "scan_lease_token" IS NULL)
    ),
  ADD CONSTRAINT "dispute_evidence_scan_terminal_retry_chk"
    CHECK (
      "scan_status" NOT IN ('CLEAN', 'INFECTED', 'SKIPPED')
      OR "scan_next_attempt_at" IS NULL
    ),
  ADD CONSTRAINT "dispute_evidence_scan_last_error_chk"
    CHECK ("scan_last_error" IS NULL OR char_length("scan_last_error") <= 200);
