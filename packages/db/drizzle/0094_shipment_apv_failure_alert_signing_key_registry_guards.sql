CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_signing_key()
RETURNS trigger AS $$
DECLARE
  expected_key_id text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV failure alert signing key is append-only';
  END IF;
  BEGIN
    expected_key_id := substring(encode(
      digest(decode(NEW.public_key_spki_base64, 'base64'), 'sha256'), 'hex') from 1 for 24);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'shipment APV failure alert signing key rejected';
  END;
  IF expected_key_id <> NEW.key_id THEN
    RAISE EXCEPTION 'shipment APV failure alert signing key binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_signing_key_guard
  ON "shipment_apv_failure_alert_signing_keys";
CREATE TRIGGER shipment_apv_failure_alert_signing_key_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_signing_keys"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_signing_key();

CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_signing_key_event()
RETURNS trigger AS $$
DECLARE
  signing_key record;
  prior_event record;
  expected_reason text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV failure alert signing key event is append-only';
  END IF;

  SELECT registered_by, registered_at INTO signing_key
  FROM shipment_apv_failure_alert_signing_keys WHERE key_id = NEW.key_id;
  SELECT event_type, created_at INTO prior_event
  FROM shipment_apv_failure_alert_signing_key_events
  WHERE key_id = NEW.key_id ORDER BY created_at DESC, id DESC LIMIT 1;
  expected_reason := CASE NEW.event_type
    WHEN 'REGISTERED' THEN 'ephemeral_test_key_registered'
    WHEN 'RETIRED' THEN 'ephemeral_test_key_retired'
    WHEN 'REVOKED' THEN 'ephemeral_test_key_revoked'
  END;

  IF signing_key.registered_by IS NULL
    OR signing_key.registered_by <> NEW.changed_by
    OR NEW.created_at < signing_key.registered_at
    OR NEW.reason <> expected_reason
    OR (prior_event.event_type IS NULL AND NEW.event_type <> 'REGISTERED')
    OR (prior_event.event_type IS NOT NULL AND (
      prior_event.event_type <> 'REGISTERED'
      OR NEW.event_type NOT IN ('RETIRED', 'REVOKED')
      OR NEW.created_at < prior_event.created_at)) THEN
    RAISE EXCEPTION 'shipment APV failure alert signing key event binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_signing_key_event_guard
  ON "shipment_apv_failure_alert_signing_key_events";
CREATE TRIGGER shipment_apv_failure_alert_signing_key_event_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_signing_key_events"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_signing_key_event();
