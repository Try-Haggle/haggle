import { type Database, sql } from "@haggle/db";
import {
  type ShipmentApvInput,
  shipmentApvPayloadSha256,
} from "./shipment-apv-adjustment.service.js";

export interface ShipmentApvRevisionRecord {
  id: string;
  adjustment_id: string;
  provider: string;
  provider_invoice_id: string;
  revision_number: number;
  invoice_event: "created" | "updated";
  payload_sha256: string;
  webhook_event_id: string;
  prior_adjusted_rate_minor: number;
  adjusted_rate_minor: number;
  delta_minor: number;
  status:
    | "APPLIED"
    | "REVIEW_REQUIRED"
    | "CREDIT_RECORDED"
    | "PENDING_REVIEW"
    | "WAIVED_TO_PLATFORM"
    | "CREDIT_APPLIED"
    | "ACKNOWLEDGED";
  buyer_effect_minor: 0;
  decision?: "UPHELD" | "WAIVED" | "APPLY_CREDIT" | "ACKNOWLEDGE";
  buffer_applied_minor: number;
  seller_liability_minor: number;
  platform_liability_minor: number;
  carrier_credit_minor: number;
  apply_version: number;
  applied_at?: string;
  evidence_sha256?: string;
  provider_document_id?: string;
  surcharge_category?: string;
  surcharge_type?: string;
  evidence_amount_minor?: number;
  evidence_currency?: string;
  created_at?: string;
}

export type ShipmentApvRevisionResult =
  | { outcome: "recorded" | "duplicate"; revision: ShipmentApvRevisionRecord }
  | {
      outcome:
        | "not_found"
        | "identity_conflict"
        | "base_revision_missing"
        | "amount_conflict"
        | "payout_reserved";
    };

export function isValidShipmentApvRevisionAmount(
  input: Pick<ShipmentApvInput, "originalRateMinor" | "adjustedRateMinor" | "adjustmentMinor">,
): boolean {
  return (
    Number.isSafeInteger(input.originalRateMinor) &&
    Number.isSafeInteger(input.adjustedRateMinor) &&
    Number.isSafeInteger(input.adjustmentMinor) &&
    input.originalRateMinor >= 0 &&
    input.adjustedRateMinor >= 0 &&
    input.originalRateMinor <= 10_000_000 &&
    input.adjustedRateMinor <= 10_000_000 &&
    input.adjustedRateMinor - input.originalRateMinor === input.adjustmentMinor
  );
}

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function mapRevision(row: Record<string, unknown>): ShipmentApvRevisionRecord {
  return {
    id: String(row.id),
    adjustment_id: String(row.adjustment_id),
    provider: String(row.provider),
    provider_invoice_id: String(row.provider_invoice_id),
    revision_number: numeric(row.revision_number),
    invoice_event: String(row.invoice_event) as "created" | "updated",
    payload_sha256: String(row.payload_sha256),
    webhook_event_id: String(row.webhook_event_id),
    prior_adjusted_rate_minor: numeric(row.prior_adjusted_rate_minor),
    adjusted_rate_minor: numeric(row.adjusted_rate_minor),
    delta_minor: numeric(row.delta_minor),
    status: String(row.status) as ShipmentApvRevisionRecord["status"],
    buyer_effect_minor: 0,
    decision:
      typeof row.decision === "string"
        ? (row.decision as ShipmentApvRevisionRecord["decision"])
        : undefined,
    buffer_applied_minor: numeric(row.buffer_applied_minor),
    seller_liability_minor: numeric(row.seller_liability_minor),
    platform_liability_minor: numeric(row.platform_liability_minor),
    carrier_credit_minor: numeric(row.carrier_credit_minor),
    apply_version: numeric(row.apply_version),
    applied_at:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : typeof row.applied_at === "string"
          ? row.applied_at
          : undefined,
    evidence_sha256: typeof row.evidence_sha256 === "string" ? row.evidence_sha256 : undefined,
    provider_document_id:
      typeof row.provider_document_id === "string" ? row.provider_document_id : undefined,
    surcharge_category:
      typeof row.surcharge_category === "string" ? row.surcharge_category : undefined,
    surcharge_type: typeof row.surcharge_type === "string" ? row.surcharge_type : undefined,
    evidence_amount_minor:
      row.evidence_amount_minor === null || row.evidence_amount_minor === undefined
        ? undefined
        : numeric(row.evidence_amount_minor),
    evidence_currency:
      typeof row.evidence_currency === "string" ? row.evidence_currency : undefined,
    created_at:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : typeof row.created_at === "string"
          ? row.created_at
          : undefined,
  };
}

