import { randomUUID } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import {
  getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview,
  SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION,
} from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-preview.service.js";

export const SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_MINUTES = 15;

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
  decision: unknown;
  decision_reason: unknown;
  decided_by: unknown;
  decided_at: unknown;
  approval_request_id: unknown;
  preview_schema_version: unknown;
  approval_state_fingerprint: unknown;
  preview_action: unknown;
  preview_severity: unknown;
  preview_reasons: unknown;
  requested_by: unknown;
  request_created_at: unknown;
  request_expires_at: unknown;
};

function invalid() {
  throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_GRANT_INVALID");
}

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function reasons(value: unknown) {
  if (!Array.isArray(value) || value.some((reason) => typeof reason !== "string")) {
    invalid();
  }
  return value as string[];
}

function fullBindingValid(row: GrantRow) {
  const orderedReasons = [
    "archive_intent_binding_violation",
    "archive_intent_blocker_violation",
    "archive_intent_side_effect_violation",
    "archive_intent_timestamp_violation",
    "archive_source_limit_violation",
    "current_archive_intent_missing",
    "archive_intent_stale",
  ];
  const values = reasons(row.preview_reasons);
  const indexes = values.map((reason) => orderedReasons.indexOf(reason));
  const critical = indexes.some((index) => index >= 0 && index <= 4);
  const action = String(row.preview_action);
  const severity = String(row.preview_severity);
  const grantedAt = Date.parse(iso(row.granted_at));
  const cooldownExpiresAt = Date.parse(iso(row.cooldown_expires_at));
  const decidedAt = Date.parse(iso(row.decided_at));
  const requestedAt = Date.parse(iso(row.request_created_at));
  const requestExpiresAt = Date.parse(iso(row.request_expires_at));
  return (
    String(row.preview_schema_version) ===
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION &&
    /^[0-9a-f]{64}$/.test(String(row.state_fingerprint)) &&
    String(row.state_fingerprint) === String(row.approval_state_fingerprint) &&
    String(row.status) === "GRANTED_DRY_RUN" &&
    String(row.decision) === "APPROVED" &&
    String(row.decision_reason) === "checker_approved_snapshot" &&
    String(row.decided_by) === String(row.granted_by) &&
    String(row.requested_by) !== String(row.granted_by) &&
    values.length >= 1 &&
    values.length <= 7 &&
    indexes.every((index) => index >= 0) &&
    indexes.every((index, position) => position === 0 || index > indexes[position - 1]!) &&
    (action === "review_warning"
      ? severity === "warning" && !critical
      : action === "escalate_critical" && severity === "critical" && critical) &&
    decidedAt >= requestedAt &&
    decidedAt < requestExpiresAt &&
    grantedAt >= decidedAt &&
    grantedAt < requestExpiresAt &&
    cooldownExpiresAt ===
      grantedAt + SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_MINUTES * 60_000
  );
}

function exactReplayMatches(
  row: GrantRow,
  input: {
    approvalDecisionId: string;
    clientGrantId: string;
    grantedBy: string;
  },
) {
  return (
    String(row.client_grant_id) === input.clientGrantId &&
    String(row.approval_decision_id) === input.approvalDecisionId &&
    String(row.granted_by) === input.grantedBy
  );
}

function publicGrant(row: GrantRow, now: Date) {
  if (!fullBindingValid(row)) invalid();
  const cooldownExpiresAt = iso(row.cooldown_expires_at);
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-delivery-grant-v1",
    deliveryGrantId: String(row.id),
    clientGrantId: String(row.client_grant_id),
    approvalDecisionId: String(row.approval_decision_id),
    stateFingerprint: String(row.state_fingerprint),
    status: "GRANTED_DRY_RUN" as const,
    grantedAt: iso(row.granted_at),
    cooldownExpiresAt,
    cooldown: {
      scope: "state_fingerprint" as const,
      windowMinutes: SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_MINUTES,
      active: Date.parse(cooldownExpiresAt) > now.getTime(),
    },
    replayed: row.inserted === false,
    persistent: true,
    appendOnly: true,
    makerCheckerSeparated: true,
    makerIdentityReturned: false,
    checkerIdentityReturned: false,
    containsArchiveIdentifiers: false,
    payloadCreated: false,
    signed: false,
    delivery: { enabled: false, attempted: false },
    externalReceiptVerified: false,
    productionAccepted: false,
  };
}

