import { randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { getShipmentApvChaosFailureAlertPreview } from
  "./shipment-apv-chaos-failure-alert-preview.service.js";

export const SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_MINUTES = 15;

type GrantRow = {
  id: unknown;
  client_grant_id: unknown;
  approval_decision_id: unknown;
  state_fingerprint: unknown;
  status: unknown;
  granted_by: unknown;
  granted_at: unknown;
  cooldown_expires_at: unknown;
  inserted: unknown;
};

type BindingRow = {
  decision_id: unknown;
  decision: unknown;
  decided_by: unknown;
  state_fingerprint: unknown;
  requested_by: unknown;
  request_expires_at: unknown;
  grant_id: unknown;
  client_grant_id: unknown;
  grant_status: unknown;
  granted_by: unknown;
  granted_at: unknown;
  cooldown_expires_at: unknown;
};

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function publicGrant(row: GrantRow) {
  return {
    schemaVersion: "shipment-apv-failure-alert-delivery-grant-v1",
    id: String(row.id),
    clientGrantId: String(row.client_grant_id),
    approvalDecisionId: String(row.approval_decision_id),
    stateFingerprint: String(row.state_fingerprint),
    status: "GRANTED_DRY_RUN" as const,
    grantedAt: iso(row.granted_at),
    cooldownExpiresAt: iso(row.cooldown_expires_at),
    replayed: row.inserted === false,
    dryRun: true,
    payloadPrepared: false,
    signatureCreated: false,
    delivery: { enabled: false, attempted: false },
  };
}

function grantMatches(row: GrantRow, input: {
  clientGrantId: string;
  approvalDecisionId: string;
  grantedBy: string;
}) {
  return String(row.client_grant_id) === input.clientGrantId
    && String(row.approval_decision_id) === input.approvalDecisionId
    && String(row.granted_by) === input.grantedBy;
}

function grantFromBinding(row: BindingRow): GrantRow | null {
  if (!row.grant_id) return null;
  return {
    id: row.grant_id,
    client_grant_id: row.client_grant_id,
    approval_decision_id: row.decision_id,
    state_fingerprint: row.state_fingerprint,
    status: row.grant_status,
    granted_by: row.granted_by,
    granted_at: row.granted_at,
    cooldown_expires_at: row.cooldown_expires_at,
    inserted: false,
  };
}

export async function createShipmentApvFailureAlertDeliveryGrant(
  db: Pick<Database, "execute">,
  input: {
    approvalDecisionId: string;
    clientGrantId: string;
    grantedBy: string;
    now?: Date;
    grantId?: string;
  },
) {
  const now = input.now ?? new Date();
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_delivery_grants
    WHERE client_grant_id = ${input.clientGrantId}::uuid
    LIMIT 1`);
  const existing = (existingRows as unknown as GrantRow[])[0];
  if (existing) {
    if (!grantMatches(existing, input)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_GRANT_REPLAY_CONFLICT");
    }
    return publicGrant(existing);
  }

  const bindingRows = await db.execute(sql`SELECT decision.id AS decision_id,
      decision.decision, decision.decided_by,
      decision.request_state_fingerprint AS state_fingerprint,
      request.requested_by, request.expires_at AS request_expires_at,
      delivery_grant.id AS grant_id, delivery_grant.client_grant_id,
      delivery_grant.status AS grant_status, delivery_grant.granted_by,
      delivery_grant.granted_at, delivery_grant.cooldown_expires_at
    FROM shipment_apv_failure_alert_approval_decisions decision
    JOIN shipment_apv_failure_alert_approval_requests request
      ON request.id = decision.approval_request_id
    LEFT JOIN shipment_apv_failure_alert_delivery_grants delivery_grant
      ON delivery_grant.approval_decision_id = decision.id
    WHERE decision.id = ${input.approvalDecisionId}::uuid
    LIMIT 1`);
  const binding = (bindingRows as unknown as BindingRow[])[0];
  if (!binding) throw new Error("SHIPMENT_APV_FAILURE_ALERT_DECISION_NOT_FOUND");
  if (String(binding.decision) !== "APPROVED") {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_DECISION_NOT_APPROVED");
  }
  if (String(binding.decided_by) !== input.grantedBy
    || String(binding.requested_by) === input.grantedBy) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_GRANT_ACTOR_MISMATCH");
  }
  const priorGrant = grantFromBinding(binding);
  if (priorGrant) {
    if (grantMatches(priorGrant, input)) return publicGrant(priorGrant);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_ALREADY_GRANTED");
  }
  if (Date.parse(String(binding.request_expires_at)) <= now.getTime()) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_APPROVAL_REQUEST_EXPIRED");
  }
  const preview = await getShipmentApvChaosFailureAlertPreview(db, now);
  if (preview.action === "none" || !preview.approval.required
    || preview.stateFingerprint !== String(binding.state_fingerprint)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_STATE_CHANGED");
  }

  const grantId = input.grantId ?? randomUUID();
  const grantedAt = now.toISOString();
  const cooldownExpiresAt = new Date(now.getTime()
    + SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_MINUTES * 60_000).toISOString();
  let rows: unknown;
  try {
    rows = await db.execute(sql`WITH claimed AS (
        INSERT INTO shipment_apv_failure_alert_cooldown_claims
          (state_fingerprint, grant_id, claimed_at, expires_at)
        VALUES (${String(binding.state_fingerprint)}, ${grantId}::uuid,
          ${grantedAt}::timestamptz, ${cooldownExpiresAt}::timestamptz)
        ON CONFLICT (state_fingerprint) DO UPDATE
          SET grant_id=EXCLUDED.grant_id, claimed_at=EXCLUDED.claimed_at,
            expires_at=EXCLUDED.expires_at
          WHERE shipment_apv_failure_alert_cooldown_claims.expires_at
            <= ${grantedAt}::timestamptz
        RETURNING state_fingerprint
      ), inserted AS (
        INSERT INTO shipment_apv_failure_alert_delivery_grants
          (id, client_grant_id, approval_decision_id, state_fingerprint, status,
            granted_by, granted_at, cooldown_expires_at)
        SELECT ${grantId}::uuid, ${input.clientGrantId}::uuid,
          ${input.approvalDecisionId}::uuid, claimed.state_fingerprint,
          'GRANTED_DRY_RUN', ${input.grantedBy}::uuid,
          ${grantedAt}::timestamptz, ${cooldownExpiresAt}::timestamptz
        FROM claimed
        RETURNING *, true AS inserted
      ) SELECT * FROM inserted`);
  } catch (error) {
    if ((error as { code?: string })?.code !== "23505") throw error;
    const raceRows = await db.execute(sql`SELECT *, false AS inserted
      FROM shipment_apv_failure_alert_delivery_grants
      WHERE client_grant_id = ${input.clientGrantId}::uuid
        OR approval_decision_id = ${input.approvalDecisionId}::uuid
      LIMIT 1`);
    const race = (raceRows as unknown as GrantRow[])[0];
    if (race && grantMatches(race, input)) return publicGrant(race);
    if (race && String(race.approval_decision_id) === input.approvalDecisionId) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_ALREADY_GRANTED");
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_GRANT_REPLAY_CONFLICT");
  }
  const row = (rows as GrantRow[])[0];
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_COOLDOWN_ACTIVE");
  return publicGrant(row);
}
