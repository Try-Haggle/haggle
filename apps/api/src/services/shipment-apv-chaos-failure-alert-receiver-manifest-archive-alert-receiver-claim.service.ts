import { createHash } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { verifyShipmentApvReceiverManifestArchiveAlertReceiverContract } from "./shipment-apv-chaos-failure-alert-receiver-manifest-archive-alert-receiver-contract.service.js";

const DELIVERY_DOMAIN =
  "haggle.shipment-apv-failure-alert.receiver-manifest-archive-alert.receiver-delivery.v1";
const CLAIM_STATUS = "VERIFIED_LOCAL_ARCHIVE_ALERT_RECEIVER_CLAIM_DRY_RUN";

type ClaimRow = {
  id: unknown;
  delivery_id: unknown;
  delivery_intent_id: unknown;
  payload_signature_id: unknown;
  payload_outbox_id: unknown;
  payload_sha256: unknown;
  key_id: unknown;
  status: unknown;
  network_received: unknown;
  external_receipt_verified: unknown;
  production_accepted: unknown;
  delivery_attempted: unknown;
  received_at: unknown;
  inserted: unknown;
  expected_payload_signature_id?: unknown;
  expected_payload_outbox_id?: unknown;
  expected_payload_sha256?: unknown;
  expected_key_id?: unknown;
};

type BindingRow = {
  delivery_intent_id: unknown;
  payload_signature_id: unknown;
  payload_outbox_id: unknown;
  payload_sha256: unknown;
  key_id: unknown;
};

function deliveryId(intentId: string, payloadSha256: string) {
  return createHash("sha256")
    .update(`${DELIVERY_DOMAIN}:${intentId}:${payloadSha256}`, "utf8")
    .digest("hex");
}

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function bindingFromExisting(row: ClaimRow): BindingRow {
  return {
    delivery_intent_id: row.delivery_intent_id,
    payload_signature_id: row.expected_payload_signature_id,
    payload_outbox_id: row.expected_payload_outbox_id,
    payload_sha256: row.expected_payload_sha256,
    key_id: row.expected_key_id,
  };
}

function claimMatches(row: ClaimRow, binding: BindingRow, expectedDeliveryId: string) {
  return (
    /^[0-9a-f]{64}$/.test(String(row.delivery_id)) &&
    /^[0-9a-f]{64}$/.test(String(row.payload_sha256)) &&
    /^[0-9a-f]{24}$/.test(String(row.key_id)) &&
    String(row.delivery_id) === expectedDeliveryId &&
    String(row.delivery_intent_id) === String(binding.delivery_intent_id) &&
    String(row.payload_signature_id) === String(binding.payload_signature_id) &&
    String(row.payload_outbox_id) === String(binding.payload_outbox_id) &&
    String(row.payload_sha256) === String(binding.payload_sha256) &&
    String(row.key_id) === String(binding.key_id) &&
    String(row.status) === CLAIM_STATUS &&
    row.network_received === false &&
    row.external_receipt_verified === false &&
    row.production_accepted === false &&
    row.delivery_attempted === false &&
    iso(row.received_at) !== null
  );
}

function publicClaim(row: ClaimRow) {
  const receivedAt = iso(row.received_at);
  if (!receivedAt) {
    throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_CONFLICT");
  }
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-manifest-archive-alert-receiver-claim-v1",
    receiverClaimId: String(row.id),
    deliveryId: String(row.delivery_id),
    deliveryIntentId: String(row.delivery_intent_id),
    payloadSignatureId: String(row.payload_signature_id),
    payloadOutboxId: String(row.payload_outbox_id),
    payloadSha256: String(row.payload_sha256),
    keyId: String(row.key_id),
    status: CLAIM_STATUS,
    receivedAt,
    replayed: row.inserted === false,
    persistent: true,
    appendOnly: true,
    receiverContractVerified: true,
    replayProtection: { enabled: true, persistent: true },
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE" as const,
    independentTrustAnchor: false,
    actorIdentityReturned: false,
    signatureValueReturned: false,
    publicKeyReturned: false,
    networkReceived: false,
    externalReceiptVerified: false,
    productionAccepted: false,
    delivery: { enabled: false, attempted: false },
  };
}

