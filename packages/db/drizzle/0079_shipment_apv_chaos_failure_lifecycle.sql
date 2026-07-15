ALTER TABLE "shipment_apv_chaos_failure_metrics"
  ADD COLUMN IF NOT EXISTS "first_failure_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "warning_observed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "critical_observed_at" timestamptz;

UPDATE "shipment_apv_chaos_failure_metrics"
SET "first_failure_at" = "last_failure_at"
WHERE "first_failure_at" IS NULL;

UPDATE "shipment_apv_chaos_failure_metrics"
SET "warning_observed_at" = "first_failure_at"
WHERE "warning_observed_at" IS NULL
  AND "failure_count" >= CASE
    WHEN "stage" IN ('rollback_verification', 'rollback_failure_isolation') THEN 1
    WHEN "stage" = 'fixture_execution' THEN 3
  END;

UPDATE "shipment_apv_chaos_failure_metrics"
SET "critical_observed_at" = "last_failure_at"
WHERE "critical_observed_at" IS NULL
  AND "failure_count" >= CASE
    WHEN "stage" IN ('rollback_verification', 'rollback_failure_isolation') THEN 3
    WHEN "stage" = 'fixture_execution' THEN 10
  END;

ALTER TABLE "shipment_apv_chaos_failure_metrics"
  ALTER COLUMN "first_failure_at" SET NOT NULL;

ALTER TABLE "shipment_apv_chaos_failure_metrics"
  DROP CONSTRAINT IF EXISTS "shipment_apv_chaos_failure_metric_time_check";

ALTER TABLE "shipment_apv_chaos_failure_metrics"
  ADD CONSTRAINT "shipment_apv_chaos_failure_metric_time_check"
    CHECK (
      "first_failure_at" >= "bucket_start"
      AND "first_failure_at" < "bucket_start" + interval '1 hour'
      AND "last_failure_at" >= "first_failure_at"
      AND "last_failure_at" < "bucket_start" + interval '1 hour'
      AND ("warning_observed_at" IS NULL OR (
        "warning_observed_at" >= "first_failure_at"
        AND "warning_observed_at" <= "last_failure_at"
      ))
      AND ("critical_observed_at" IS NULL OR (
        "warning_observed_at" IS NOT NULL
        AND "critical_observed_at" >= "warning_observed_at"
        AND "critical_observed_at" <= "last_failure_at"
      ))
    );
