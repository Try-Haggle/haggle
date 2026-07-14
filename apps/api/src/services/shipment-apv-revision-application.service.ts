import { sql, type Database } from "@haggle/db";

export type ShipmentApvRevisionDecision = "UPHELD" | "WAIVED" | "APPLY_CREDIT" | "ACKNOWLEDGE";

export interface ShipmentApvRevisionApplicationRecord {
  id: string;
  adjustment_id: string;
  revision_number: number;
  delta_minor: number;
  status: string;
  decision: ShipmentApvRevisionDecision;
  decision_request_id: string;
  buffer_applied_minor: number;
  seller_liability_minor: number;
  platform_liability_minor: number;
  carrier_credit_minor: number;
  buyer_effect_minor: 0;
  apply_version: number;
  applied_at?: string;
}

export type ShipmentApvRevisionApplicationResult =
  | { outcome: "applied" | "duplicate"; revision: ShipmentApvRevisionApplicationRecord }
  | { outcome: "not_found" | "invalid_state" | "invalid_decision" | "evidence_required" | "predecessor_pending" | "aggregate_conflict" | "payout_reserved" | "request_conflict" };

function numeric(value: unknown): number {
  return Number(value ?? 0);
}

function mapRecord(row: Record<string, unknown>): ShipmentApvRevisionApplicationRecord {
  return {
    id: String(row.id),
    adjustment_id: String(row.adjustment_id),
    revision_number: numeric(row.revision_number),
    delta_minor: numeric(row.delta_minor),
    status: String(row.status),
    decision: String(row.decision) as ShipmentApvRevisionDecision,
    decision_request_id: String(row.decision_request_id),
    buffer_applied_minor: numeric(row.buffer_applied_minor),
    seller_liability_minor: numeric(row.seller_liability_minor),
    platform_liability_minor: numeric(row.platform_liability_minor),
    carrier_credit_minor: numeric(row.carrier_credit_minor),
    buyer_effect_minor: 0,
    apply_version: numeric(row.apply_version),
    applied_at: row.applied_at instanceof Date
      ? row.applied_at.toISOString()
      : typeof row.applied_at === "string" ? row.applied_at : undefined,
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === "23505" || isUniqueViolation(candidate.cause);
}

export function isValidShipmentApvRevisionDecision(deltaMinor: number, decision: ShipmentApvRevisionDecision): boolean {
  if (deltaMinor > 0) return decision === "UPHELD" || decision === "WAIVED";
  if (deltaMinor < 0) return decision === "APPLY_CREDIT";
  return decision === "ACKNOWLEDGE";
}

export function allocatePositiveShipmentApvRevision(
  deltaMinor: number,
  decision: "UPHELD" | "WAIVED",
  remainingBufferMinor: number,
) {
  if (decision === "WAIVED") {
    return { bufferAppliedMinor: 0, sellerLiabilityMinor: 0, platformLiabilityMinor: deltaMinor };
  }
  const bufferAppliedMinor = Math.min(deltaMinor, Math.max(0, remainingBufferMinor));
  return {
    bufferAppliedMinor,
    sellerLiabilityMinor: deltaMinor - bufferAppliedMinor,
    platformLiabilityMinor: 0,
  };
}

export function allocateShipmentApvCarrierCredit(
  creditMinor: number,
  burdens: { platformLiabilityMinor: number; sellerLiabilityMinor: number; bufferAppliedMinor: number },
) {
  let remainingCredit = creditMinor;
  const platformCreditMinor = Math.min(remainingCredit, Math.max(0, burdens.platformLiabilityMinor));
  remainingCredit -= platformCreditMinor;
  const sellerCreditMinor = Math.min(remainingCredit, Math.max(0, burdens.sellerLiabilityMinor));
  remainingCredit -= sellerCreditMinor;
  const bufferCreditMinor = Math.min(remainingCredit, Math.max(0, burdens.bufferAppliedMinor));
  remainingCredit -= bufferCreditMinor;
  return { platformCreditMinor, sellerCreditMinor, bufferCreditMinor, unallocatedCreditMinor: remainingCredit };
}

export async function applyShipmentApvInvoiceRevision(
  db: Database,
  input: {
    revisionId: string;
    requestId: string;
    reviewerId: string;
    decision: ShipmentApvRevisionDecision;
    reason: string;
    expectedVersion: number;
  },
): Promise<ShipmentApvRevisionApplicationResult> {
  try {
    return await db.transaction(async (tx) => {
      const revisionRows = await tx.execute(sql`
        SELECT * FROM shipment_apv_adjustment_revisions
         WHERE id = ${input.revisionId}
         FOR UPDATE
      `) as unknown as Array<Record<string, unknown>>;
      const revision = revisionRows[0];
      if (!revision) return { outcome: "not_found" } as const;
      if (revision.status !== "PENDING_REVIEW") {
        return revision.decision_request_id === input.requestId && revision.decision === input.decision
          ? { outcome: "duplicate", revision: mapRecord(revision) } as const
          : { outcome: "invalid_state" } as const;
      }
      if (numeric(revision.apply_version) !== input.expectedVersion) return { outcome: "invalid_state" } as const;

      const deltaMinor = numeric(revision.delta_minor);
      if (!isValidShipmentApvRevisionDecision(deltaMinor, input.decision)) return { outcome: "invalid_decision" } as const;
      if (numeric(revision.revision_number) > 1 && !revision.evidence_sha256) return { outcome: "evidence_required" } as const;
      const predecessorRows = await tx.execute(sql`
        SELECT id FROM shipment_apv_adjustment_revisions
         WHERE adjustment_id = ${String(revision.adjustment_id)}
           AND revision_number < ${numeric(revision.revision_number)}
           AND status = 'PENDING_REVIEW'
         LIMIT 1
      `) as unknown as Array<Record<string, unknown>>;
      if (predecessorRows[0]) return { outcome: "predecessor_pending" } as const;

      const adjustmentRows = await tx.execute(sql`
        SELECT * FROM shipment_apv_adjustments
         WHERE id = ${String(revision.adjustment_id)}
         FOR UPDATE
      `) as unknown as Array<Record<string, unknown>>;
      const adjustment = adjustmentRows[0];
      if (!adjustment) return { outcome: "not_found" } as const;
      const releaseRows = await tx.execute(sql`
        SELECT * FROM settlement_releases
         WHERE id = ${String(adjustment.settlement_release_id)}
         FOR UPDATE
      `) as unknown as Array<Record<string, unknown>>;
      const release = releaseRows[0];
      if (!release) return { outcome: "not_found" } as const;
      const payoutRows = await tx.execute(sql`
        SELECT id FROM shipment_apv_payout_offsets
         WHERE settlement_release_id = ${String(adjustment.settlement_release_id)}
         LIMIT 1
      `) as unknown as Array<Record<string, unknown>>;
      if (payoutRows[0]) return { outcome: "payout_reserved" } as const;
      if (numeric(adjustment.adjusted_rate_minor) !== numeric(revision.prior_adjusted_rate_minor)
        || numeric(adjustment.buffer_applied_minor) !== numeric(release.apv_adjustment_minor)) {
        return { outcome: "aggregate_conflict" } as const;
      }

      let bufferAppliedMinor = 0;
      let sellerLiabilityMinor = 0;
      let platformLiabilityMinor = 0;
      let carrierCreditMinor = 0;
      let platformCreditMinor = 0;
      let sellerCreditMinor = 0;
      let bufferCreditMinor = 0;
      let unallocatedCreditMinor = 0;
      if (deltaMinor > 0) {
        const remainingBuffer = release.buffer_release_status === "RELEASED"
          ? 0
          : Math.max(0, numeric(release.buffer_amount_minor) - numeric(release.apv_adjustment_minor));
        const allocation = allocatePositiveShipmentApvRevision(
          deltaMinor,
          input.decision as "UPHELD" | "WAIVED",
          remainingBuffer,
        );
        bufferAppliedMinor = allocation.bufferAppliedMinor;
        sellerLiabilityMinor = allocation.sellerLiabilityMinor;
        platformLiabilityMinor = allocation.platformLiabilityMinor;
      } else if (deltaMinor < 0) {
        carrierCreditMinor = -deltaMinor;
        const allocation = allocateShipmentApvCarrierCredit(carrierCreditMinor, {
          platformLiabilityMinor: numeric(adjustment.platform_liability_minor),
          sellerLiabilityMinor: numeric(adjustment.seller_liability_minor),
          bufferAppliedMinor: numeric(adjustment.buffer_applied_minor),
        });
        platformCreditMinor = allocation.platformCreditMinor;
        sellerCreditMinor = allocation.sellerCreditMinor;
        bufferCreditMinor = allocation.bufferCreditMinor;
        unallocatedCreditMinor = allocation.unallocatedCreditMinor;
      }

      const bufferDelta = bufferAppliedMinor - bufferCreditMinor;
      if (bufferDelta !== 0) {
        await tx.execute(sql`
          UPDATE settlement_releases
             SET apv_adjustment_minor = GREATEST(0, COALESCE(apv_adjustment_minor, 0) + ${bufferDelta}),
                 buffer_release_status = CASE
                   WHEN GREATEST(0, COALESCE(apv_adjustment_minor, 0) + ${bufferDelta}) = 0 THEN 'HELD'
                   ELSE 'ADJUSTING'
                 END,
                 updated_at = now()
           WHERE id = ${String(adjustment.settlement_release_id)}
        `);
      }

      await tx.execute(sql`
        UPDATE shipment_apv_adjustments
           SET adjusted_rate_minor = ${numeric(revision.adjusted_rate_minor)},
               adjustment_minor = ${numeric(revision.adjusted_rate_minor) - numeric(adjustment.original_rate_minor)},
               buffer_applied_minor = GREATEST(0, buffer_applied_minor + ${bufferDelta}),
               assessed_seller_liability_minor = GREATEST(0, assessed_seller_liability_minor
                 + ${sellerLiabilityMinor + platformLiabilityMinor - sellerCreditMinor - platformCreditMinor}),
               seller_liability_minor = GREATEST(0, seller_liability_minor + ${sellerLiabilityMinor - sellerCreditMinor}),
               platform_liability_minor = GREATEST(0, platform_liability_minor + ${platformLiabilityMinor - platformCreditMinor}),
               carrier_credit_minor = carrier_credit_minor + ${carrierCreditMinor},
               buyer_effect_minor = 0, updated_at = now()
         WHERE id = ${String(revision.adjustment_id)}
      `);

      const status = deltaMinor > 0
        ? input.decision === "WAIVED" ? "WAIVED_TO_PLATFORM" : "APPLIED"
        : deltaMinor < 0 ? "CREDIT_APPLIED" : "ACKNOWLEDGED";
      const appliedRows = await tx.execute(sql`
        UPDATE shipment_apv_adjustment_revisions
           SET status = ${status}, decision_request_id = ${input.requestId}, decision = ${input.decision},
               buffer_applied_minor = ${bufferAppliedMinor}, seller_liability_minor = ${sellerLiabilityMinor},
               platform_liability_minor = ${platformLiabilityMinor}, carrier_credit_minor = ${carrierCreditMinor},
               applied_by = ${input.reviewerId}, decision_reason = ${input.reason}, applied_at = now(),
               apply_version = apply_version + 1,
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                 'credit_policy', 'platform_then_seller_then_buffer_v1',
                 'platform_credit_minor', ${platformCreditMinor}::numeric,
                 'seller_credit_minor', ${sellerCreditMinor}::numeric,
                 'buffer_credit_minor', ${bufferCreditMinor}::numeric,
                 'unallocated_credit_minor', ${unallocatedCreditMinor}::numeric,
                 'buyer_effect', 'NONE'
               )
         WHERE id = ${input.revisionId} AND status = 'PENDING_REVIEW'
           AND apply_version = ${input.expectedVersion}
        RETURNING *
      `) as unknown as Array<Record<string, unknown>>;
      if (!appliedRows[0]) throw new Error("APV_REVISION_APPLICATION_CLAIM_LOST");
      return { outcome: "applied", revision: mapRecord(appliedRows[0]) } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "request_conflict" };
    throw error;
  }
}
