import { sql, type Database } from "@haggle/db";

type HealthRow = {
  total_claims: unknown;
  claims_last_24h: unknown;
  claims_older_30d: unknown;
  binding_failure_count: unknown;
  delivery_id_mismatch_count: unknown;
  freshness_violation_count: unknown;
  unsafe_side_effect_count: unknown;
  observed_at: unknown;
};

function count(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_HEALTH_INVALID");
  }
  return parsed;
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_HEALTH_INVALID");
  }
  return parsed.toISOString();
}

export async function getShipmentApvFailureAlertReceiverClaimHealth(
  db: Pick<Database, "execute">,
) {
  const rows = await db.execute(sql`WITH diagnostics AS (
      SELECT claim.received_at,
        intent.id IS NULL OR signature.id IS NULL
          OR claim.payload_signature_id IS DISTINCT FROM intent.payload_signature_id
          OR claim.payload_signature_id IS DISTINCT FROM signature.id
          OR claim.payload_sha256 IS DISTINCT FROM intent.payload_sha256
          OR claim.payload_sha256 IS DISTINCT FROM signature.payload_sha256
          OR claim.key_id IS DISTINCT FROM intent.key_id
          OR claim.key_id IS DISTINCT FROM signature.key_id AS binding_failure,
        claim.delivery_id IS DISTINCT FROM encode(digest(
          'haggle.shipment-apv-failure-alert.receiver-delivery.v1:'
            || claim.delivery_intent_id::text || ':' || claim.payload_sha256,
          'sha256'), 'hex') AS delivery_id_mismatch,
        signature.id IS NULL OR claim.received_at < signature.signed_at - interval '5 seconds'
          OR claim.received_at > signature.signed_at + interval '300 seconds'
          AS freshness_violation,
        claim.status IS DISTINCT FROM 'VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN'
          OR claim.network_received IS DISTINCT FROM false
          OR claim.production_accepted IS DISTINCT FROM false
          OR intent.status IS DISTINCT FROM 'BLOCKED_CONFIGURATION_DRY_RUN'
          OR intent.http_request_created IS DISTINCT FROM false
          OR intent.delivery_attempted IS DISTINCT FROM false AS unsafe_side_effect
      FROM shipment_apv_failure_alert_receiver_claims claim
      LEFT JOIN shipment_apv_failure_alert_delivery_intents intent
        ON intent.id = claim.delivery_intent_id
      LEFT JOIN shipment_apv_failure_alert_payload_signatures signature
        ON signature.id = claim.payload_signature_id
    )
    SELECT COUNT(*) AS total_claims,
      COUNT(*) FILTER (WHERE received_at >= clock_timestamp() - interval '24 hours')
        AS claims_last_24h,
      COUNT(*) FILTER (WHERE received_at < clock_timestamp() - interval '30 days')
        AS claims_older_30d,
      COUNT(*) FILTER (WHERE binding_failure) AS binding_failure_count,
      COUNT(*) FILTER (WHERE delivery_id_mismatch) AS delivery_id_mismatch_count,
      COUNT(*) FILTER (WHERE freshness_violation) AS freshness_violation_count,
      COUNT(*) FILTER (WHERE unsafe_side_effect) AS unsafe_side_effect_count,
      clock_timestamp() AS observed_at
    FROM diagnostics`);
  const row = (rows as unknown as HealthRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_HEALTH_INVALID");

  const totals = {
    claims: count(row.total_claims),
    last24Hours: count(row.claims_last_24h),
    olderThan30Days: count(row.claims_older_30d),
  };
  const violations = {
    binding: count(row.binding_failure_count),
    deliveryId: count(row.delivery_id_mismatch_count),
    freshness: count(row.freshness_violation_count),
    unsafeSideEffect: count(row.unsafe_side_effect_count),
  };
  const criticalCount = Object.values(violations).reduce((sum, value) => sum + value, 0);

  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-health-v1",
    status: criticalCount === 0 ? "healthy" as const : "critical" as const,
    totals,
    violations,
    criticalCount,
    retention: { policy: "UNSET_PRESERVE" as const, automaticDeletion: false },
    networkReceipt: false,
    productionAccepted: false,
    observedAt: iso(row.observed_at),
  };
}
