ALTER TABLE "dispute_evidence_scan_retry_alert_snapshots"
  DROP CONSTRAINT IF EXISTS "dispute_scan_retry_alert_snapshot_payload_chk";

ALTER TABLE "dispute_evidence_scan_retry_alert_snapshots"
  ADD CONSTRAINT "dispute_scan_retry_alert_snapshot_payload_chk"
    CHECK (
      jsonb_typeof("payload") = 'object'
      AND "payload"->>'schema_version' IN (
        'dispute-evidence-scan-retry-alert-v2',
        'dispute-evidence-scan-retry-alert-v3'
      )
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
    );
