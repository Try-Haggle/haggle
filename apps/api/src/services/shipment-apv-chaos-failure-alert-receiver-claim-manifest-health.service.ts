import { sql, type Database } from "@haggle/db";

const FRESHNESS_SLA_SECONDS = 86_400;

type HealthRow = {
  receipt_count: unknown;
  latest_revision: unknown;
  latest_entry_count: unknown;
  current_source_entry_count: unknown;
  revision_gap_count: unknown;
  previous_mismatch_count: unknown;
  manifest_digest_mismatch_count: unknown;
  receipt_set_mismatch_count: unknown;
  unsafe_side_effect_count: unknown;
  timestamp_violation_count: unknown;
  source_limit_violation_count: unknown;
  source_covered: unknown;
  latest_receipt_age_seconds: unknown;
  observed_at: unknown;
};

function count(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_HEALTH_INVALID");
  }
  return parsed;
}

function optionalCount(value: unknown) {
  return value === null || value === undefined ? null : count(value);
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_HEALTH_INVALID");
  }
  return parsed.toISOString();
}

export async function getShipmentApvFailureAlertReceiverClaimManifestHealth(
  db: Pick<Database, "execute">,
) {
  const rows = await db.execute(sql`WITH source_receipt_digests AS (
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
    ), source AS (
      SELECT COUNT(*)::int AS entry_count,
        COALESCE(array_agg(receipt_digest ORDER BY receipt_digest), ARRAY[]::text[])
          AS receipt_digests
      FROM source_receipt_digests
    ), source_manifest AS (
      SELECT source.*,
        encode(digest(
          'haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1:'
            || source.entry_count::text || ':'
            || array_to_string(source.receipt_digests, ','),
          'sha256'), 'hex') AS manifest_digest
      FROM source
    ), ordered AS (
      SELECT receipt.*,
        row_number() OVER (ORDER BY receipt.revision) AS expected_revision,
        lag(receipt.manifest_digest) OVER (ORDER BY receipt.revision)
          AS expected_previous_manifest_digest
      FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts receipt
    ), diagnostics AS (
      SELECT ordered.*,
        ordered.revision <> ordered.expected_revision AS revision_gap,
        CASE WHEN ordered.expected_revision = 1
          THEN ordered.previous_manifest_digest IS NOT NULL
          ELSE ordered.previous_manifest_digest IS DISTINCT FROM
            ordered.expected_previous_manifest_digest END AS previous_mismatch,
        ordered.manifest_digest IS DISTINCT FROM encode(digest(
          'haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1:'
            || ordered.entry_count::text || ':'
            || array_to_string(ordered.receipt_digests, ','),
          'sha256'), 'hex') AS manifest_digest_mismatch,
        cardinality(ordered.receipt_digests) <> ordered.entry_count
          OR EXISTS (SELECT 1 FROM unnest(ordered.receipt_digests) digest_value
            WHERE digest_value !~ '^[0-9a-f]{64}$')
          OR ordered.receipt_digests <> ARRAY(
            SELECT digest_value FROM unnest(ordered.receipt_digests) digest_value
            ORDER BY digest_value) AS receipt_set_mismatch,
        ordered.status IS DISTINCT FROM 'PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN'
          OR ordered.health_status IS DISTINCT FROM 'healthy'
          OR ordered.contains_raw_identifiers IS DISTINCT FROM false
          OR ordered.external_archive IS DISTINCT FROM false
          OR ordered.network_delivered IS DISTINCT FROM false
          OR ordered.production_accepted IS DISTINCT FROM false AS unsafe_side_effect,
        ordered.generated_at > ordered.recorded_at + interval '5 seconds'
          OR ordered.generated_at > clock_timestamp() + interval '5 seconds'
          OR ordered.recorded_at > clock_timestamp() + interval '5 seconds'
          AS timestamp_violation
      FROM ordered
    ), latest AS (
      SELECT * FROM ordered ORDER BY revision DESC LIMIT 1
    )
    SELECT (SELECT COUNT(*)::int FROM diagnostics) AS receipt_count,
      (SELECT revision FROM latest) AS latest_revision,
      (SELECT entry_count FROM latest) AS latest_entry_count,
      source_manifest.entry_count AS current_source_entry_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE revision_gap)
        AS revision_gap_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE previous_mismatch)
        AS previous_mismatch_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE manifest_digest_mismatch)
        AS manifest_digest_mismatch_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE receipt_set_mismatch)
        AS receipt_set_mismatch_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE unsafe_side_effect)
        AS unsafe_side_effect_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE timestamp_violation)
        AS timestamp_violation_count,
      CASE WHEN source_manifest.entry_count > 1000 THEN 1 ELSE 0 END
        AS source_limit_violation_count,
      COALESCE((SELECT latest.manifest_digest = source_manifest.manifest_digest
        AND latest.entry_count = source_manifest.entry_count
        AND latest.receipt_digests = source_manifest.receipt_digests FROM latest), false)
        AS source_covered,
      (SELECT floor(greatest(0, extract(epoch FROM
        clock_timestamp() - latest.recorded_at)))::int FROM latest)
        AS latest_receipt_age_seconds,
      clock_timestamp() AS observed_at
    FROM source_manifest`);
  const row = (rows as unknown as HealthRow[])[0];
  if (!row || typeof row.source_covered !== "boolean") {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_HEALTH_INVALID");
  }

  const totals = {
    receipts: count(row.receipt_count),
    latestRevision: optionalCount(row.latest_revision),
    latestReceiptEntries: optionalCount(row.latest_entry_count),
    currentSourceEntries: count(row.current_source_entry_count),
  };
  const violations = {
    revisionGap: count(row.revision_gap_count),
    previousMismatch: count(row.previous_mismatch_count),
    manifestDigest: count(row.manifest_digest_mismatch_count),
    receiptSet: count(row.receipt_set_mismatch_count),
    unsafeSideEffect: count(row.unsafe_side_effect_count),
    timestamp: count(row.timestamp_violation_count),
    sourceLimit: count(row.source_limit_violation_count),
  };
  const criticalCount = Object.values(violations).reduce((sum, value) => sum + value, 0);
  const latestReceiptAgeSeconds = optionalCount(row.latest_receipt_age_seconds);
  const stale = latestReceiptAgeSeconds !== null
    && latestReceiptAgeSeconds > FRESHNESS_SLA_SECONDS;
  const sourceCovered = row.source_covered;
  const status = criticalCount > 0 ? "critical" as const
    : !sourceCovered || stale ? "warning" as const : "healthy" as const;

  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-health-v1",
    status,
    totals,
    violations,
    criticalCount,
    coverage: { currentSourceCovered: sourceCovered,
      missingCurrentReceipt: !sourceCovered },
    freshness: { slaSeconds: FRESHNESS_SLA_SECONDS,
      latestReceiptAgeSeconds, stale },
    containsRawIdentifiers: false,
    externalArchive: false,
    networkDelivered: false,
    productionAccepted: false,
    observedAt: iso(row.observed_at),
  };
}
