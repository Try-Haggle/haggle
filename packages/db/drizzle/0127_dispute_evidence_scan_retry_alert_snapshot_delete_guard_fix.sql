CREATE OR REPLACE FUNCTION haggle_guard_dispute_scan_retry_alert_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'scan retry alert snapshots are immutable';
  END IF;
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true)
      IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'scan retry alert snapshots require controlled cleanup';
  END IF;
  RETURN OLD;
END;
$$;
