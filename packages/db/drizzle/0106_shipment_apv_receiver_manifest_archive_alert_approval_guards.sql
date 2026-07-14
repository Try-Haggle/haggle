CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_approval()
RETURNS trigger AS $$
DECLARE
  ordered_reasons text[] := ARRAY[]::text[];
  reason text;
  allowed_reasons text[] := ARRAY[
    'archive_intent_binding_violation',
    'archive_intent_blocker_violation',
    'archive_intent_side_effect_violation',
    'archive_intent_timestamp_violation',
    'archive_source_limit_violation',
    'current_archive_intent_missing',
    'archive_intent_stale'
  ]::text[];
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV manifest archive alert approvals are append-only';
  END IF;

  FOREACH reason IN ARRAY allowed_reasons LOOP
    IF reason = ANY(NEW.preview_reasons) THEN
      ordered_reasons := array_append(ordered_reasons, reason);
    END IF;
  END LOOP;
  IF NEW.preview_reasons <> ordered_reasons
    OR (NEW.preview_action = 'review_warning'
      AND NEW.preview_severity <> 'warning')
    OR (NEW.preview_action = 'escalate_critical'
      AND NEW.preview_severity <> 'critical') THEN
    RAISE EXCEPTION 'shipment APV manifest archive alert approval binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_archive_alert_approval_guard
  ON "shipment_apv_manifest_archive_alert_approval_requests";
CREATE TRIGGER ship_apv_archive_alert_approval_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_manifest_archive_alert_approval_requests"
  FOR EACH ROW EXECUTE FUNCTION guard_ship_apv_archive_alert_approval();
