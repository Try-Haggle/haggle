CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_payload_signature()
RETURNS trigger AS $$
DECLARE
  binding record;
  expected_key_id text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV failure alert payload signature is append-only';
  END IF;

  SELECT outbox.payload_sha256, outbox.created_by,
    delivery_grant.cooldown_expires_at
  INTO binding
  FROM shipment_apv_failure_alert_payload_outbox outbox
  JOIN shipment_apv_failure_alert_delivery_grants delivery_grant
    ON delivery_grant.id = outbox.delivery_grant_id
  WHERE outbox.id = NEW.payload_outbox_id;

  BEGIN
    expected_key_id := substring(encode(
      digest(decode(NEW.public_key_spki_base64, 'base64'), 'sha256'), 'hex') from 1 for 24);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'shipment APV failure alert signature key rejected';
  END;

  IF NOT FOUND
    OR binding.payload_sha256 <> NEW.payload_sha256
    OR binding.created_by <> NEW.signed_by
    OR clock_timestamp() >= binding.cooldown_expires_at
    OR expected_key_id <> NEW.key_id THEN
    RAISE EXCEPTION 'shipment APV failure alert payload signature binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_payload_signature_guard
  ON "shipment_apv_failure_alert_payload_signatures";
CREATE TRIGGER shipment_apv_failure_alert_payload_signature_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_payload_signatures"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_payload_signature();
