ALTER TABLE "shipment_apv_remediation_cursor_retention_state"
  DROP CONSTRAINT "shipment_apv_cursor_retention_status_check",
  DROP CONSTRAINT "shipment_apv_cursor_retention_lease_check",
  ALTER COLUMN "last_started_at" DROP NOT NULL,
  ADD COLUMN "first_observed_at" timestamptz NOT NULL DEFAULT now();

ALTER TABLE "shipment_apv_remediation_cursor_retention_state"
  ADD CONSTRAINT "shipment_apv_cursor_retention_status_check"
    CHECK ("status" IN ('NEVER', 'RUNNING', 'SUCCEEDED', 'FAILED')),
  ADD CONSTRAINT "shipment_apv_cursor_retention_lease_check" CHECK (
    ("status" = 'RUNNING' AND "claim_id" IS NOT NULL AND "lease_expires_at" IS NOT NULL
      AND "last_started_at" IS NOT NULL)
    OR ("status" <> 'RUNNING' AND "claim_id" IS NULL AND "lease_expires_at" IS NULL)
  ),
  ADD CONSTRAINT "shipment_apv_cursor_retention_never_check" CHECK (
    "status" <> 'NEVER' OR ("last_started_at" IS NULL AND "last_succeeded_at" IS NULL
      AND "last_failed_at" IS NULL AND "last_failure_code" IS NULL)
  );

INSERT INTO "shipment_apv_remediation_cursor_retention_state"
  ("job_key", "status", "last_started_at")
VALUES ('cursor_retention', 'NEVER', NULL)
ON CONFLICT ("job_key") DO NOTHING;
