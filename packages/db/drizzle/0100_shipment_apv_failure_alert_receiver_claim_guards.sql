CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_receiver_claim()
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
    RAISE EXCEPTION 'shipment APV failure alert receiver claim is append-only';
  END IF;

  SELECT intent.payload_signature_id, intent.payload_sha256, intent.key_id,
    intent.status AS intent_status, intent.http_request_created,
    intent.delivery_attempted, signature.signed_at
  INTO binding
  FROM shipment_apv_failure_alert_delivery_intents intent
  JOIN shipment_apv_failure_alert_payload_signatures signature
    ON signature.id = intent.payload_signature_id
  WHERE intent.id = NEW.delivery_intent_id;

  SELECT event.event_type INTO signing_key
  FROM shipment_apv_failure_alert_signing_key_events event
  WHERE event.key_id = NEW.key_id
  ORDER BY event.created_at DESC, event.id DESC LIMIT 1;

  expected_delivery_id := encode(digest(
    'haggle.shipment-apv-failure-alert.receiver-delivery.v1:'
      || NEW.delivery_intent_id::text || ':' || NEW.payload_sha256,
    'sha256'), 'hex');

  IF binding.payload_signature_id IS NULL
    OR binding.payload_signature_id <> NEW.payload_signature_id
    OR binding.payload_sha256 <> NEW.payload_sha256
    OR binding.key_id <> NEW.key_id
    OR binding.intent_status <> 'BLOCKED_CONFIGURATION_DRY_RUN'
    OR binding.http_request_created <> false
    OR binding.delivery_attempted <> false
    OR signing_key.event_type <> 'REGISTERED'
    OR NEW.delivery_id <> expected_delivery_id
    OR clock_timestamp() < binding.signed_at - interval '5 seconds'
    OR clock_timestamp() > binding.signed_at + interval '300 seconds'
    OR NEW.received_at < clock_timestamp() - interval '5 seconds'
    OR NEW.received_at > clock_timestamp() + interval '5 seconds' THEN
    RAISE EXCEPTION 'shipment APV failure alert receiver claim binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_receiver_claim_guard
  ON "shipment_apv_failure_alert_receiver_claims";
CREATE TRIGGER shipment_apv_failure_alert_receiver_claim_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_receiver_claims"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_receiver_claim();
