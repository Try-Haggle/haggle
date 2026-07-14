import { createHash, randomUUID } from "node:crypto";
import { sql, type Database } from "@haggle/db";

export type ShipmentApvStatus = "PROCESSING" | "APPLIED" | "REVIEW_REQUIRED" | "CREDIT_RECORDED" | "FAILED";

export interface ShipmentApvInput {
  provider: string;
  providerInvoiceId: string;
  shipmentId: string;
  orderId: string;
  settlementReleaseId: string;
  originalRateMinor: number;
  adjustedRateMinor: number;
  adjustmentMinor: number;
  invoiceEvent?: "created" | "updated";
  webhookEventId?: string;
}

export interface ShipmentApvClaim {
  outcome: "acquired";
  provider: string;
  providerInvoiceId: string;
  claimId: string;
  attemptCount: number;
}

export type ShipmentApvClaimResult = ShipmentApvClaim | {
  outcome: "duplicate";
  status?: ShipmentApvStatus;
  record?: ShipmentApvRecord;
} | {
  outcome: "in_progress";
  status?: ShipmentApvStatus;
} | {
  outcome: "payload_conflict";
  status?: ShipmentApvStatus;
} | {
  outcome: "payout_reserved";
};

export interface ShipmentApvRecord {
  id: string;
  provider: string;
  provider_invoice_id: string;
  shipment_id: string;
  order_id: string;
  settlement_release_id: string;
  status: ShipmentApvStatus;
  original_rate_minor: number;
  adjusted_rate_minor: number;
  adjustment_minor: number;
  buffer_applied_minor: number;
  assessed_seller_liability_minor: number;
  seller_liability_minor: number;
  platform_liability_minor: number;
  carrier_credit_minor: number;
  buyer_effect_minor: 0;
  review_status: "NONE" | "PENDING" | "UPHELD" | "WAIVED";
  review_request_id?: string;
  seller_review_reason?: string;
  seller_review_submitted_at?: string;
  reviewed_by?: string;
  review_decision_reason?: string;
  reviewed_at?: string;
  review_version: number;
  attempt_count: number;
  processed_at?: string;
}

export function classifyShipmentApvAllocation(adjustmentMinor: number, bufferAppliedMinor: number) {
  const positiveAdjustment = Math.max(0, adjustmentMinor);
  const applied = Math.max(0, Math.min(bufferAppliedMinor, positiveAdjustment));
  const sellerLiabilityMinor = Math.max(0, positiveAdjustment - applied);
  const carrierCreditMinor = Math.max(0, -adjustmentMinor);
  const status: Exclude<ShipmentApvStatus, "PROCESSING" | "FAILED"> = carrierCreditMinor > 0
    ? "CREDIT_RECORDED"
    : sellerLiabilityMinor > 0
      ? "REVIEW_REQUIRED"
      : "APPLIED";
  return {
    status,
    bufferAppliedMinor: applied,
    sellerLiabilityMinor,
    carrierCreditMinor,
    buyerEffectMinor: 0 as const,
  };
}

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function mapRecord(row: Record<string, unknown>): ShipmentApvRecord {
  return {
    id: String(row.id),
    provider: String(row.provider),
    provider_invoice_id: String(row.provider_invoice_id),
    shipment_id: String(row.shipment_id),
    order_id: String(row.order_id),
    settlement_release_id: String(row.settlement_release_id),
    status: String(row.status) as ShipmentApvStatus,
    original_rate_minor: numeric(row.original_rate_minor),
    adjusted_rate_minor: numeric(row.adjusted_rate_minor),
    adjustment_minor: numeric(row.adjustment_minor),
    buffer_applied_minor: numeric(row.buffer_applied_minor),
    assessed_seller_liability_minor: numeric(row.assessed_seller_liability_minor),
    seller_liability_minor: numeric(row.seller_liability_minor),
    platform_liability_minor: numeric(row.platform_liability_minor),
    carrier_credit_minor: numeric(row.carrier_credit_minor),
    buyer_effect_minor: 0,
    review_status: String(row.review_status ?? "NONE") as ShipmentApvRecord["review_status"],
    review_request_id: typeof row.review_request_id === "string" ? row.review_request_id : undefined,
    seller_review_reason: typeof row.seller_review_reason === "string" ? row.seller_review_reason : undefined,
    seller_review_submitted_at: row.seller_review_submitted_at instanceof Date
      ? row.seller_review_submitted_at.toISOString()
      : typeof row.seller_review_submitted_at === "string" ? row.seller_review_submitted_at : undefined,
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : undefined,
    review_decision_reason: typeof row.review_decision_reason === "string" ? row.review_decision_reason : undefined,
    reviewed_at: row.reviewed_at instanceof Date
      ? row.reviewed_at.toISOString()
      : typeof row.reviewed_at === "string" ? row.reviewed_at : undefined,
    review_version: numeric(row.review_version),
    attempt_count: numeric(row.attempt_count),
    processed_at: row.processed_at instanceof Date
      ? row.processed_at.toISOString()
      : typeof row.processed_at === "string" ? row.processed_at : undefined,
  };
}

