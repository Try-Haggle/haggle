ALTER TABLE "dispute_evidence_scan_retry_alert_snapshots"
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_source_chk",
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_delivery_chk",
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_kind_chk",
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_payload_chk",
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_hash_chk",
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_expiry_chk";

ALTER TABLE "dispute_evidence_scan_retry_alert_snapshots"
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_source_chk"
    CHECK ("source" ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'),
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_delivery_chk"
    CHECK ("delivery_id" ~ '^(health|recovery)_[0-9a-f]{64}$'),
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_kind_chk"
    CHECK ("snapshot_kind" IN ('FIRING', 'RECOVERY')),
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_payload_chk"
    CHECK (
      jsonb_typeof("payload") = 'object'
      AND "payload"->>'schema_version' = 'dispute-evidence-scan-retry-alert-v2'
      AND "payload"->>'type' = 'dispute_evidence_scan_retry.health'
      AND "payload"->>'delivery_id' = "delivery_id"
      AND "payload" ?& ARRAY[
        'schema_version', 'type', 'delivery_id', 'state',
        'severity', 'reasons', 'thresholds', 'health'
      ]
      AND "payload" - ARRAY[
        'schema_version', 'type', 'delivery_id', 'state',
        'severity', 'reasons', 'thresholds', 'health'
      ] = '{}'::jsonb
      AND (("snapshot_kind" = 'FIRING' AND "payload"->>'state' = 'firing')
        OR ("snapshot_kind" = 'RECOVERY'
          AND "payload"->>'state' = 'recovered'))
    ),
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_hash_chk"
    CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_expiry_chk"
    CHECK (
      "expires_at" > "created_at"
      AND "expires_at" <= "created_at" + interval '31 days'
    );

CREATE OR REPLACE FUNCTION haggle_guard_dispute_scan_retry_alert_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'scan retry alert snapshots are immutable';
  END IF;
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true)
      IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'scan retry alert snapshots require controlled cleanup';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS dispute_scan_retry_alert_snapshot_guard
  ON "dispute_evidence_scan_retry_alert_snapshots";
CREATE TRIGGER dispute_scan_retry_alert_snapshot_guard
  BEFORE UPDATE OR DELETE ON "dispute_evidence_scan_retry_alert_snapshots"
  FOR EACH ROW EXECUTE FUNCTION haggle_guard_dispute_scan_retry_alert_snapshot();
