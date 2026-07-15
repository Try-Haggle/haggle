CREATE OR REPLACE FUNCTION validate_shipment_apv_failure_alert_approval_decision_binding()
RETURNS trigger AS $$
DECLARE
  request_row shipment_apv_failure_alert_approval_requests%ROWTYPE;
BEGIN
  SELECT * INTO request_row
  FROM shipment_apv_failure_alert_approval_requests
  WHERE id = NEW.approval_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment APV failure alert approval request not found';
  END IF;
  IF NEW.decided_by = request_row.requested_by THEN
    RAISE EXCEPTION 'shipment APV failure alert maker-checker separation required';
  END IF;
  IF NEW.request_state_fingerprint <> request_row.state_fingerprint THEN
    RAISE EXCEPTION 'shipment APV failure alert decision fingerprint mismatch';
  END IF;
  IF clock_timestamp() >= request_row.expires_at THEN
    RAISE EXCEPTION 'shipment APV failure alert approval request expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_approval_decisions_binding_guard
  ON "shipment_apv_failure_alert_approval_decisions";

CREATE TRIGGER shipment_apv_failure_alert_approval_decisions_binding_guard
  BEFORE INSERT ON "shipment_apv_failure_alert_approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION validate_shipment_apv_failure_alert_approval_decision_binding();
