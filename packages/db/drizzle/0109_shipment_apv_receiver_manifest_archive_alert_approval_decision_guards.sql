CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_approval_decision()
RETURNS trigger AS $$
DECLARE
  request_record shipment_apv_manifest_archive_alert_approval_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert approval decisions are append-only';
  END IF;

  SELECT * INTO request_record
  FROM shipment_apv_manifest_archive_alert_approval_requests
  WHERE id = NEW.approval_request_id;
  IF NOT FOUND
    OR request_record.requested_by = NEW.decided_by
    OR request_record.state_fingerprint <> NEW.request_state_fingerprint
    OR request_record.expires_at <= NEW.created_at
    OR (NEW.decision = 'APPROVED'
      AND NEW.decision_reason <> 'checker_approved_snapshot')
    OR (NEW.decision = 'REJECTED'
      AND NEW.decision_reason <> 'checker_rejected_snapshot') THEN
    RAISE EXCEPTION
      'shipment APV manifest archive alert approval decision binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_approval_decision_guard
  ON "shipment_apv_manifest_archive_alert_approval_decisions";
CREATE TRIGGER ship_apv_archive_alert_approval_decision_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_approval_decisions"
  FOR EACH ROW EXECUTE FUNCTION
    guard_ship_apv_archive_alert_approval_decision();
