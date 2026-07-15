ALTER TABLE "shipment_apv_failure_alert_payload_outbox"
  ADD COLUMN IF NOT EXISTS "canonical_payload" text NOT NULL;

CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_payload_outbox()
RETURNS trigger AS $$
DECLARE
  binding record;
  expected_payload jsonb;
  expected_canonical text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV failure alert payload outbox is append-only';
  END IF;

  SELECT delivery_grant.status AS grant_status, delivery_grant.granted_by,
    delivery_grant.state_fingerprint, delivery_grant.cooldown_expires_at,
    request.preview_action, request.preview_severity, request.preview_reasons
  INTO binding
  FROM shipment_apv_failure_alert_delivery_grants delivery_grant
  JOIN shipment_apv_failure_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_failure_alert_approval_requests request
    ON request.id = decision.approval_request_id
  WHERE delivery_grant.id = NEW.delivery_grant_id;

  expected_payload := jsonb_build_object(
    'schema_version', 'shipment-apv-failure-alert-payload-v1',
    'event_type', 'shipment_apv_failure_alert',
    'action', binding.preview_action,
    'severity', binding.preview_severity,
    'reasons', to_jsonb(binding.preview_reasons),
    'state_fingerprint', binding.state_fingerprint
  );
  expected_canonical := '{"action":' || to_jsonb(binding.preview_action)::text
    || ',"event_type":"shipment_apv_failure_alert"'
    || ',"reasons":' || regexp_replace(
      to_jsonb(binding.preview_reasons)::text, '[[:space:]]', '', 'g')
    || ',"schema_version":"shipment-apv-failure-alert-payload-v1"'
    || ',"severity":' || to_jsonb(binding.preview_severity)::text
    || ',"state_fingerprint":' || to_jsonb(binding.state_fingerprint)::text || '}';

  IF NOT FOUND
    OR binding.grant_status <> 'GRANTED_DRY_RUN'
    OR binding.granted_by <> NEW.created_by
    OR binding.state_fingerprint <> NEW.state_fingerprint
    OR clock_timestamp() >= binding.cooldown_expires_at
    OR NEW.payload <> expected_payload
    OR NEW.canonical_payload <> expected_canonical
    OR encode(digest(convert_to(NEW.canonical_payload, 'UTF8'), 'sha256'), 'hex')
      <> NEW.payload_sha256 THEN
    RAISE EXCEPTION 'shipment APV failure alert payload outbox binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
