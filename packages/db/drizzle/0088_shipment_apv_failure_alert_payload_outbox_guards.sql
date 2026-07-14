CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_payload_outbox()
RETURNS trigger AS $$
DECLARE
  binding record;
  expected_payload jsonb;
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

  IF NOT FOUND
    OR binding.grant_status <> 'GRANTED_DRY_RUN'
    OR binding.granted_by <> NEW.created_by
    OR binding.state_fingerprint <> NEW.state_fingerprint
    OR clock_timestamp() >= binding.cooldown_expires_at
    OR NEW.payload <> expected_payload
    OR encode(digest(convert_to(
      regexp_replace(NEW.payload::text, '[[:space:]]', '', 'g'), 'UTF8'), 'sha256'), 'hex')
      <> NEW.payload_sha256 THEN
    RAISE EXCEPTION 'shipment APV failure alert payload outbox binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_payload_outbox_guard
  ON "shipment_apv_failure_alert_payload_outbox";
CREATE TRIGGER shipment_apv_failure_alert_payload_outbox_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_payload_outbox"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_payload_outbox();
