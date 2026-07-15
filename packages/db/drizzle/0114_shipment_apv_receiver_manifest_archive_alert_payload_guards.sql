CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_payload_outbox()
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
    RAISE EXCEPTION
      'shipment APV manifest archive alert payload outbox is append-only';
  END IF;

  SELECT delivery_grant.status AS grant_status, delivery_grant.granted_by,
    delivery_grant.state_fingerprint, delivery_grant.granted_at,
    delivery_grant.cooldown_expires_at AS grant_cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    request.requested_by, request.preview_schema_version,
    request.preview_action, request.preview_severity, request.preview_reasons,
    cooldown.grant_id AS cooldown_grant_id,
    cooldown.claimed_at AS cooldown_claimed_at,
    cooldown.expires_at AS cooldown_expires_at
  INTO binding
  FROM shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  JOIN shipment_apv_manifest_archive_alert_cooldown_claims cooldown
    ON cooldown.state_fingerprint = delivery_grant.state_fingerprint
  WHERE delivery_grant.id = NEW.delivery_grant_id;

  expected_payload := jsonb_build_object(
    'schema_version',
      'shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1',
    'event_type',
      'shipment_apv_failure_alert_receiver_manifest_archive_alert',
    'action', binding.preview_action,
    'severity', binding.preview_severity,
    'reasons', to_jsonb(binding.preview_reasons),
    'state_fingerprint', binding.state_fingerprint
  );
  expected_canonical := '{"action":' || to_jsonb(binding.preview_action)::text
    || ',"event_type":"shipment_apv_failure_alert_receiver_manifest_archive_alert"'
    || ',"reasons":' || regexp_replace(
      to_jsonb(binding.preview_reasons)::text, '[[:space:]]', '', 'g')
    || ',"schema_version":"shipment-apv-failure-alert-receiver-manifest-archive-alert-payload-v1"'
    || ',"severity":' || to_jsonb(binding.preview_severity)::text
    || ',"state_fingerprint":' || to_jsonb(binding.state_fingerprint)::text || '}';

  IF NOT FOUND
    OR binding.grant_status <> 'GRANTED_DRY_RUN'
    OR binding.decision <> 'APPROVED'
    OR binding.decision_reason <> 'checker_approved_snapshot'
    OR binding.decided_by <> binding.granted_by
    OR binding.requested_by = binding.granted_by
    OR binding.granted_by <> NEW.created_by
    OR binding.state_fingerprint <> NEW.state_fingerprint
    OR binding.preview_schema_version <>
      'shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1'
    OR binding.cooldown_grant_id <> NEW.delivery_grant_id
    OR binding.cooldown_claimed_at <> binding.granted_at
    OR binding.cooldown_expires_at <> binding.grant_cooldown_expires_at
    OR NEW.created_at < binding.granted_at
    OR NEW.created_at >= binding.grant_cooldown_expires_at
    OR clock_timestamp() >= binding.grant_cooldown_expires_at
    OR NEW.created_at > clock_timestamp() + interval '1 minute'
    OR NEW.payload <> expected_payload
    OR NEW.canonical_payload <> expected_canonical
    OR encode(digest(convert_to(NEW.canonical_payload, 'UTF8'), 'sha256'), 'hex')
      <> NEW.payload_sha256 THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert payload outbox binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_payload_outbox_guard
  ON "shipment_apv_manifest_archive_alert_payload_outbox";
CREATE TRIGGER ship_apv_archive_alert_payload_outbox_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_payload_outbox"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_payload_outbox();
