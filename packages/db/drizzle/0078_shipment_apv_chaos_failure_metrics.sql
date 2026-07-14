CREATE TABLE IF NOT EXISTS "shipment_apv_chaos_failure_metrics" (
  "bucket_start" timestamptz NOT NULL,
  "stage" text NOT NULL,
  "failure_count" bigint NOT NULL DEFAULT 1,
  "last_failure_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_chaos_failure_metric_pk"
    PRIMARY KEY ("bucket_start", "stage"),
  CONSTRAINT "shipment_apv_chaos_failure_metric_stage_check"
    CHECK ("stage" IN ('rollback_verification', 'rollback_failure_isolation', 'fixture_execution')),
  CONSTRAINT "shipment_apv_chaos_failure_metric_count_check"
    CHECK ("failure_count" >= 1 AND "failure_count" <= 2147483647)
);

CREATE INDEX IF NOT EXISTS "shipment_apv_chaos_failure_metric_seen_idx"
  ON "shipment_apv_chaos_failure_metrics" ("last_failure_at");