export function shipmentApvPayloadSha256(input: ShipmentApvInput): string {
  return createHash("sha256").update(JSON.stringify({
    provider: input.provider,
    provider_invoice_id: input.providerInvoiceId,
    shipment_id: input.shipmentId,
    order_id: input.orderId,
    settlement_release_id: input.settlementReleaseId,
    original_rate_minor: input.originalRateMinor,
    adjusted_rate_minor: input.adjustedRateMinor,
    adjustment_minor: input.adjustmentMinor,
  })).digest("hex");
}

export async function claimShipmentApvAdjustment(
  db: Database,
  input: ShipmentApvInput,
): Promise<ShipmentApvClaimResult> {
  const payoutRows = await db.execute(sql`
    SELECT id FROM shipment_apv_payout_offsets
     WHERE settlement_release_id = ${input.settlementReleaseId}
     LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  if (payoutRows[0]) return { outcome: "payout_reserved" };
  const claimId = randomUUID();
  const payloadSha256 = shipmentApvPayloadSha256(input);
  const rows = await db.execute(sql`
    INSERT INTO shipment_apv_adjustments
      (provider, provider_invoice_id, payload_sha256, shipment_id, order_id,
       settlement_release_id, status, original_rate_minor, adjusted_rate_minor,
       adjustment_minor, claim_id, lease_expires_at, attempt_count, created_at, updated_at)
    VALUES
      (${input.provider}, ${input.providerInvoiceId}, ${payloadSha256}, ${input.shipmentId},
       ${input.orderId}, ${input.settlementReleaseId}, 'PROCESSING', ${input.originalRateMinor},
       ${input.adjustedRateMinor}, ${input.adjustmentMinor}, ${claimId},
       now() + interval '2 minutes', 1, now(), now())
    ON CONFLICT (provider, provider_invoice_id) DO UPDATE
       SET status = 'PROCESSING', claim_id = ${claimId},
           lease_expires_at = now() + interval '2 minutes',
           attempt_count = shipment_apv_adjustments.attempt_count + 1,
           last_error = NULL, updated_at = now()
     WHERE shipment_apv_adjustments.payload_sha256 = EXCLUDED.payload_sha256
       AND (
         shipment_apv_adjustments.status = 'FAILED'
         OR (shipment_apv_adjustments.status = 'PROCESSING' AND shipment_apv_adjustments.lease_expires_at <= now())
       )
    RETURNING claim_id, attempt_count
  `) as unknown as Array<Record<string, unknown>>;
  const acquired = rows[0];
  if (acquired) {
    return {
      outcome: "acquired",
      provider: input.provider,
      providerInvoiceId: input.providerInvoiceId,
      claimId,
      attemptCount: numeric(acquired.attempt_count),
    };
  }

  const existingRows = await db.execute(sql`
    SELECT * FROM shipment_apv_adjustments
     WHERE provider = ${input.provider} AND provider_invoice_id = ${input.providerInvoiceId}
     LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  const existing = existingRows[0];
  if (!existing) return { outcome: "in_progress" };
  if (existing.payload_sha256 !== payloadSha256) return { outcome: "payload_conflict" };
  const record = mapRecord(existing);
  if (record.status === "PROCESSING") return { outcome: "in_progress", status: record.status };
  return { outcome: "duplicate", status: record.status, record };
}

export async function completeShipmentApvAdjustment(
  db: Database,
  claim: ShipmentApvClaim,
  input: ShipmentApvInput,
): Promise<ShipmentApvRecord> {
  return db.transaction(async (tx) => {
    const positiveAdjustment = Math.max(0, input.adjustmentMinor);
    let bufferAppliedMinor = 0;
    if (positiveAdjustment > 0) {
      const releaseRows = await tx.execute(sql`
        WITH current_release AS (
          SELECT id, buffer_amount_minor, apv_adjustment_minor, buffer_release_status
            FROM settlement_releases
           WHERE id = ${input.settlementReleaseId}
           FOR UPDATE
        ), allocation AS (
          SELECT id,
                 CASE WHEN buffer_release_status = 'RELEASED' THEN 0
                      ELSE LEAST(
                        ${positiveAdjustment},
                        GREATEST(buffer_amount_minor - COALESCE(apv_adjustment_minor, 0), 0)
                      ) END AS applied_minor
            FROM current_release
        )
        UPDATE settlement_releases AS release
           SET apv_adjustment_minor = COALESCE(release.apv_adjustment_minor, 0) + allocation.applied_minor,
               buffer_release_status = CASE
                 WHEN allocation.applied_minor > 0 THEN 'ADJUSTING'
                 ELSE release.buffer_release_status
               END,
               updated_at = now()
          FROM allocation
         WHERE release.id = allocation.id
        RETURNING allocation.applied_minor
      `) as unknown as Array<Record<string, unknown>>;
      if (!releaseRows[0]) throw new Error("APV_SETTLEMENT_RELEASE_NOT_FOUND");
      bufferAppliedMinor = numeric(releaseRows[0].applied_minor);
    } else {
      const releaseRows = await tx.execute(sql`
        SELECT id
          FROM settlement_releases
         WHERE id = ${input.settlementReleaseId}
         FOR UPDATE
      `) as unknown as Array<Record<string, unknown>>;
      if (!releaseRows[0]) throw new Error("APV_SETTLEMENT_RELEASE_NOT_FOUND");
    }

    const allocation = classifyShipmentApvAllocation(input.adjustmentMinor, bufferAppliedMinor);
    const { status, sellerLiabilityMinor, carrierCreditMinor } = allocation;
    const rows = await tx.execute(sql`
      UPDATE shipment_apv_adjustments
         SET status = ${status}, buffer_applied_minor = ${bufferAppliedMinor},
             assessed_seller_liability_minor = ${sellerLiabilityMinor},
             seller_liability_minor = ${sellerLiabilityMinor}, platform_liability_minor = 0,
             carrier_credit_minor = ${carrierCreditMinor},
             buyer_effect_minor = 0, claim_id = NULL, lease_expires_at = NULL,
             processed_at = now(), updated_at = now(),
             metadata = jsonb_build_object(
               'policy', 'seller_declared_package_responsibility_v1',
               'buyer_effect', 'NONE'
             )
       WHERE provider = ${claim.provider} AND provider_invoice_id = ${claim.providerInvoiceId}
         AND status = 'PROCESSING' AND claim_id = ${claim.claimId}
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
    if (!rows[0]) throw new Error("APV_CLAIM_LOST");
    const completed = mapRecord(rows[0]);
    await tx.execute(sql`
      INSERT INTO shipment_apv_adjustment_revisions
        (adjustment_id, provider, provider_invoice_id, revision_number, invoice_event,
         payload_sha256, webhook_event_id, prior_adjusted_rate_minor, adjusted_rate_minor,
         delta_minor, status, buyer_effect_minor, buffer_applied_minor,
         seller_liability_minor, platform_liability_minor, carrier_credit_minor,
         apply_version, applied_at, metadata, created_at)
      VALUES
        (${completed.id}, ${input.provider}, ${input.providerInvoiceId}, 1, 'created',
         ${shipmentApvPayloadSha256(input)}, ${input.webhookEventId ?? "internal:initial"},
         ${input.originalRateMinor}, ${input.adjustedRateMinor}, ${input.adjustmentMinor},
         ${status}, 0, ${bufferAppliedMinor}, ${sellerLiabilityMinor}, 0, ${carrierCreditMinor},
         1, now(), jsonb_build_object('initial', true), now())
      ON CONFLICT (provider, provider_invoice_id, payload_sha256) DO NOTHING
    `);
    return completed;
  });
}

export async function failShipmentApvAdjustment(
  db: Database,
  claim: ShipmentApvClaim,
): Promise<void> {
  await db.execute(sql`
    UPDATE shipment_apv_adjustments
       SET status = 'FAILED', claim_id = NULL, lease_expires_at = NULL,
           last_error = 'APV_PROCESSING_FAILED', updated_at = now()
     WHERE provider = ${claim.provider} AND provider_invoice_id = ${claim.providerInvoiceId}
       AND status = 'PROCESSING' AND claim_id = ${claim.claimId}
  `);
}
