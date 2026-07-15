CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_cooldown_claim_mutation()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.expires_at <= clock_timestamp()
    AND NEW.state_fingerprint = OLD.state_fingerprint
    AND NEW.grant_id <> OLD.grant_id
    AND NEW.claimed_at >= OLD.expires_at
    AND NEW.expires_at = NEW.claimed_at + interval '15 minutes' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'shipment APV failure alert cooldown claim mutation blocked';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_cooldown_claims_guard
  ON "shipment_apv_failure_alert_cooldown_claims";
CREATE TRIGGER shipment_apv_failure_alert_cooldown_claims_guard
  BEFORE UPDATE OR DELETE ON "shipment_apv_failure_alert_cooldown_claims"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_cooldown_claim_mutation();

CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_delivery_grant()
RETURNS trigger AS $$
DECLARE
  binding record;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV failure alert delivery grants are append-only';
  END IF;

  SELECT decision.decision, decision.decided_by, decision.request_state_fingerprint,
    request.requested_by, request.expires_at
  INTO binding
  FROM shipment_apv_failure_alert_approval_decisions decision
  JOIN shipment_apv_failure_alert_approval_requests request
    ON request.id = decision.approval_request_id
  WHERE decision.id = NEW.approval_decision_id;

  IF NOT FOUND
    OR binding.decision <> 'APPROVED'
    OR binding.decided_by <> NEW.granted_by
    OR binding.requested_by = NEW.granted_by
    OR binding.request_state_fingerprint <> NEW.state_fingerprint
    OR clock_timestamp() >= binding.expires_at THEN
    RAISE EXCEPTION 'shipment APV failure alert delivery grant binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_delivery_grants_guard
  ON "shipment_apv_failure_alert_delivery_grants";
CREATE TRIGGER shipment_apv_failure_alert_delivery_grants_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "shipment_apv_failure_alert_delivery_grants"
  FOR EACH ROW EXECUTE FUNCTION guard_shipment_apv_failure_alert_delivery_grant();
