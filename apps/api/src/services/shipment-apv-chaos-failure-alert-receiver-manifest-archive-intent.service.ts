import { type Database, sql } from "@haggle/db";
import { getShipmentApvFailureAlertReceiverClaimManifestHealth } from "./shipment-apv-chaos-failure-alert-receiver-claim-manifest-health.service.js";

const BLOCKING_REASONS = [
  "independent_worm_endpoint_missing",
  "archive_credential_missing",
  "archive_signing_key_missing",
  "archive_delivery_worker_missing",
] as const;

type ArchiveIntentRow = {
  id: unknown;
  client_archive_intent_id: unknown;
  manifest_receipt_id: unknown;
  manifest_revision: unknown;
  manifest_digest: unknown;
  status: unknown;
  blocking_reasons: unknown;
  http_request_created: unknown;
  delivery_attempted: unknown;
  external_receipt_verified: unknown;
  production_accepted: unknown;
  requested_by: unknown;
  created_at: unknown;
  inserted: unknown;
};

type LatestReceiptRow = {
  receipt_id: unknown;
  revision: unknown;
  manifest_digest: unknown;
  intent_id: unknown;
  client_archive_intent_id: unknown;
  status: unknown;
  blocking_reasons: unknown;
  http_request_created: unknown;
  delivery_attempted: unknown;
  external_receipt_verified: unknown;
  production_accepted: unknown;
  requested_by: unknown;
  created_at: unknown;
};

function iso(value: unknown) {
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_INVALID");
  }
  return date.toISOString();
}

function publicIntent(row: ArchiveIntentRow) {
  const revision = Number(row.manifest_revision);
  const blockers = Array.isArray(row.blocking_reasons) ? row.blocking_reasons.map(String) : [];
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !/^[0-9a-f]{64}$/.test(String(row.manifest_digest)) ||
    blockers.join("|") !== BLOCKING_REASONS.join("|")
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_INVALID");
  }
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-intent-v1",
    archiveIntentId: String(row.id),
    clientArchiveIntentId: String(row.client_archive_intent_id),
    manifestRevision: revision,
    manifestDigest: String(row.manifest_digest),
    status: "BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN" as const,
    blockingReasons: [...BLOCKING_REASONS],
    createdAt: iso(row.created_at),
    replayed: row.inserted === false,
    persistent: true,
    appendOnly: true,
    executable: false,
    containsRawIdentifiers: false,
    http: { requestCreated: false },
    delivery: { enabled: false, attempted: false },
    externalReceipt: { verified: false },
    productionAccepted: false,
  };
}

function matches(
  row: ArchiveIntentRow,
  input: {
    clientArchiveIntentId: string;
    requestedBy: string;
  },
) {
  return (
    String(row.client_archive_intent_id) === input.clientArchiveIntentId &&
    String(row.requested_by) === input.requestedBy
  );
}

function latestIntent(row: LatestReceiptRow): ArchiveIntentRow | null {
  if (!row.intent_id) return null;
  return {
    id: row.intent_id,
    client_archive_intent_id: row.client_archive_intent_id,
    manifest_receipt_id: row.receipt_id,
    manifest_revision: row.revision,
    manifest_digest: row.manifest_digest,
    status: row.status,
    blocking_reasons: row.blocking_reasons,
    http_request_created: row.http_request_created,
    delivery_attempted: row.delivery_attempted,
    external_receipt_verified: row.external_receipt_verified,
    production_accepted: row.production_accepted,
    requested_by: row.requested_by,
    created_at: row.created_at,
    inserted: false,
  };
}

export async function createShipmentApvFailureAlertReceiverManifestArchiveIntent(
  db: Pick<Database, "execute">,
  input: { clientArchiveIntentId: string; requestedBy: string; now?: Date },
) {
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_receiver_manifest_archive_intents
    WHERE client_archive_intent_id = ${input.clientArchiveIntentId}::uuid LIMIT 1`);
  const existing = (existingRows as unknown as ArchiveIntentRow[])[0];
  if (existing) {
    if (!matches(existing, input)) {
      throw new Error(
        "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_REPLAY_CONFLICT",
      );
    }
    return publicIntent(existing);
  }

  const health = await getShipmentApvFailureAlertReceiverClaimManifestHealth(db);
  if (
    health.status !== "healthy" ||
    health.criticalCount !== 0 ||
    !health.coverage.currentSourceCovered
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_HEALTH_BLOCKED");
  }

  const latestRows = await db.execute(sql`SELECT receipt.id AS receipt_id,
      receipt.revision, receipt.manifest_digest, intent.id AS intent_id,
      intent.client_archive_intent_id, intent.status, intent.blocking_reasons,
      intent.http_request_created, intent.delivery_attempted,
      intent.external_receipt_verified, intent.production_accepted,
      intent.requested_by, intent.created_at
    FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts receipt
    LEFT JOIN shipment_apv_failure_alert_receiver_manifest_archive_intents intent
      ON intent.manifest_receipt_id = receipt.id
    ORDER BY receipt.revision DESC LIMIT 1`);
  const latest = (latestRows as unknown as LatestReceiptRow[])[0];
  if (!latest) {
    throw new Error(
      "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_RECEIPT_NOT_FOUND",
    );
  }
  const prior = latestIntent(latest);
  if (prior) {
    if (matches(prior, input)) return publicIntent(prior);
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_ALREADY_CREATED");
  }

  const now = input.now ?? new Date();
  const insertedRows = await db.execute(sql`INSERT INTO
      shipment_apv_failure_alert_receiver_manifest_archive_intents
      (client_archive_intent_id, manifest_receipt_id, manifest_revision,
        manifest_digest, status, blocking_reasons, http_request_created,
        delivery_attempted, external_receipt_verified, production_accepted,
        requested_by, created_at)
    VALUES (${input.clientArchiveIntentId}::uuid, ${String(latest.receipt_id)}::uuid,
      ${Number(latest.revision)}, ${String(latest.manifest_digest)},
      'BLOCKED_EXTERNAL_ARCHIVE_CONFIGURATION_DRY_RUN',
      ARRAY[${BLOCKING_REASONS[0]}, ${BLOCKING_REASONS[1]},
        ${BLOCKING_REASONS[2]}, ${BLOCKING_REASONS[3]}]::text[],
      false, false, false, false, ${input.requestedBy}::uuid,
      ${now.toISOString()}::timestamptz)
    ON CONFLICT DO NOTHING RETURNING *, true AS inserted`);
  let row = (insertedRows as unknown as ArchiveIntentRow[])[0];
  if (!row) {
    const winnerRows = await db.execute(sql`SELECT *, false AS inserted
      FROM shipment_apv_failure_alert_receiver_manifest_archive_intents
      WHERE client_archive_intent_id = ${input.clientArchiveIntentId}::uuid
        OR manifest_receipt_id = ${String(latest.receipt_id)}::uuid
      LIMIT 1`);
    row = (winnerRows as unknown as ArchiveIntentRow[])[0];
  }
  if (!row) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_UNAVAILABLE");
  }
  if (!matches(row, input)) {
    if (String(row.manifest_receipt_id) === String(latest.receipt_id)) {
      throw new Error(
        "SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_ALREADY_CREATED",
      );
    }
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_ARCHIVE_INTENT_REPLAY_CONFLICT");
  }
  return publicIntent(row);
}
