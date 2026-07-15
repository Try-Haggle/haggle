CREATE OR REPLACE FUNCTION guard_shipment_apv_failure_alert_receiver_claim_manifest_receipt()
RETURNS trigger AS $$
DECLARE
  latest record;
  current_entry_count integer;
  current_receipt_digests text[];
  expected_manifest_digest text;
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV receiver claim manifest receipt is append-only';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'haggle.shipment-apv-failure-alert.receiver-claim-manifest-receipt.v1', 0));

  SELECT COUNT(*)::int,
    COALESCE(array_agg(receipt_digest ORDER BY receipt_digest), ARRAY[]::text[])
  INTO current_entry_count, current_receipt_digests
  FROM (
    SELECT encode(digest(
      'haggle.shipment-apv-failure-alert.receiver-claim-receipt.v1:'
        || claim.delivery_id || ':' || claim.delivery_intent_id::text || ':'
        || claim.payload_signature_id::text || ':' || claim.payload_sha256 || ':'
        || claim.key_id || ':' || claim.status || ':'
        || to_char(claim.received_at AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'sha256'), 'hex') AS receipt_digest
    FROM shipment_apv_failure_alert_receiver_claims claim
    ORDER BY receipt_digest
    LIMIT 1001
  ) current_claims;

  expected_manifest_digest := encode(digest(
    'haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1:'
      || NEW.entry_count::text || ':' || array_to_string(NEW.receipt_digests, ','),
    'sha256'), 'hex');

  SELECT receipt.revision, receipt.manifest_digest
  INTO latest
  FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts receipt
  ORDER BY receipt.revision DESC LIMIT 1;

  IF current_entry_count > 1000
    OR NEW.entry_count <> current_entry_count
    OR NEW.receipt_digests <> current_receipt_digests
    OR NEW.manifest_digest <> expected_manifest_digest
    OR (latest.revision IS NULL
      AND (NEW.revision <> 1 OR NEW.previous_manifest_digest IS NOT NULL))
    OR (latest.revision IS NOT NULL
      AND (NEW.revision <> latest.revision + 1
        OR NEW.previous_manifest_digest IS DISTINCT FROM latest.manifest_digest))
    OR NEW.generated_at < clock_timestamp() - interval '30 seconds'
    OR NEW.generated_at > clock_timestamp() + interval '5 seconds'
    OR NEW.recorded_at < clock_timestamp() - interval '5 seconds'
    OR NEW.recorded_at > clock_timestamp() + interval '5 seconds' THEN
    RAISE EXCEPTION 'shipment APV receiver claim manifest receipt binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shipment_apv_failure_alert_receiver_claim_manifest_receipt_guard
  ON "shipment_apv_failure_alert_receiver_claim_manifest_receipts";
CREATE TRIGGER shipment_apv_failure_alert_receiver_claim_manifest_receipt_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_failure_alert_receiver_claim_manifest_receipts"
  FOR EACH ROW EXECUTE FUNCTION
    guard_shipment_apv_failure_alert_receiver_claim_manifest_receipt();
