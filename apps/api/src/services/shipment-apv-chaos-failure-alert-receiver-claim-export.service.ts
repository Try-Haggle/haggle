import { createHash } from "node:crypto";
import { type Database, sql } from "@haggle/db";
import { getShipmentApvFailureAlertReceiverClaimHealth } from "./shipment-apv-chaos-failure-alert-receiver-claim-health.service.js";

const MANIFEST_DOMAIN = "haggle.shipment-apv-failure-alert.receiver-claim-manifest.v1";
const MAX_ENTRIES = 1_000;

type ExportRow = {
  observed_count: unknown;
  receipt_digests: unknown;
  generated_at: unknown;
};

function iso(value: unknown) {
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_INVALID");
  }
  return parsed.toISOString();
}

function manifestText(digests: string[]) {
  return `${MANIFEST_DOMAIN}:${digests.length}:${digests.join(",")}`;
}

export async function exportShipmentApvFailureAlertReceiverClaimManifest(
  db: Pick<Database, "execute">,
) {
  const health = await getShipmentApvFailureAlertReceiverClaimHealth(db);
  if (health.status !== "healthy" || health.criticalCount !== 0) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_HEALTH_BLOCKED");
  }

  const rows = await db.execute(sql`WITH receipt_digests AS (
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
      LIMIT ${MAX_ENTRIES + 1}
    )
    SELECT COUNT(*)::int AS observed_count,
      COALESCE(array_agg(receipt_digest ORDER BY receipt_digest), ARRAY[]::text[])
        AS receipt_digests,
      clock_timestamp() AS generated_at
    FROM receipt_digests`);
  const row = (rows as unknown as ExportRow[])[0];
  const observedCount = Number(row?.observed_count);
  if (!row || !Number.isSafeInteger(observedCount) || observedCount < 0) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_INVALID");
  }
  if (observedCount > MAX_ENTRIES) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_LIMIT_EXCEEDED");
  }
  const rawDigests = row.receipt_digests;
  if (
    !Array.isArray(rawDigests) ||
    rawDigests.length !== observedCount ||
    !rawDigests.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest))
  ) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_INVALID");
  }
  const receiptDigests = [...rawDigests].sort();
  if (receiptDigests.some((digest, index) => digest !== rawDigests[index])) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_CLAIM_EXPORT_INVALID");
  }
  const manifestDigest = createHash("sha256")
    .update(manifestText(receiptDigests), "utf8")
    .digest("hex");

  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-v1",
    status: "COMPLETE_LOCAL_MANIFEST_DRY_RUN" as const,
    manifestDomain: MANIFEST_DOMAIN,
    manifestDigest,
    entryCount: receiptDigests.length,
    receiptDigests,
    maxEntries: MAX_ENTRIES,
    complete: true,
    healthStatus: "healthy" as const,
    containsRawIdentifiers: false,
    persistent: false,
    externalArchive: false,
    networkDelivered: false,
    productionAccepted: false,
    generatedAt: iso(row.generated_at),
  };
}
