CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_receiver_claim()
RETURNS trigger AS $$
DECLARE
  binding record;
  signing_key record;
  expected_delivery_id text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert receiver claim is append-only';
  END IF;

  SELECT intent.payload_signature_id, intent.payload_outbox_id,
    intent.payload_sha256, intent.key_id, intent.status AS intent_status,
    intent.blocking_reasons, intent.http_request_created,
    intent.delivery_attempted AS intent_delivery_attempted,
    intent.requested_by AS intent_requested_by,
    intent.created_at AS intent_created_at,
    signature.payload_outbox_id AS signature_payload_outbox_id,
    signature.payload_sha256 AS signature_payload_sha256,
    signature.key_id AS signature_key_id,
    signature.public_key_spki_base64,
    signature.signing_domain, signature.algorithm,
    signature.status AS signature_status, signature.signed_by,
    signature.signed_at,
    outbox.payload_sha256 AS outbox_payload_sha256,
    outbox.state_fingerprint AS outbox_state_fingerprint,
    outbox.status AS outbox_status, outbox.created_by,
    outbox.created_at AS outbox_created_at,
    delivery_grant.id AS grant_id,
    delivery_grant.approval_decision_id,
    delivery_grant.state_fingerprint AS grant_state_fingerprint,
    delivery_grant.status AS grant_status,
    delivery_grant.granted_by, delivery_grant.granted_at,
    delivery_grant.cooldown_expires_at,
    cooldown.grant_id AS cooldown_grant_id,
    cooldown.claimed_at AS cooldown_claimed_at,
    cooldown.expires_at AS cooldown_expires_at,
    decision.id AS decision_id,
    decision.approval_request_id,
    decision.request_state_fingerprint AS decision_state_fingerprint,
    decision.decision, decision.decision_reason, decision.decided_by,
    decision.created_at AS decided_at,
    request.id AS request_id,
    request.preview_schema_version,
    request.state_fingerprint AS request_state_fingerprint,
    request.requested_by AS maker_requested_by,
    request.created_at AS request_created_at,
    request.expires_at AS request_expires_at
  INTO binding
  FROM shipment_apv_manifest_archive_alert_delivery_intents intent
  JOIN shipment_apv_manifest_archive_alert_payload_signatures signature
    ON signature.id = intent.payload_signature_id
  JOIN shipment_apv_manifest_archive_alert_payload_outbox outbox
    ON outbox.id = signature.payload_outbox_id
  JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  JOIN shipment_apv_manifest_archive_alert_cooldown_claims cooldown
    ON cooldown.state_fingerprint = delivery_grant.state_fingerprint
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  WHERE intent.id = NEW.delivery_intent_id;

  SELECT key.public_key_spki_base64, event.event_type,
    event.created_at AS event_created_at
  INTO signing_key
  FROM shipment_apv_failure_alert_signing_keys key
  JOIN LATERAL (
    SELECT key_event.event_type, key_event.created_at, key_event.id
    FROM shipment_apv_failure_alert_signing_key_events key_event
    WHERE key_event.key_id = key.key_id
    ORDER BY key_event.created_at DESC, key_event.id DESC LIMIT 1
  ) event ON true
  WHERE key.key_id = NEW.key_id;

  expected_delivery_id := encode(digest(
    'haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.receiver-delivery.v1:'
      || NEW.delivery_intent_id::text || ':' || NEW.payload_sha256,
    'sha256'), 'hex');

  IF binding.payload_signature_id IS NULL
    OR binding.payload_signature_id <> NEW.payload_signature_id
    OR binding.payload_outbox_id <> NEW.payload_outbox_id
    OR binding.signature_payload_outbox_id <> NEW.payload_outbox_id
    OR binding.payload_sha256 <> NEW.payload_sha256
    OR binding.signature_payload_sha256 <> NEW.payload_sha256
    OR binding.outbox_payload_sha256 <> NEW.payload_sha256
    OR binding.key_id <> NEW.key_id
    OR binding.signature_key_id <> NEW.key_id
    OR binding.public_key_spki_base64 IS DISTINCT FROM
      signing_key.public_key_spki_base64
    OR binding.signing_domain <>
      'haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1'
    OR binding.algorithm <> 'Ed25519'
    OR binding.intent_status <> 'BLOCKED_CONFIGURATION_DRY_RUN'
    OR binding.blocking_reasons <> ARRAY[
      'independent_trust_anchor_missing',
      'receiver_endpoint_missing',
      'receiver_credential_missing'
    ]::text[]
    OR binding.http_request_created <> false
    OR binding.intent_delivery_attempted <> false
    OR binding.signature_status <> 'SIGNED_DRY_RUN'
    OR binding.outbox_status <> 'UNSIGNED_DRY_RUN'
    OR binding.grant_status <> 'GRANTED_DRY_RUN'
    OR binding.preview_schema_version <>
      'shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1'
    OR binding.grant_id <> binding.cooldown_grant_id
    OR binding.approval_decision_id <> binding.decision_id
    OR binding.approval_request_id <> binding.request_id
    OR binding.outbox_state_fingerprint <> binding.grant_state_fingerprint
    OR binding.decision_state_fingerprint <> binding.grant_state_fingerprint
    OR binding.request_state_fingerprint <> binding.grant_state_fingerprint
    OR binding.cooldown_claimed_at <> binding.granted_at
    OR binding.cooldown_expires_at <> binding.cooldown_expires_at
    OR binding.cooldown_expires_at <>
      binding.granted_at + interval '15 minutes'
    OR binding.decision <> 'APPROVED'
    OR binding.decision_reason <> 'checker_approved_snapshot'
    OR binding.maker_requested_by = binding.decided_by
    OR binding.decided_by <> binding.granted_by
    OR binding.granted_by <> binding.created_by
    OR binding.created_by <> binding.signed_by
    OR binding.signed_by <> binding.intent_requested_by
    OR signing_key.event_type IS DISTINCT FROM 'REGISTERED'
    OR signing_key.event_created_at > NEW.received_at
    OR NEW.delivery_id <> expected_delivery_id
    OR NEW.network_received <> false
    OR NEW.external_receipt_verified <> false
    OR NEW.production_accepted <> false
    OR NEW.delivery_attempted <> false
    OR binding.decided_at < binding.request_created_at
    OR binding.decided_at >= binding.request_expires_at
    OR binding.granted_at < binding.decided_at
    OR binding.granted_at >= binding.request_expires_at
    OR binding.outbox_created_at < binding.granted_at
    OR binding.outbox_created_at >= binding.cooldown_expires_at
    OR binding.signed_at < binding.outbox_created_at
    OR binding.signed_at >= binding.cooldown_expires_at
    OR binding.intent_created_at < binding.signed_at
    OR binding.intent_created_at >= binding.cooldown_expires_at
    OR NEW.received_at < binding.intent_created_at
    OR NEW.received_at >= binding.cooldown_expires_at
    OR NEW.received_at < binding.signed_at - interval '5 seconds'
    OR NEW.received_at > binding.signed_at + interval '300 seconds'
    OR NEW.received_at < clock_timestamp() - interval '5 seconds'
    OR NEW.received_at > clock_timestamp() + interval '5 seconds' THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert receiver claim binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_receiver_claim_guard
  ON "shipment_apv_manifest_archive_alert_receiver_claims";
CREATE TRIGGER ship_apv_archive_alert_receiver_claim_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_receiver_claims"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_receiver_claim();
