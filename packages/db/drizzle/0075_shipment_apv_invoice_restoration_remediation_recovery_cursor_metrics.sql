CREATE TABLE IF NOT EXISTS "shipment_apv_remediation_recovery_cursor_metrics" (
  "bucket_start" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "rejection_count" bigint NOT NULL DEFAULT 0,
  "last_seen_at" timestamptz NOT NULL,
  CONSTRAINT "shipment_apv_remediation_cursor_metric_pk"
    PRIMARY KEY ("bucket_start", "reason"),
  CONSTRAINT "shipment_apv_remediation_cursor_metric_reason_check"
    CHECK ("reason" IN ('EXPIRED', 'INVALID')),
  CONSTRAINT "shipment_apv_remediation_cursor_metric_count_check"
    CHECK ("rejection_count" >= 1)
);

CREATE INDEX IF NOT EXISTS "shipment_apv_remediation_cursor_metric_seen_idx"
  ON "shipment_apv_remediation_recovery_cursor_metrics" ("last_seen_at");