function previewMatches(
  row: GrantRow,
  preview: Awaited<
    ReturnType<typeof getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview>
  >,
) {
  return (
    String(row.preview_schema_version) ===
      SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_ALERT_PREVIEW_VERSION &&
    String(row.state_fingerprint) === preview.stateFingerprint &&
    String(row.preview_action) === preview.action &&
    String(row.preview_severity) === preview.severity &&
    JSON.stringify(reasons(row.preview_reasons)) === JSON.stringify(preview.reasons)
  );
}

const grantBindingSql = sql`SELECT delivery_grant.*, decision.decision,
    decision.decision_reason, decision.decided_by,
    decision.created_at AS decided_at, decision.approval_request_id,
    request.preview_schema_version,
    request.state_fingerprint AS approval_state_fingerprint,
    request.preview_action, request.preview_severity, request.preview_reasons,
    request.requested_by, request.created_at AS request_created_at,
    request.expires_at AS request_expires_at
  FROM shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
  JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
    ON decision.id = delivery_grant.approval_decision_id
  JOIN shipment_apv_manifest_archive_alert_approval_requests request
    ON request.id = decision.approval_request_id`;

export async function createShipmentApvReceiverManifestArchiveAlertDeliveryGrant(
  db: Pick<Database, "transaction">,
  input: {
    approvalDecisionId: string;
    clientGrantId: string;
    grantedBy: string;
    now?: Date;
    grantId?: string;
  },
) {
  const now = input.now ?? new Date();
  return db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-claim-manifest-receipt.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-approval.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-decision.v1', 0)),
      pg_advisory_xact_lock(hashtextextended(
        'haggle.shipment-apv-failure-alert.receiver-manifest-archive-grant.v1', 0))`);

    const existingRows = await transaction.execute(sql`${grantBindingSql}
      WHERE delivery_grant.client_grant_id = ${input.clientGrantId}::uuid
      LIMIT 1`);
    const existing = (existingRows as unknown as GrantRow[])[0];
    if (existing) {
      if (!exactReplayMatches(existing, input) || !fullBindingValid(existing)) {
        throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_REPLAY_CONFLICT");
      }
      return publicGrant({ ...existing, inserted: false }, now);
    }

    const decisionRows = await transaction.execute(sql`SELECT
        NULL::uuid AS id, NULL::uuid AS client_grant_id,
        decision.id AS approval_decision_id,
        decision.request_state_fingerprint AS state_fingerprint,
        'GRANTED_DRY_RUN'::text AS status,
        decision.decided_by AS granted_by,
        decision.created_at AS granted_at,
        decision.created_at + interval '15 minutes' AS cooldown_expires_at,
        false AS inserted, decision.decision, decision.decision_reason,
        decision.decided_by, decision.created_at AS decided_at,
        decision.approval_request_id, request.preview_schema_version,
        request.state_fingerprint AS approval_state_fingerprint,
        request.preview_action, request.preview_severity, request.preview_reasons,
        request.requested_by, request.created_at AS request_created_at,
        request.expires_at AS request_expires_at,
        delivery_grant.id AS prior_grant_id,
        delivery_grant.client_grant_id AS prior_client_grant_id,
        delivery_grant.granted_by AS prior_granted_by
      FROM shipment_apv_manifest_archive_alert_approval_decisions decision
      JOIN shipment_apv_manifest_archive_alert_approval_requests request
        ON request.id = decision.approval_request_id
      LEFT JOIN shipment_apv_manifest_archive_alert_delivery_grants delivery_grant
        ON delivery_grant.approval_decision_id = decision.id
      WHERE decision.id = ${input.approvalDecisionId}::uuid
      LIMIT 1`);
    const decision = (
      decisionRows as unknown as Array<
        GrantRow & {
          prior_grant_id: unknown;
          prior_client_grant_id: unknown;
          prior_granted_by: unknown;
        }
      >
    )[0];
    if (!decision) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_NOT_FOUND");
    }
    if (String(decision.decision) !== "APPROVED") {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_NOT_APPROVED");
    }
    if (
      String(decision.decided_by) !== input.grantedBy ||
      String(decision.requested_by) === input.grantedBy
    ) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_ACTOR_MISMATCH");
    }
    if (decision.prior_grant_id) {
      if (
        String(decision.prior_client_grant_id) === input.clientGrantId &&
        String(decision.prior_granted_by) === input.grantedBy
      ) {
        const replayRows = await transaction.execute(sql`${grantBindingSql}
          WHERE delivery_grant.id = ${String(decision.prior_grant_id)}::uuid
          LIMIT 1`);
        const replay = (replayRows as unknown as GrantRow[])[0];
        if (replay && exactReplayMatches(replay, input) && fullBindingValid(replay)) {
          return publicGrant({ ...replay, inserted: false }, now);
        }
      }
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_ALREADY_GRANTED");
    }
    if (!fullBindingValid(decision)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DECISION_INVALID");
    }
    if (Date.parse(String(decision.request_expires_at)) <= now.getTime()) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_APPROVAL_REQUEST_EXPIRED");
    }

    const preview =
      await getShipmentApvFailureAlertReceiverManifestArchiveAlertPreview(transaction);
    if (
      preview.action === "none" ||
      !preview.approval.required ||
      !previewMatches(decision, preview)
    ) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_STATE_CHANGED");
    }

    const grantId = input.grantId ?? randomUUID();
    const grantedAt = now.toISOString();
    const cooldownExpiresAt = new Date(
      now.getTime() + SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_MINUTES * 60_000,
    ).toISOString();
    const rows = await transaction.execute(sql`WITH claimed AS (
        INSERT INTO shipment_apv_manifest_archive_alert_cooldown_claims
          (state_fingerprint, grant_id, claimed_at, expires_at)
        VALUES (${String(decision.state_fingerprint)}, ${grantId}::uuid,
          ${grantedAt}::timestamptz, ${cooldownExpiresAt}::timestamptz)
        ON CONFLICT (state_fingerprint) DO UPDATE
          SET grant_id=EXCLUDED.grant_id, claimed_at=EXCLUDED.claimed_at,
            expires_at=EXCLUDED.expires_at
          WHERE shipment_apv_manifest_archive_alert_cooldown_claims.expires_at
            <= ${grantedAt}::timestamptz
        RETURNING state_fingerprint
      ), inserted AS (
        INSERT INTO shipment_apv_manifest_archive_alert_delivery_grants
          (id, client_grant_id, approval_decision_id, state_fingerprint, status,
            granted_by, granted_at, cooldown_expires_at)
        SELECT ${grantId}::uuid, ${input.clientGrantId}::uuid,
          ${input.approvalDecisionId}::uuid, claimed.state_fingerprint,
          'GRANTED_DRY_RUN', ${input.grantedBy}::uuid,
          ${grantedAt}::timestamptz, ${cooldownExpiresAt}::timestamptz
        FROM claimed
        ON CONFLICT DO NOTHING
        RETURNING *, true AS inserted
      )
      SELECT inserted.*, decision.decision, decision.decision_reason,
        decision.decided_by, decision.created_at AS decided_at,
        decision.approval_request_id, request.preview_schema_version,
        request.state_fingerprint AS approval_state_fingerprint,
        request.preview_action, request.preview_severity, request.preview_reasons,
        request.requested_by, request.created_at AS request_created_at,
        request.expires_at AS request_expires_at
      FROM inserted
      JOIN shipment_apv_manifest_archive_alert_approval_decisions decision
        ON decision.id = inserted.approval_decision_id
      JOIN shipment_apv_manifest_archive_alert_approval_requests request
        ON request.id = decision.approval_request_id`);
    const row = (rows as unknown as GrantRow[])[0];
    if (!row) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_COOLDOWN_ACTIVE");
    }
    if (!exactReplayMatches(row, input) || !fullBindingValid(row)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_GRANT_REPLAY_CONFLICT");
    }
    return publicGrant(row, now);
  });
}
