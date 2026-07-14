CREATE OR REPLACE FUNCTION guard_ship_apv_archive_alert_approval()
RETURNS trigger AS $$
DECLARE
  ordered_reasons text[] := ARRAY[]::text[];
  reason text;
  critical_reasons text[] := ARRAY[
    'archive_intent_binding_violation',
    'archive_intent_blocker_violation',
    'archive_intent_side_effect_violation',
    'archive_intent_timestamp_violation',
    'archive_source_limit_violation'
  ]::text[];
  warning_reasons text[] := ARRAY[
    'current_archive_intent_missing',
    'archive_intent_stale'
  ]::text[];
  allowed_reasons text[] := critical_reasons || warning_reasons;
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
      AND (NEW.preview_severity <> 'warning'
        OR NOT (NEW.preview_reasons <@ warning_reasons)))
    OR (NEW.preview_action = 'escalate_critical'
      AND (NEW.preview_severity <> 'critical'
        OR NOT (NEW.preview_reasons && critical_reasons))) THEN
    RAISE EXCEPTION 'shipment APV manifest archive alert approval binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
