CREATE TABLE IF NOT EXISTS "shipment_apv_remediation_cursor_retention_state" (
  "job_key" text PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "claim_id" uuid,
  "lease_expires_at" timestamptz,
  "last_started_at" timestamptz NOT NULL,
  "last_succeeded_at" timestamptz,
  "last_failed_at" timestamptz,
  "last_deleted_buckets" integer NOT NULL DEFAULT 0,
  "last_expired_buckets" integer NOT NULL DEFAULT 0,
  "last_invalid_buckets" integer NOT NULL DEFAULT 0,
  "last_truncated" boolean NOT NULL DEFAULT false,
  "last_failure_code" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_apv_cursor_retention_job_key_check"
    CHECK ("job_key" = 'cursor_retention'),
  CONSTRAINT "shipment_apv_cursor_retention_status_check"
    CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  CONSTRAINT "shipment_apv_cursor_retention_counts_check"
    CHECK ("last_deleted_buckets" >= 0 AND "last_expired_buckets" >= 0
      AND "last_invalid_buckets" >= 0),
  CONSTRAINT "shipment_apv_cursor_retention_failure_check"
    CHECK ("last_failure_code" IS NULL OR "last_failure_code" = 'RETENTION_EXECUTION_FAILED'),
  CONSTRAINT "shipment_apv_cursor_retention_lease_check" CHECK (
    ("status" = 'RUNNING' AND "claim_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "claim_id" IS NULL AND "lease_expires_at" IS NULL)
  )
);
