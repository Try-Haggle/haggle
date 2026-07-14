CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_delivery_intent()
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
    RAISE EXCEPTION 'shipment APV failure alert delivery intent is append-only';
  END IF;

  SELECT signature.payload_outbox_id, signature.payload_sha256,
    signature.key_id, signature.signed_by, delivery_grant.cooldown_expires_at
  INTO binding
  FROM shipment_apv_failure_alert_payload_signatures signature
  JOIN shipment_apv_failure_alert_payload_outbox outbox
    ON outbox.id = signature.payload_outbox_id
  JOIN shipment_apv_failure_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  WHERE signature.id = NEW.payload_signature_id;

  SELECT key_event.event_type INTO signing_key
  FROM shipment_apv_failure_alert_signing_key_events key_event
  WHERE key_event.key_id = NEW.key_id
    AND key_event.created_at <= NEW.created_at
  ORDER BY key_event.created_at DESC, key_event.id DESC LIMIT 1;

  IF binding.payload_outbox_id IS NULL
    OR binding.payload_outbox_id <> NEW.payload_outbox_id
    OR binding.payload_sha256 <> NEW.payload_sha256
    OR binding.key_id <> NEW.key_id
    OR binding.signed_by <> NEW.requested_by
    OR clock_timestamp() >= binding.cooldown_expires_at
    OR signing_key.event_type <> 'REGISTERED' THEN
    RAISE EXCEPTION 'shipment APV failure alert delivery intent binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_delivery_intent_guard
  ON "shipment_apv_failure_alert_delivery_intents";
CREATE TRIGGER shipment_apv_failure_alert_delivery_intent_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_delivery_intents"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_delivery_intent();