export async function createShipmentApvReceiverManifestArchiveAlertReceiverClaim(
  db: Pick<Database, "execute">,
  input: { deliveryIntentId: string; now?: Date },
) {
  const existingRows = await db.execute(sql`SELECT claim.*, false AS inserted,
      intent.payload_signature_id AS expected_payload_signature_id,
      intent.payload_outbox_id AS expected_payload_outbox_id,
      intent.payload_sha256 AS expected_payload_sha256,
      intent.key_id AS expected_key_id
    FROM shipment_apv_manifest_archive_alert_receiver_claims claim
    JOIN shipment_apv_manifest_archive_alert_delivery_intents intent
      ON intent.id = claim.delivery_intent_id
    WHERE claim.delivery_intent_id = ${input.deliveryIntentId}::uuid LIMIT 1`);
  const existing = (existingRows as unknown as ClaimRow[])[0];
  if (existing) {
    const binding = bindingFromExisting(existing);
    const expectedDeliveryId = deliveryId(
      String(binding.delivery_intent_id),
      String(binding.payload_sha256),
    );
    if (!claimMatches(existing, binding, expectedDeliveryId)) {
      throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_CONFLICT");
    }
    return publicClaim(existing);
  }

  await verifyShipmentApvReceiverManifestArchiveAlertReceiverContract(db, input);
  const bindingRows = await db.execute(sql`SELECT
      intent.id AS delivery_intent_id, intent.payload_signature_id,
      intent.payload_outbox_id, intent.payload_sha256, intent.key_id
    FROM shipment_apv_manifest_archive_alert_delivery_intents intent
    WHERE intent.id = ${input.deliveryIntentId}::uuid LIMIT 1`);
  const binding = (bindingRows as unknown as BindingRow[])[0];
  if (!binding) {
    throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_DELIVERY_INTENT_NOT_FOUND");
  }
  const expectedDeliveryId = deliveryId(
    String(binding.delivery_intent_id),
    String(binding.payload_sha256),
  );
  const receivedAt = (input.now ?? new Date()).toISOString();

  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_manifest_archive_alert_receiver_claims
        (delivery_id, delivery_intent_id, payload_signature_id,
          payload_outbox_id, payload_sha256, key_id, status,
          network_received, external_receipt_verified, production_accepted,
          delivery_attempted, received_at)
      VALUES (${expectedDeliveryId}, ${String(binding.delivery_intent_id)}::uuid,
        ${String(binding.payload_signature_id)}::uuid,
        ${String(binding.payload_outbox_id)}::uuid,
        ${String(binding.payload_sha256)}, ${String(binding.key_id)},
        ${CLAIM_STATUS}, false, false, false, false, ${receivedAt})
      ON CONFLICT DO NOTHING RETURNING *, true AS inserted
    ) SELECT * FROM inserted
    UNION ALL SELECT existing.*, false AS inserted
    FROM shipment_apv_manifest_archive_alert_receiver_claims existing
    WHERE (existing.delivery_id = ${expectedDeliveryId}
      OR existing.delivery_intent_id = ${String(binding.delivery_intent_id)}::uuid)
      AND NOT EXISTS (SELECT 1 FROM inserted) LIMIT 1`);
  let row = (rows as unknown as ClaimRow[])[0];
  if (!row) {
    const winnerRows = await db.execute(sql`SELECT *, false AS inserted
      FROM shipment_apv_manifest_archive_alert_receiver_claims
      WHERE delivery_id = ${expectedDeliveryId}
        OR delivery_intent_id = ${String(binding.delivery_intent_id)}::uuid
      LIMIT 1`);
    row = (winnerRows as unknown as ClaimRow[])[0];
  }
  if (!row) {
    throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_UNAVAILABLE");
  }
  if (!claimMatches(row, binding, expectedDeliveryId)) {
    throw new Error("SHIPMENT_APV_RECEIVER_MANIFEST_ARCHIVE_ALERT_RECEIVER_CLAIM_CONFLICT");
  }
  return publicClaim(row);
}
