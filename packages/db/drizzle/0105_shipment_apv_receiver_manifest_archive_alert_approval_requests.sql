CREATE TABLE IF NOT EXISTS "shipment_apv_manifest_archive_alert_approval_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "client_request_id" uuid NOT NULL UNIQUE,
  "preview_schema_version" text NOT NULL,
  "state_fingerprint" varchar(64) NOT NULL,
  "preview_action" text NOT NULL,
  "preview_severity" text NOT NULL,
  "preview_reasons" text[] NOT NULL,
  "requested_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "ship_apv_archive_alert_approval_schema_check"
    CHECK ("preview_schema_version" =
      'shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1'),
  CONSTRAINT "ship_apv_archive_alert_approval_fingerprint_check"
    CHECK ("state_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ship_apv_archive_alert_approval_action_check"
    CHECK ("preview_action" IN ('review_warning', 'escalate_critical')),
  CONSTRAINT "ship_apv_archive_alert_approval_severity_check"
    CHECK ("preview_severity" IN ('warning', 'critical')),
  CONSTRAINT "ship_apv_archive_alert_approval_reason_check"
    CHECK (
      cardinality("preview_reasons") BETWEEN 1 AND 7
      AND "preview_reasons" <@ ARRAY[
        'archive_intent_binding_violation',
        'archive_intent_blocker_violation',
        'archive_intent_side_effect_violation',
        'archive_intent_timestamp_violation',
        'archive_source_limit_violation',
        'current_archive_intent_missing',
        'archive_intent_stale'
      ]::text[]
    ),
  CONSTRAINT "ship_apv_archive_alert_approval_expiry_check"
    CHECK ("expires_at" > "created_at"
      AND "expires_at" <= "created_at" + interval '15 minutes')
);

CREATE INDEX IF NOT EXISTS "ship_apv_archive_alert_approval_expiry_idx"
  ON "shipment_apv_manifest_archive_alert_approval_requests" ("expires_at");
