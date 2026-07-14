import { createHash } from "node:crypto";
import { sql, type Database } from "@haggle/db";
import { verifyShipmentApvFailureAlertReceiverContract } from
  "./shipment-apv-chaos-failure-alert-receiver-contract.service.js";

const DELIVERY_DOMAIN = "haggle.shipment-apv-failure-alert.receiver-delivery.v1";

type ClaimRow = {
  id: unknown;
  delivery_id: unknown;
  delivery_intent_id: unknown;
  payload_signature_id: unknown;
  payload_sha256: unknown;
  key_id: unknown;
  status: unknown;
  network_received: unknown;
  production_accepted: unknown;
  received_at: unknown;
  inserted: unknown;
};

type BindingRow = {
  delivery_intent_id: unknown;
  payload_signature_id: unknown;
  payload_sha256: unknown;
  key_id: unknown;
};

function deliveryId(intentId: string, payloadSha256: string) {
  return createHash("sha256")
    .update(`${DELIVERY_DOMAIN}:${intentId}:${payloadSha256}`, "utf8").digest("hex");
}

function iso(value: unknown) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function claimMatches(row: ClaimRow, binding: BindingRow, expectedDeliveryId: string) {
  return String(row.delivery_id) === expectedDeliveryId
    && String(row.delivery_intent_id) === String(binding.delivery_intent_id)
    && String(row.payload_signature_id) === String(binding.payload_signature_id)
    && String(row.payload_sha256) === String(binding.payload_sha256)
    && String(row.key_id) === String(binding.key_id);
}

function publicClaim(row: ClaimRow) {
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-v1",
    id: String(row.id),
    deliveryId: String(row.delivery_id),
    deliveryIntentId: String(row.delivery_intent_id),
    payloadSignatureId: String(row.payload_signature_id),
    payloadSha256: String(row.payload_sha256),
    keyId: String(row.key_id),
    status: "VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN" as const,
    receivedAt: iso(row.received_at),
    replayed: row.inserted === false,
    persistent: true,
    receiverContractVerified: true,
    replayProtection: { enabled: true, persistent: true },
    trustSource: "DATABASE_TEST_REGISTRY_FIXTURE" as const,
    independentTrustAnchor: false,
    networkReceived: false,
    productionAccepted: false,
    delivery: { enabled: false, attempted: false },
  };
}

export async function createShipmentApvFailureAlertReceiverClaim(
  db: Pick<Database, "execute">,
  input: { deliveryIntentId: string; now?: Date },
) {
  const existingRows = await db.execute(sql`SELECT *, false AS inserted
    FROM shipment_apv_failure_alert_receiver_claims
    WHERE delivery_intent_id = ${input.deliveryIntentId}::uuid LIMIT 1`);
  const existing = (existingRows as unknown as ClaimRow[])[0];
  if (existing) return publicClaim(existing);

  await verifyShipmentApvFailureAlertReceiverContract(db, input);
  const bindingRows = await db.execute(sql`SELECT intent.id AS delivery_intent_id,
      intent.payload_signature_id, intent.payload_sha256, intent.key_id
    FROM shipment_apv_failure_alert_delivery_intents intent
    WHERE intent.id = ${input.deliveryIntentId}::uuid LIMIT 1`);
  const binding = (bindingRows as unknown as BindingRow[])[0];
  if (!binding) throw new Error("SHIPMENT_APV_FAILURE_ALERT_DELIVERY_INTENT_NOT_FOUND");
  const expectedDeliveryId = deliveryId(
    String(binding.delivery_intent_id), String(binding.payload_sha256));

  const rows = await db.execute(sql`WITH inserted AS (
      INSERT INTO shipment_apv_failure_alert_receiver_claims
        (delivery_id, delivery_intent_id, payload_signature_id, payload_sha256,
          key_id, status, network_received, production_accepted)
      VALUES (${expectedDeliveryId}, ${String(binding.delivery_intent_id)}::uuid,
        ${String(binding.payload_signature_id)}::uuid,
        ${String(binding.payload_sha256)}, ${String(binding.key_id)},
        'VERIFIED_LOCAL_RECEIVER_CLAIM_DRY_RUN', false, false)
      ON CONFLICT DO NOTHING RETURNING *, true AS inserted
    ) SELECT * FROM inserted
    UNION ALL SELECT existing.*, false AS inserted
    FROM shipment_apv_failure_alert_receiver_claims existing
    WHERE (existing.delivery_id = ${expectedDeliveryId}
      OR existing.delivery_intent_id = ${String(binding.delivery_intent_id)}::uuid)
      AND NOT EXISTS (SELECT 1 FROM inserted) LIMIT 1`);
  let row = (rows as unknown as ClaimRow[])[0];
  if (!row) {
    const winnerRows = await db.execute(sql`SELECT *, false AS inserted
      FROM shipment_apv_failure_alert_receiver_claims
      WHERE delivery_id = ${expectedDeliveryId}
        OR delivery_intent_id = ${String(binding.delivery_intent_id)}::uuid
      LIMIT 1`);
    row = (winnerRows as unknown as ClaimRow[])[0];
  }
  if (!row) throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_UNAVAILABLE");
  if (!claimMatches(row, binding, expectedDeliveryId)) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_CONFLICT");
  }
  return publicClaim(row);
}
