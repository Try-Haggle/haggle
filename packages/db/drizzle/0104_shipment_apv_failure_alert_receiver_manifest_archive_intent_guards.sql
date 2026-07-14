CREATE OR REPLACE FUNCTION guard_ship_apv_receiver_manifest_archive_intent()
RETURNS trigger AS $$
DECLARE
  receipt record;
  current_entry_count integer;
  current_receipt_digests text[];
  current_manifest_digest text;
  required_blockers text[] := ARRAY[
    'independent_worm_endpoint_missing',
    'archive_credential_missing',
    'archive_signing_key_missing',
    'archive_delivery_worker_missing'
  ]::text[];
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('haggle.allow_test_fixture_cleanup', true) = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'shipment APV receiver manifest archive intent is append-only';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    'haggle.shipment-apv-failure-alert.receiver-claim-manifest-receipt.v1', 0));

  SELECT manifest_receipt.id, manifest_receipt.revision,
    manifest_receipt.manifest_digest, manifest_receipt.entry_count,
    manifest_receipt.receipt_digests
  INTO receipt
  FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts manifest_receipt
  WHERE manifest_receipt.id = NEW.manifest_receipt_id
    AND manifest_receipt.revision = (
      SELECT MAX(latest.revision)
      FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts latest)
  LIMIT 1;

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

  current_manifest_digest := encode(digest(
    'haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1:'
      || current_entry_count::text || ':'
      || array_to_string(current_receipt_digests, ','),
    'sha256'), 'hex');

  IF receipt.id IS NULL
    OR current_entry_count > 1000
    OR receipt.entry_count <> current_entry_count
    OR receipt.receipt_digests <> current_receipt_digests
    OR receipt.manifest_digest <> current_manifest_digest
    OR NEW.manifest_revision <> receipt.revision
    OR NEW.manifest_digest <> receipt.manifest_digest
    OR NEW.status <> 'BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN'
    OR NEW.blocking_reasons <> required_blockers
    OR NEW.http_request_created <> false
    OR NEW.delivery_attempted <> false
    OR NEW.external_receipt_verified <> false
    OR NEW.production_accepted <> false
    OR NEW.created_at < clock_timestamp() - interval '5 seconds'
    OR NEW.created_at > clock_timestamp() + interval '5 seconds' THEN
    RAISE EXCEPTION 'shipment APV receiver manifest archive intent binding rejected';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ship_apv_receiver_manifest_archive_intent_guard
  ON "shipment_apv_failure_alert_receiver_manifest_archive_intents";
CREATE TRIGGER ship_apv_receiver_manifest_archive_intent_guard
  BEFORE INSERT OR UPDATE OR DELETE
  ON "shipment_apv_failure_alert_receiver_manifest_archive_intents"
  FOR EACH ROW EXECUTE FUNCTION
    guard_ship_apv_receiver_manifest_archive_intent();
