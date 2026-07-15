CREATE TABLE IF NOT EXISTS "dispute_evidence_scan_retry_alert_snapshot_retention_state" (
  "job_key" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "claim_id" uuid,
  "lease_expires_at" timestamptz,
  "first_observed_at" timestamptz NOT NULL DEFAULT now(),
  "last_started_at" timestamptz,
  "last_succeeded_at" timestamptz,
  "last_failed_at" timestamptz,
  "last_deleted_snapshots" integer NOT NULL DEFAULT 0,
  "last_failure_code" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_job_key_check"
    CHECK ("job_key" = 'snapshot_retention'),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_status_check"
    CHECK ("status" IN ('NEVER', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_deleted_check"
    CHECK ("last_deleted_snapshots" >= 0),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_failure_check"
    CHECK (
      ("status" = 'FAILED'
        AND "last_failure_code" = 'RETENTION_EXECUTION_FAILED'
        AND "last_failed_at" IS NOT NULL)
      OR ("status" <> 'FAILED' AND "last_failure_code" IS NULL)
    ),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_lease_check" CHECK (
    ("status" = 'RUNNING' AND "claim_id" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL AND "last_started_at" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "claim_id" IS NULL
      AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_success_check" CHECK (
    "status" <> 'SUCCEEDED' OR "last_succeeded_at" IS NOT NULL
  ),
  CONSTRAINT "dispute_scan_retry_alert_snapshot_retention_never_check" CHECK (
    "status" <> 'NEVER'
    OR ("last_started_at" IS NULL AND "last_succeeded_at" IS NULL
      AND "last_failed_at" IS NULL AND "last_deleted_snapshots" = 0)
  )
);

INSERT INTO "dispute_evidence_scan_retry_alert_snapshot_retention_state"
  ("job_key", "status")
VALUES ('snapshot_retention', 'NEVER')
ON CONFLICT ("job_key") DO NOTHING;