export async function listShipmentApvInvoiceRevisions(
  db: Database,
  adjustmentId: string,
): Promise<ShipmentApvRevisionRecord[]> {
  const rows = (await db.execute(sql`
    SELECT * FROM shipment_apv_adjustment_revisions
     WHERE adjustment_id = ${adjustmentId}
     ORDER BY revision_number ASC
  `)) as unknown as Array<Record<string, unknown>>;
  return rows.map(mapRevision);
}

export async function recordShipmentApvInvoiceRevision(
  db: Database,
  input: ShipmentApvInput & { invoiceEvent: "updated"; webhookEventId: string },
): Promise<ShipmentApvRevisionResult> {
  if (!isValidShipmentApvRevisionAmount(input)) return { outcome: "amount_conflict" };
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${input.provider}:${input.providerInvoiceId}`}, 0))
    `);
    const adjustmentRows = (await tx.execute(sql`
      SELECT * FROM shipment_apv_adjustments
       WHERE provider = ${input.provider} AND provider_invoice_id = ${input.providerInvoiceId}
       FOR UPDATE
    `)) as unknown as Array<Record<string, unknown>>;
    const adjustment = adjustmentRows[0];
    if (!adjustment) return { outcome: "not_found" } as const;
    if (
      adjustment.shipment_id !== input.shipmentId ||
      adjustment.order_id !== input.orderId ||
      adjustment.settlement_release_id !== input.settlementReleaseId ||
      numeric(adjustment.original_rate_minor) !== input.originalRateMinor
    ) {
      return { outcome: "identity_conflict" } as const;
    }
    const payoutRows = (await tx.execute(sql`
      SELECT id FROM shipment_apv_payout_offsets
       WHERE settlement_release_id = ${input.settlementReleaseId}
       LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    if (payoutRows[0]) return { outcome: "payout_reserved" } as const;

    const payloadSha256 = shipmentApvPayloadSha256(input);
    const duplicateRows = (await tx.execute(sql`
      SELECT * FROM shipment_apv_adjustment_revisions
       WHERE provider = ${input.provider} AND provider_invoice_id = ${input.providerInvoiceId}
         AND payload_sha256 = ${payloadSha256}
       LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    if (duplicateRows[0])
      return { outcome: "duplicate", revision: mapRevision(duplicateRows[0]) } as const;

    const priorRows = (await tx.execute(sql`
      SELECT revision_number, adjusted_rate_minor
        FROM shipment_apv_adjustment_revisions
       WHERE adjustment_id = ${String(adjustment.id)}
       ORDER BY revision_number DESC
       LIMIT 1
    `)) as unknown as Array<Record<string, unknown>>;
    if (!priorRows[0]) return { outcome: "base_revision_missing" } as const;
    const priorAdjustedRateMinor = numeric(priorRows[0].adjusted_rate_minor);
    const revisionNumber = numeric(priorRows[0].revision_number) + 1;
    const deltaMinor = input.adjustedRateMinor - priorAdjustedRateMinor;
    const rows = (await tx.execute(sql`
      INSERT INTO shipment_apv_adjustment_revisions
        (adjustment_id, provider, provider_invoice_id, revision_number, invoice_event,
         payload_sha256, webhook_event_id, prior_adjusted_rate_minor, adjusted_rate_minor,
         delta_minor, status, buyer_effect_minor, metadata, created_at)
      VALUES
        (${String(adjustment.id)}, ${input.provider}, ${input.providerInvoiceId}, ${revisionNumber}, 'updated',
         ${payloadSha256}, ${input.webhookEventId}, ${priorAdjustedRateMinor}, ${input.adjustedRateMinor},
         ${deltaMinor}, 'PENDING_REVIEW', 0,
         jsonb_build_object('original_rate_minor', ${input.originalRateMinor}::numeric, 'automatic_money_effect', false), now())
      RETURNING *
    `)) as unknown as Array<Record<string, unknown>>;
    return { outcome: "recorded", revision: mapRevision(rows[0]!) } as const;
  });
}
