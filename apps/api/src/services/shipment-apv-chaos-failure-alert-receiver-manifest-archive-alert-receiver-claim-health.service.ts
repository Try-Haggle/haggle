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

const INVALID =
  "SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_HEALTH_INVALID";

function count(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(INVALID);
  return parsed;
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(INVALID);
  return parsed.toISOString();
}

export async function
getShipmentApvReceiverManifestArchiveAlertReceiverClaimHealth(
  db: Pick<Database, "execute">,
) {
  const rows = await db.execute(sql`WITH diagnostics AS (
      SELECT claim.received_at,
        intent.id IS NULL OR signature.id IS NULL OR outbox.id IS NULL
          OR delivery_grant.id IS NULL OR cooldown.grant_id IS NULL
          OR decision.id IS NULL OR request.id IS NULL OR signing_key.key_id IS NULL
          OR claim.payload_signature_id IS DISTINCT FROM intent.payload_signature_id
          OR claim.payload_signature_id IS DISTINCT FROM signature.id
          OR claim.payload_outbox_id IS DISTINCT FROM intent.payload_outbox_id
          OR claim.payload_outbox_id IS DISTINCT FROM signature.payload_outbox_id
          OR claim.payload_outbox_id IS DISTINCT FROM outbox.id
          OR claim.payload_sha256 IS DISTINCT FROM intent.payload_sha256
          OR claim.payload_sha256 IS DISTINCT FROM signature.payload_sha256
          OR claim.payload_sha256 IS DISTINCT FROM outbox.payload_sha256
          OR claim.key_id IS DISTINCT FROM intent.key_id
          OR claim.key_id IS DISTINCT FROM signature.key_id
          OR signature.public_key_spki_base64 IS DISTINCT FROM
            signing_key.public_key_spki_base64
          OR signature.signing_domain IS DISTINCT FROM
            'haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.payload-sha256.v1'
          OR signature.algorithm IS DISTINCT FROM 'Ed25519'
          OR outbox.delivery_grant_id IS DISTINCT FROM delivery_grant.id
          OR delivery_grant.approval_decision_id IS DISTINCT FROM decision.id
          OR decision.approval_request_id IS DISTINCT FROM request.id
          OR outbox.state_fingerprint IS DISTINCT FROM
            delivery_grant.state_fingerprint
          OR decision.request_state_fingerprint IS DISTINCT FROM
            delivery_grant.state_fingerprint
          OR request.state_fingerprint IS DISTINCT FROM
            delivery_grant.state_fingerprint
          OR cooldown.grant_id IS DISTINCT FROM delivery_grant.id
          OR cooldown.claimed_at IS DISTINCT FROM delivery_grant.granted_at
          OR cooldown.expires_at IS DISTINCT FROM
            delivery_grant.cooldown_expires_at
          OR cooldown.expires_at IS DISTINCT FROM
            delivery_grant.granted_at + interval '15 minutes'
          OR request.requested_by = decision.decided_by
          OR decision.decided_by IS DISTINCT FROM delivery_grant.granted_by
          OR delivery_grant.granted_by IS DISTINCT FROM outbox.created_by
          OR outbox.created_by IS DISTINCT FROM signature.signed_by
          OR signature.signed_by IS DISTINCT FROM intent.requested_by
          OR key_event.event_type IS DISTINCT FROM 'REGISTERED'
          AS binding_failure,
        claim.delivery_id IS DISTINCT FROM encode(digest(
          'haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.receiver-delivery.v1:'
            || claim.delivery_intent_id::text || ':' || claim.payload_sha256,
          'sha256'), 'hex') AS delivery_id_mismatch,
        signature.id IS NULL
          OR decision.created_at < request.created_at
          OR decision.created_at >= request.expires_at
          OR delivery_grant.granted_at < decision.created_at
          OR delivery_grant.granted_at >= request.expires_at
          OR outbox.created_at < delivery_grant.granted_at
          OR outbox.created_at >= delivery_grant.cooldown_expires_at
          OR signature.signed_at < outbox.created_at
          OR signature.signed_at >= delivery_grant.cooldown_expires_at
          OR intent.created_at < signature.signed_at
          OR intent.created_at >= delivery_grant.cooldown_expires_at
          OR claim.received_at < intent.created_at
          OR claim.received_at >= delivery_grant.cooldown_expires_at
          OR claim.received_at < signature.signed_at - interval '5 seconds'
          OR claim.received_at > signature.signed_at + interval '300 seconds'
          AS freshness_violation,
        claim.status IS DISTINCT FROM
            'VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN'
          OR claim.network_received IS DISTINCT FROM false
          OR claim.external_receipt_verified IS DISTINCT FROM false
          OR claim.production_accepted IS DISTINCT FROM false
          OR claim.delivery_attempted IS DISTINCT FROM false
          OR intent.status IS DISTINCT FROM 'BLOCKED_CONFIGURATION_DRY_RUN'
          OR intent.blocking_reasons IS DISTINCT FROM ARRAY[
            'independent_trust_anchor_missing',
            'receiver_endpoint_missing',
            'receiver_credential_missing'
          ]::text[]
          OR intent.http_request_created IS DISTINCT FROM false
          OR intent.delivery_attempted IS DISTINCT FROM false
          OR signature.status IS DISTINCT FROM 'SIGNED_DRY_RUN'
          OR outbox.status IS DISTINCT FROM 'UNSIGNED_DRY_RUN'
          OR delivery_grant.status IS DISTINCT FROM 'GRANTED_DRY_RUN'
          OR decision.decision IS DISTINCT FROM 'APPROVED'
          OR decision.decision_reason IS DISTINCT FROM
            'checker_approved_snapshot'
          OR request.preview_schema_version IS DISTINCT FROM
            'shipment-apv-failure-alert-receiver-manifest-archive-alert-preview-v1'
          AS unsafe_side_effect
      FROM shipment_apv_manifest_archive_alert_receiver_claims claim
      LEFT JOIN shipment_apv_manifest_archive_alert_delivery_intents intent
        ON intent.id = claim.delivery_intent_id
      LEFT JOIN shipment_apv_manifest_archive_alert_payload_signatures signature
        ON signature.id = claim.payload_signature_id
      LEFT JOIN shipment_apv_manifest_archive_alert_payload_outbox outbox
        ON outbox.id = claim.payload_outbox_id
      LEFT JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
        ON delivery_grant.id = outbox.delivery_grant_id
      LEFT JOIN shipment_apv_manifest_archive_alert_cooldown_claims cooldown
        ON cooldown.state_fingerprint = delivery_grant.state_fingerprint
      LEFT JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
        ON decision.id = delivery_grant.approval_decision_id
      LEFT JOIN shipment_apv_manifest_archive_alert_approval_requests request
        ON request.id = decision.approval_request_id
      LEFT JOIN shipment_apv_failure_alert_signing_keys signing_key
        ON signing_key.key_id = claim.key_id
      LEFT JOIN LATERAL (
        SELECT event.event_type
        FROM shipment_apv_failure_alert_signing_key_events event
        WHERE event.key_id = claim.key_id
          AND event.created_at <= signature.signed_at
        ORDER BY event.created_at DESC, event.id DESC LIMIT 1
      ) key_event ON true
    )
    SELECT COUNT(*) AS total_claims,
      COUNT(*) FILTER (
        WHERE received_at >= clock_timestamp() - interval '24 hours')
        AS claims_last_24h,
      COUNT(*) FILTER (
        WHERE received_at < clock_timestamp() - interval '30 days')
        AS claims_older_30d,
      COUNT(*) FILTER (WHERE binding_failure) AS binding_failure_count,
      COUNT(*) FILTER (WHERE delivery_id_mismatch)
        AS delivery_id_mismatch_count,
      COUNT(*) FILTER (WHERE freshness_violation)
        AS freshness_violation_count,
      COUNT(*) FILTER (WHERE unsafe_side_effect)
        AS unsafe_side_effect_count,
      clock_timestamp() AS observed_at
    FROM diagnostics`);
  const row = (rows as unknown as HealthRow[])[0];
  if (!row) throw new Error(INVALID);

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
  const criticalCount = Object.values(violations)
    .reduce((sum, value) => sum + value, 0);

  return {
    schemaVersion:
      "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-health-v1",
    status: criticalCount === 0 ? "healthy" as const : "critical" as const,
    totals,
    violations,
    criticalCount,
    retention: {
      policy: "UNSET_PRESERVE" as const,
      automaticDeletion: false,
    },
    containsRawIdentifiers: false,
    independentTrustAnchor: false,
    networkReceipt: false,
    externalReceiptVerified: false,
    productionAccepted: false,
    observedAt: iso(row.observed_at),
  };
}
