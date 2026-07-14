CREATE TABLE IF NOT EXISTS "dispute_evidence_scan_retry_alert_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "source" varchar(120) NOT NULL,
  "delivery_id" varchar(80) NOT NULL,
  "snapshot_kind" varchar(16) NOT NULL,
  "payload" jsonb NOT NULL,
  "payload_sha256" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT "dispute_scan_retry_alert_snapshot_source_delivery_unique"
    UNIQUE ("source", "delivery_id")
);

CREATE INDEX IF NOT EXISTS "dispute_scan_retry_alert_snapshot_expiry_idx"
  ON "dispute_evidence_scan_retry_alert_snapshots" ("expires_at");
