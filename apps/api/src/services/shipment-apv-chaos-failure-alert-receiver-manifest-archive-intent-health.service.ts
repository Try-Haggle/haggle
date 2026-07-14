import { sql, type Database } from "@haggle/db";

export const SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_SCHEMA_VERSION =
  "shipment-apv-failure-alert-receiver-manifest-archive-health-v1";
export const SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS =
  86_400;

type HealthRow = {
  intent_count: unknown;
  latest_receipt_revision: unknown;
  latest_intent_revision: unknown;
  current_source_entry_count: unknown;
  binding_violation_count: unknown;
  blocker_violation_count: unknown;
  unsafe_side_effect_count: unknown;
  timestamp_violation_count: unknown;
  source_limit_violation_count: unknown;
  current_receipt_intent_covered: unknown;
  latest_intent_age_seconds: unknown;
  observed_at: unknown;
};

function count(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_INVALID");
  }
  return parsed;
}

function optionalCount(value: unknown) {
  return value === null || value === undefined ? null : count(value);
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_INVALID");
  }
  return parsed.toISOString();
}

export async function getShipmentApvFailureAlertReceiverManifestArchiveIntentHealth(
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
      ORDER BY receipt_digest LIMIT 1001
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
    ), latest_receipt AS (
      SELECT receipt.*
      FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts receipt
      ORDER BY receipt.revision DESC LIMIT 1
    ), diagnostics AS (
      SELECT intent.*,
        receipt.id IS NULL
          OR intent.manifest_revision IS DISTINCT FROM receipt.revision
          OR intent.manifest_digest IS DISTINCT FROM receipt.manifest_digest
          AS binding_violation,
        intent.blocking_reasons IS DISTINCT FROM ARRAY[
          'independent_worm_endpoint_missing',
          'archive_credential_missing',
          'archive_signing_key_missing',
          'archive_delivery_worker_missing']::text[] AS blocker_violation,
        intent.status IS DISTINCT FROM
          'BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN'
          OR intent.http_request_created IS DISTINCT FROM false
          OR intent.delivery_attempted IS DISTINCT FROM false
          OR intent.external_receipt_verified IS DISTINCT FROM false
          OR intent.production_accepted IS DISTINCT FROM false
          AS unsafe_side_effect,
        intent.created_at > clock_timestamp() + interval '5 seconds'
          AS timestamp_violation
      FROM shipment_apv_failure_alert_receiver_manifest_archive_intents intent
      LEFT JOIN shipment_apv_failure_alert_receiver_claim_manifest_receipts receipt
        ON receipt.id = intent.manifest_receipt_id
    ), current_intent AS (
      SELECT intent.*
      FROM latest_receipt receipt
      JOIN source_manifest source
        ON source.entry_count <= 1000
        AND receipt.entry_count = source.entry_count
        AND receipt.receipt_digests = source.receipt_digests
        AND receipt.manifest_digest = source.manifest_digest
      JOIN shipment_apv_failure_alert_receiver_manifest_archive_intents intent
        ON intent.manifest_receipt_id = receipt.id
      LIMIT 1
    )
    SELECT (SELECT COUNT(*)::int FROM diagnostics) AS intent_count,
      (SELECT revision FROM latest_receipt) AS latest_receipt_revision,
      (SELECT manifest_revision FROM current_intent) AS latest_intent_revision,
      source_manifest.entry_count AS current_source_entry_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE binding_violation)
        AS binding_violation_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE blocker_violation)
        AS blocker_violation_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE unsafe_side_effect)
        AS unsafe_side_effect_count,
      (SELECT COUNT(*)::int FROM diagnostics WHERE timestamp_violation)
        AS timestamp_violation_count,
      CASE WHEN source_manifest.entry_count > 1000 THEN 1 ELSE 0 END
        AS source_limit_violation_count,
      EXISTS (SELECT 1 FROM current_intent) AS current_receipt_intent_covered,
      (SELECT floor(greatest(0, extract(epoch FROM
        clock_timestamp() - current_intent.created_at)))::int FROM current_intent)
        AS latest_intent_age_seconds,
      clock_timestamp() AS observed_at
    FROM source_manifest`);
  const row = (rows as unknown as HealthRow[])[0];
  if (!row || typeof row.current_receipt_intent_covered !== "boolean") {
    throw new Error(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_INVALID");
  }

  const totals = {
    intents: count(row.intent_count),
    latestReceiptRevision: optionalCount(row.latest_receipt_revision),
    latestIntentRevision: optionalCount(row.latest_intent_revision),
    currentSourceEntries: count(row.current_source_entry_count),
  };
  const violations = {
    binding: count(row.binding_violation_count),
    blockers: count(row.blocker_violation_count),
    unsafeSideEffect: count(row.unsafe_side_effect_count),
    timestamp: count(row.timestamp_violation_count),
    sourceLimit: count(row.source_limit_violation_count),
  };
  const criticalCount = Object.values(violations).reduce((sum, value) => sum + value, 0);
  const latestIntentAgeSeconds = optionalCount(row.latest_intent_age_seconds);
  const stale = latestIntentAgeSeconds !== null
    && latestIntentAgeSeconds
      > SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS;
  const covered = row.current_receipt_intent_covered;
  const status = criticalCount > 0 ? "critical" as const
    : !covered || stale ? "warning" as const : "healthy" as const;

  return {
    schemaVersion:
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_HEALTH_SCHEMA_VERSION,
    status,
    totals,
    violations,
    criticalCount,
    coverage: { currentReceiptIntentCovered: covered,
      missingCurrentArchiveIntent: !covered },
    freshness: {
      slaSeconds:
        SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_FRESHNESS_SLA_SECONDS,
      latestIntentAgeSeconds, stale },
    containsRawIdentifiers: false,
    httpRequestCreated: false,
    networkDelivered: false,
    externalReceiptVerified: false,
    productionAccepted: false,
    observedAt: iso(row.observed_at),
  };
}
