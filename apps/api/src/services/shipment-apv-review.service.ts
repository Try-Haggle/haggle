import { sql, type Database } from "@haggle/db";

export type ShipmentApvReviewStatus = "NONE" | "PENDING" | "UPHELD" | "WAIVED";

export interface ShipmentApvReviewRecord {
  id: string;
  shipment_id: string;
  order_id: string;
  seller_id: string;
  buyer_id: string;
  status: string;
  review_status: ShipmentApvReviewStatus;
  review_request_id?: string;
  seller_review_reason?: string;
  reviewed_by?: string;
  review_decision_request_id?: string;
  review_decision_reason?: string;
  review_version: number;
  assessed_seller_liability_minor: number;
  seller_liability_minor: number;
  platform_liability_minor: number;
  buyer_effect_minor: 0;
  seller_review_submitted_at?: string;
  reviewed_at?: string;
}

type ReviewOutcome =
  | { outcome: "updated" | "duplicate"; record: ShipmentApvReviewRecord }
  | { outcome: "not_found" | "forbidden" | "invalid_state" | "request_conflict" | "version_conflict" };

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function isoValue(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === "23505" || isUniqueViolation(candidate.cause);
}

function mapReviewRecord(row: Record<string, unknown>): ShipmentApvReviewRecord {
  return {
    id: String(row.id),
    shipment_id: String(row.shipment_id),
    order_id: String(row.order_id),
    seller_id: String(row.seller_id),
    buyer_id: String(row.buyer_id),
    status: String(row.status),
    review_status: String(row.review_status) as ShipmentApvReviewStatus,
    review_request_id: typeof row.review_request_id === "string" ? row.review_request_id : undefined,
    seller_review_reason: typeof row.seller_review_reason === "string" ? row.seller_review_reason : undefined,
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : undefined,
    review_decision_request_id: typeof row.review_decision_request_id === "string" ? row.review_decision_request_id : undefined,
    review_decision_reason: typeof row.review_decision_reason === "string" ? row.review_decision_reason : undefined,
    review_version: numberValue(row.review_version),
    assessed_seller_liability_minor: numberValue(row.assessed_seller_liability_minor),
    seller_liability_minor: numberValue(row.seller_liability_minor),
    platform_liability_minor: numberValue(row.platform_liability_minor),
    buyer_effect_minor: 0,
    seller_review_submitted_at: isoValue(row.seller_review_submitted_at),
    reviewed_at: isoValue(row.reviewed_at),
  };
}

export async function getShipmentApvReview(
  db: Database,
  adjustmentId: string,
): Promise<ShipmentApvReviewRecord | null> {
  const rows = await db.execute(sql`
    SELECT adjustment.*, shipment.seller_id, shipment.buyer_id
      FROM shipment_apv_adjustments AS adjustment
      JOIN shipments AS shipment ON shipment.id = adjustment.shipment_id
     WHERE adjustment.id = ${adjustmentId}
     LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? mapReviewRecord(rows[0]) : null;
}

export async function submitShipmentApvSellerReview(
  db: Database,
  input: { adjustmentId: string; sellerId: string; requestId: string; reason: string },
): Promise<ReviewOutcome> {
  const current = await getShipmentApvReview(db, input.adjustmentId);
  if (!current) return { outcome: "not_found" };
  if (current.seller_id !== input.sellerId) return { outcome: "forbidden" };
  if (current.status !== "REVIEW_REQUIRED") return { outcome: "invalid_state" };
  if (current.review_status !== "NONE") {
    return current.review_request_id === input.requestId
      ? { outcome: "duplicate", record: current }
      : { outcome: "request_conflict" };
  }

  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db.execute(sql`
      UPDATE shipment_apv_adjustments
         SET review_status = 'PENDING', review_request_id = ${input.requestId},
             seller_review_reason = ${input.reason}, seller_review_submitted_at = now(),
             review_version = review_version + 1, updated_at = now()
       WHERE id = ${input.adjustmentId}
         AND status = 'REVIEW_REQUIRED' AND review_status = 'NONE'
         AND review_version = ${current.review_version}
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "request_conflict" };
    throw error;
  }
  if (!rows[0]) return { outcome: "version_conflict" };
  return {
    outcome: "updated",
    record: mapReviewRecord({ ...rows[0], seller_id: current.seller_id, buyer_id: current.buyer_id }),
  };
}

export async function decideShipmentApvReview(
  db: Database,
  input: {
    adjustmentId: string;
    reviewerId: string;
    requestId: string;
    decision: "UPHELD" | "WAIVED";
    reason: string;
    expectedVersion: number;
  },
): Promise<ReviewOutcome> {
  const current = await getShipmentApvReview(db, input.adjustmentId);
  if (!current) return { outcome: "not_found" };
  if (current.review_status !== "PENDING") {
    return current.review_decision_request_id === input.requestId && current.review_status === input.decision
      ? { outcome: "duplicate", record: current }
      : { outcome: "invalid_state" };
  }
  if (current.review_version !== input.expectedVersion) return { outcome: "version_conflict" };

  const sellerLiability = input.decision === "UPHELD" ? current.assessed_seller_liability_minor : 0;
  const platformLiability = input.decision === "WAIVED" ? current.assessed_seller_liability_minor : 0;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = await db.execute(sql`
      UPDATE shipment_apv_adjustments
         SET review_status = ${input.decision}, reviewed_by = ${input.reviewerId},
             review_decision_request_id = ${input.requestId},
             review_decision_reason = ${input.reason}, reviewed_at = now(),
             seller_liability_minor = ${sellerLiability}, platform_liability_minor = ${platformLiability},
             review_version = review_version + 1, updated_at = now()
       WHERE id = ${input.adjustmentId}
         AND review_status = 'PENDING' AND review_version = ${input.expectedVersion}
      RETURNING *
    `) as unknown as Array<Record<string, unknown>>;
  } catch (error) {
    if (isUniqueViolation(error)) return { outcome: "request_conflict" };
    throw error;
  }
  if (!rows[0]) return { outcome: "version_conflict" };
  return {
    outcome: "updated",
    record: mapReviewRecord({ ...rows[0], seller_id: current.seller_id, buyer_id: current.buyer_id }),
  };
}
