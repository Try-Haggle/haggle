CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_delivery_intent()
RETURNS trigger AS $$
DECLARE
  binding record;
  signing_key record;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert delivery intent is append-only';
  END IF;

  SELECT signature.payload_outbox_id, signature.payload_sha256,
    signature.key_id, signature.public_key_spki_base64,
    signature.signing_domain, signature.algorithm,
    signature.status AS signature_status, signature.signed_by,
    signature.signed_at, outbox.delivery_grant_id,
    outbox.payload_sha256 AS outbox_payload_sha256,
    delivery_grant.status AS grant_status, delivery_grant.granted_by,
    delivery_grant.granted_at, delivery_grant.cooldown_expires_at,
    decision.decision, decision.decision_reason, decision.decided_by,
    request.requested_by
  INTO binding
  FROM shipment_apv_manifest_archive_alert_payload_signatures signature
  JOIN shipment_apv_manifest_archive_alert_payload_outbox outbox
    ON outbox.id = signature.payload_outbox_id
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  WHERE signature.id = NEW.payload_signature_id;

  SELECT key.public_key_spki_base64, key_event.event_type,
    key_event.created_at AS event_created_at
  INTO signing_key
  FROM shipment_apv_failure_alert_signing_keys key
  JOIN LATERAL (
    SELECT event.event_type, event.created_at, event.id
    FROM shipment_apv_failure_alert_signing_key_events event
    WHERE event.key_id = key.key_id
    ORDER BY event.created_at DESC, event.id DESC LIMIT 1
  ) key_event ON true
  WHERE key.key_id = NEW.key_id;

  IF binding.payload_outbox_id IS NULL
    OR binding.payload_outbox_id <> NEW.payload_outbox_id
    OR binding.payload_sha256 <> NEW.payload_sha256
    OR binding.outbox_payload_sha256 <> NEW.payload_sha256
    OR binding.key_id <> NEW.key_id
    OR binding.public_key_spki_base64 <> signing_key.public_key_spki_base64
    OR binding.signing_domain <>
      'haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1'
    OR binding.algorithm <> 'Ed25519'
    OR binding.signature_status <> 'SIGNED_DRY_RUN'
    OR binding.signed_by <> NEW.requested_by
    OR binding.grant_status <> 'GRANTED_DRY_RUN'
    OR binding.granted_by <> NEW.requested_by
    OR binding.decision <> 'APPROVED'
    OR binding.decision_reason <> 'checker_approved_snapshot'
    OR binding.decided_by <> NEW.requested_by
    OR binding.requested_by = NEW.requested_by
    OR NEW.created_at < binding.signed_at
    OR NEW.created_at < binding.granted_at
    OR NEW.created_at >= binding.cooldown_expires_at
    OR NEW.created_at < clock_timestamp() - interval '1 minute'
    OR NEW.created_at > clock_timestamp() + interval '1 minute'
    OR clock_timestamp() >= binding.cooldown_expires_at
    OR signing_key.event_type <> 'REGISTERED'
    OR signing_key.event_created_at > NEW.created_at THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert delivery intent binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_delivery_intent_guard
  ON "shipment_apv_manifest_archive_alert_delivery_intents";
CREATE TRIGGER ship_apv_archive_alert_delivery_intent_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_delivery_intents"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_delivery_intent();
