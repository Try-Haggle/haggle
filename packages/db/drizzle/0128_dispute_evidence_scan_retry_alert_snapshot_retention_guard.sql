CREATE OR REPLACE FUNCTION haggle_guard_dispute_scan_retry_alert_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  fixture_cleanup boolean := current_setting(
    'haggle.allow_test_fixture_cleanup', true
  ) = 'on';
  retention_cleanup boolean := current_setting(
    'haggle.allow_scan_retry_alert_snapshot_retention', true
  ) = 'on';
  completed_claim_exists boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'scan retry alert snapshots are immutable';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF fixture_cleanup THEN
    RETURN OLD;
  END IF;
  IF NOT retention_cleanup THEN
    RAISE EXCEPTION 'scan retry alert snapshots require controlled cleanup';
  END IF;
  IF OLD."expires_at" > now() THEN
    RAISE EXCEPTION 'scan retry alert snapshot has not expired';
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM "webhook_idempotency" w
     WHERE w."source" = OLD."source"
       AND w."idempotency_key" = OLD."delivery_id"
       AND w."status" = 'COMPLETED'
  ) INTO completed_claim_exists;
  IF NOT completed_claim_exists THEN
    RAISE EXCEPTION 'scan retry alert snapshot claim is unresolved';
  END IF;
  RETURN OLD;
END;
$$;
