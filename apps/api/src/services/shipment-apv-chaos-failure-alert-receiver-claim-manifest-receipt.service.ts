import { sql, type Database } from "@haggle/db";
import { exportShipmentApvFailureAlertReceiverClaimManifest } from
  "./shipment-apv-chaos-failure-alert-receiver-claim-export.service.js";

type ReceiptRow = {
  revision: unknown;
  manifest_digest: unknown;
  previous_manifest_digest: unknown;
  entry_count: unknown;
  receipt_digests: unknown;
  status: unknown;
  health_status: unknown;
  contains_raw_identifiers: unknown;
  external_archive: unknown;
  network_delivered: unknown;
  production_accepted: unknown;
  generated_at: unknown;
  recorded_at: unknown;
  inserted: unknown;
};

function iso(value: unknown) {
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function revision(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_INVALID");
  }
  return parsed;
}

function rowMatches(row: ReceiptRow, manifest: Awaited<ReturnType<
  typeof exportShipmentApvFailureAlertReceiverClaimManifest>>) {
  return String(row.manifest_digest) === manifest.manifestDigest
    && Number(row.entry_count) === manifest.entryCount
    && Array.isArray(row.receipt_digests)
    && row.receipt_digests.length === manifest.receiptDigests.length
    && row.receipt_digests.every((digest, index) => digest === manifest.receiptDigests[index])
    && String(row.status) === "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN"
    && String(row.health_status) === "healthy"
    && row.contains_raw_identifiers === false && row.external_archive === false
    && row.network_delivered === false && row.production_accepted === false;
}

function publicReceipt(row: ReceiptRow) {
  return {
    schemaVersion: "shipment-apv-failure-alert-receiver-claim-manifest-receipt-v1",
    status: "PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN" as const,
    revision: revision(row.revision),
    manifestDigest: String(row.manifest_digest),
    previousManifestDigest: row.previous_manifest_digest === null
      ? null : String(row.previous_manifest_digest),
    entryCount: Number(row.entry_count),
    receiptDigests: Array.isArray(row.receipt_digests) ? row.receipt_digests.map(String) : [],
    generatedAt: iso(row.generated_at),
    recordedAt: iso(row.recorded_at),
    replayed: row.inserted === false,
    persistent: true,
    appendOnly: true,
    digestVerified: true,
    healthStatus: "healthy" as const,
    containsRawIdentifiers: false,
    externalArchive: false,
    networkDelivered: false,
    productionAccepted: false,
  };
}

export async function recordShipmentApvFailureAlertReceiverClaimManifestReceipt(
  db: Database,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
      'haggle.shipment-apv-failure-alert.receiver-claim-manifest-receipt.v1', 0))`);
    const manifest = await exportShipmentApvFailureAlertReceiverClaimManifest(tx);

    const existingRows = await tx.execute(sql`SELECT *, false AS inserted
      FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts
      WHERE manifest_digest = ${manifest.manifestDigest} LIMIT 1`);
    const existing = (existingRows as unknown as ReceiptRow[])[0];
    if (existing) {
      if (!rowMatches(existing, manifest)) {
        throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_CONFLICT");
      }
      return publicReceipt(existing);
    }

    const latestRows = await tx.execute(sql`SELECT revision, manifest_digest
      FROM shipment_apv_failure_alert_receiver_claim_manifest_receipts
      ORDER BY revision DESC LIMIT 1`);
    const latest = (latestRows as unknown as ReceiptRow[])[0];
    const nextRevision = latest ? revision(latest.revision) + 1 : 1;
    const previousManifestDigest = latest ? String(latest.manifest_digest) : null;
    const receiptDigestArray = manifest.receiptDigests.length === 0
      ? sql`ARRAY[]::text[]`
      : sql`ARRAY[${sql.join(manifest.receiptDigests.map((digest) => sql`${digest}`),
        sql`, `)}]::text[]`;
    const rows = await tx.execute(sql`INSERT INTO
      shipment_apv_failure_alert_receiver_claim_manifest_receipts
        (revision, manifest_digest, previous_manifest_digest, entry_count,
          receipt_digests, status, health_status, contains_raw_identifiers,
          external_archive, network_delivered, production_accepted, generated_at)
      VALUES (${nextRevision}, ${manifest.manifestDigest}, ${previousManifestDigest},
        ${manifest.entryCount}, ${receiptDigestArray},
        'PERSISTED_LOCAL_MANIFEST_RECEIPT_DRY_RUN', 'healthy', false, false, false,
        false, ${manifest.generatedAt}::timestamptz)
      RETURNING *, true AS inserted`);
    const row = (rows as unknown as ReceiptRow[])[0];
    if (!row) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_UNAVAILABLE");
    }
    if (!rowMatches(row, manifest)) {
      throw new Error("SHIPMENT_APV_FAILURE_ALERT_RECEIVER_MANIFEST_RECEIPT_CONFLICT");
    }
    return publicReceipt(row);
  });
}
