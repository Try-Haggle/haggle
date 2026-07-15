CREATE OR REPLACE FUNCTION prevent_shipment_apv_failure_alert_approval_decision_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'shipment APV failure alert approval decisions are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_approval_decisions_append_only
  ON "shipment_apv_failure_alert_approval_decisions";

CREATE TRIGGER shipment_apv_failure_alert_approval_decisions_append_only
  BEFORE UPDATE OR DELETE ON "shipment_apv_failure_alert_approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION prevent_shipment_apv_failure_alert_approval_decision_mutation();
