ALTER TABLE "dispute_ai_audit_discovery_failures"
  DROP CONSTRAINT IF EXISTS "dispute_ai_audit_discovery_failure_status_check",
  DROP CONSTRAINT IF EXISTS "dispute_ai_audit_discovery_failure_resolution_check";

ALTER TABLE "dispute_ai_audit_discovery_failures"
  ADD CONSTRAINT "dispute_ai_audit_discovery_failure_status_check"
    CHECK ("status" IN ('OPEN', 'RETRY_REQUESTED', 'RESOLVED')),
  ADD CONSTRAINT "dispute_ai_audit_discovery_failure_resolution_check" CHECK (
    ("status" IN ('OPEN', 'RETRY_REQUESTED') AND "resolved_at" IS NULL)
    OR ("status" = 'RESOLVED' AND "resolved_at" IS NOT NULL)
  );
