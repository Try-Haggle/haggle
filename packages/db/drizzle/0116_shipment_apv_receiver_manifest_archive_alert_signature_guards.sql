CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_payload_signature()
RETURNS trigger AS $$
DECLARE
  binding record;
  signing_key record;
  expected_key_id text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert payload signature is append-only';
  END IF;

  SELECT outbox.payload_sha256, outbox.created_by, outbox.created_at,
    delivery_grant.status AS grant_status, delivery_grant.granted_by,
    delivery_grant.granted_at, delivery_grant.cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    request.requested_by
  INTO binding
  FROM shipment_apv_manifest_archive_alert_payload_outbox outbox
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  WHERE outbox.id = NEW.payload_outbox_id;

  SELECT key.public_key_spki_base64, key.registered_at,
    key_event.event_type, key_event.created_at AS event_created_at
  INTO signing_key
  FROM shipment_apv_failure_alert_signing_keys key
  JOIN LATERAL (
    SELECT event.event_type, event.created_at, event.id
    FROM shipment_apv_failure_alert_signing_key_events event
    WHERE event.key_id = key.key_id
      AND event.created_at <= NEW.signed_at
    ORDER BY event.created_at DESC, event.id DESC LIMIT 1
  ) key_event ON true
  WHERE key.key_id = NEW.key_id;

  BEGIN
    expected_key_id := substring(encode(
      digest(decode(NEW.public_key_spki_base64, 'base64'), 'sha256'), 'hex')
      from 1 for 24);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert signature key rejected';
  END;

  IF binding.payload_sha256 IS NULL
    OR binding.payload_sha256 <> NEW.payload_sha256
    OR binding.created_by <> NEW.signed_by
    OR binding.grant_status <> 'GRANTED_DRY_RUN'
    OR binding.granted_by <> NEW.signed_by
    OR binding.decision <> 'APPROVED'
    OR binding.decision_reason <> 'checker_approved_snapshot'
    OR binding.decided_by <> NEW.signed_by
    OR binding.requested_by = NEW.signed_by
    OR NEW.signed_at < binding.created_at
    OR NEW.signed_at < binding.granted_at
    OR NEW.signed_at >= binding.cooldown_expires_at
    OR NEW.signed_at > clock_timestamp() + interval '1 minute'
    OR clock_timestamp() >= binding.cooldown_expires_at
    OR signing_key.event_type <> 'REGISTERED'
    OR signing_key.registered_at > NEW.signed_at
    OR signing_key.event_created_at > NEW.signed_at
    OR signing_key.public_key_spki_base64 <> NEW.public_key_spki_base64
    OR expected_key_id <> NEW.key_id THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert payload signature binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_payload_signature_guard
  ON "shipment_apv_manifest_archive_alert_payload_signatures";
CREATE TRIGGER ship_apv_archive_alert_payload_signature_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_payload_signatures"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_payload_signature();
