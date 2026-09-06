import { randomUUID } from "node:crypto";
import type { FulfillmentType } from "@haggle/commerce-core";
import { type Database, eq, fulfillments } from "@haggle/db";

export type FulfillmentRecordStatus =
  | "AWAITING_SELLER_ACTION"
  | "PROOF_SUBMITTED"
  | "AWAITING_BUYER_CONFIRMATION"
  | "FULFILLED"
  | "DISPUTED"
  | "CANCELED";

export type FulfillmentProofStatus =
  | "PENDING"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "NOT_REQUIRED";

export interface FulfillmentRecord {
  id: string;
  order_id: string;
  payment_intent_id?: string;
  fulfillment_type: FulfillmentType;
  status: FulfillmentRecordStatus;
  proof_required: boolean;
  proof_status: FulfillmentProofStatus;
  fulfilled_at?: string;
  review_window_hours: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapFulfillment(row: typeof fulfillments.$inferSelect): FulfillmentRecord {
  return {
    id: row.id,
    order_id: row.orderId,
    payment_intent_id: row.paymentIntentId ?? undefined,
    fulfillment_type: row.fulfillmentType as FulfillmentType,
    status: row.status as FulfillmentRecordStatus,
    proof_required: row.proofRequired,
    proof_status: row.proofStatus as FulfillmentProofStatus,
    fulfilled_at: toIso(row.fulfilledAt),
    review_window_hours: row.reviewWindowHours,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function proofDefaultsForType(fulfillmentType: FulfillmentType): {
  proof_required: boolean;
  proof_status: FulfillmentProofStatus;
} {
  if (fulfillmentType === "local_pickup") {
    return { proof_required: false, proof_status: "NOT_REQUIRED" };
  }
  return { proof_required: true, proof_status: "PENDING" };
}

export async function getFulfillmentByOrderId(
  db: Database,
  orderId: string,
): Promise<FulfillmentRecord | null> {
  const row = await db.query.fulfillments.findFirst({
    where: (fields, ops) => ops.eq(fields.orderId, orderId),
  });
  return row ? mapFulfillment(row) : null;
}

export async function createFulfillmentRecord(
  db: Database,
  input: {
    order_id: string;
    payment_intent_id?: string;
    fulfillment_type: FulfillmentType;
    review_window_hours?: number;
    metadata?: Record<string, unknown>;
    now?: string;
  },
): Promise<FulfillmentRecord> {
  const now = input.now ?? new Date().toISOString();
  const proof = proofDefaultsForType(input.fulfillment_type);
  const id = randomUUID();

  const [row] = await db
    .insert(fulfillments)
    .values({
      id,
      orderId: input.order_id,
      paymentIntentId: input.payment_intent_id ?? null,
      fulfillmentType: input.fulfillment_type,
      status: "AWAITING_SELLER_ACTION",
      proofRequired: proof.proof_required,
      proofStatus: proof.proof_status,
      reviewWindowHours: input.review_window_hours ?? 24,
      metadata: input.metadata ?? {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })
    .onConflictDoNothing({ target: fulfillments.orderId })
    .returning();

  if (!row) {
    const existing = await getFulfillmentByOrderId(db, input.order_id);
    if (!existing) {
      throw new Error(`fulfillment insert conflicted but no row found for order ${input.order_id}`);
    }
    return existing;
  }

  return mapFulfillment(row);
}

export async function ensureFulfillmentRecordForOrder(
  db: Database,
  input: {
    order_id: string;
    payment_intent_id?: string;
    fulfillment_type: FulfillmentType;
    review_window_hours?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<{ fulfillment: FulfillmentRecord; created: boolean }> {
  const existing = await getFulfillmentByOrderId(db, input.order_id);
  if (existing) {
    return { fulfillment: existing, created: false };
  }
  const fulfillment = await createFulfillmentRecord(db, input);
  return { fulfillment, created: true };
}

export async function updateFulfillmentRecord(
  db: Database,
  fulfillment: FulfillmentRecord,
): Promise<void> {
  await db
    .update(fulfillments)
    .set({
      status: fulfillment.status,
      proofRequired: fulfillment.proof_required,
      proofStatus: fulfillment.proof_status,
      fulfilledAt: fulfillment.fulfilled_at ? new Date(fulfillment.fulfilled_at) : null,
      reviewWindowHours: fulfillment.review_window_hours,
      metadata: fulfillment.metadata,
      updatedAt: new Date(fulfillment.updated_at),
    })
    .where(eq(fulfillments.id, fulfillment.id));
}
