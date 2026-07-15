CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_cooldown_claim()
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
  RAISE EXCEPTION
    'shipment APV manifest archive alert cooldown claim mutation blocked';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_cooldown_claim_guard
  ON "shipment_apv_manifest_archive_alert_cooldown_claims";
CREATE TRIGGER ship_apv_archive_alert_cooldown_claim_guard
  BEFORE UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_cooldown_claims"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_cooldown_claim();

CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_delivery_grant()
RETURNS trigger AS $$
DECLARE
  binding record;
  cooldown record;
  binding_found boolean;
  cooldown_found boolean;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert delivery grants are append-only';
  END IF;

  SELECT decision.decision, decision.decision_reason, decision.decided_by,
    decision.request_state_fingerprint, decision.created_at AS decided_at,
    request.requested_by, request.expires_at
  INTO binding
  FROM shipment_apv_manifest_archive_alert_approval_decisions decision
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id
  WHERE decision.id = NEW.approval_decision_id;
  binding_found := FOUND;

  SELECT * INTO cooldown
  FROM shipment_apv_manifest_archive_alert_cooldown_claims
  WHERE state_fingerprint = NEW.state_fingerprint;
  cooldown_found := FOUND;

  IF NOT binding_found
    OR NOT cooldown_found
    OR binding.decision <> 'APPROVED'
    OR binding.decision_reason <> 'checker_approved_snapshot'
    OR binding.decided_by <> NEW.granted_by
    OR binding.requested_by = NEW.granted_by
    OR binding.request_state_fingerprint <> NEW.state_fingerprint
    OR NEW.granted_at < binding.decided_at
    OR binding.expires_at <= NEW.granted_at
    OR NEW.granted_at > clock_timestamp() + interval '1 minute'
    OR cooldown.grant_id <> NEW.id
    OR cooldown.claimed_at <> NEW.granted_at
    OR cooldown.expires_at <> NEW.cooldown_expires_at THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert delivery grant binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_delivery_grant_guard
  ON "shipment_apv_manifest_archive_alert_delivery_grants";
CREATE TRIGGER ship_apv_archive_alert_delivery_grant_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_delivery_grants"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_delivery_grant();
