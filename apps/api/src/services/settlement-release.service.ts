import {
  settlementReleases,
  eq,
  type Database,
} from "@haggle/db";
import type { SettlementRelease } from "@haggle/payment-core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseMinor(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapRelease(row: typeof settlementReleases.$inferSelect): SettlementRelease {
  return {
    id: row.id,
    payment_intent_id: row.paymentIntentId,
    order_id: row.orderId,

    // Phase 1: Product payment
    product_amount: {
      amount_minor: parseMinor(row.productAmountMinor),
      currency: row.productCurrency,
    },
    product_release_status: row.productReleaseStatus as SettlementRelease["product_release_status"],
    delivery_confirmed_at: toIso(row.deliveryConfirmedAt),
    buyer_review_deadline: toIso(row.buyerReviewDeadline),
    product_released_at: toIso(row.productReleasedAt),

    // Phase 2: Weight buffer
    buffer_amount: {
      amount_minor: parseMinor(row.bufferAmountMinor),
      currency: row.bufferCurrency,
    },
    buffer_release_status: row.bufferReleaseStatus as SettlementRelease["buffer_release_status"],
    buffer_release_deadline: toIso(row.bufferReleaseDeadline),
    apv_adjustment_minor: parseMinor(row.apvAdjustmentMinor),
    buffer_final_amount_minor: row.bufferFinalAmountMinor != null
      ? parseMinor(row.bufferFinalAmountMinor)
      : undefined,
    buffer_released_at: toIso(row.bufferReleasedAt),

    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createSettlementReleaseRecord(
  db: Database,
  release: SettlementRelease,
): Promise<SettlementRelease> {
  const [row] = await db
    .insert(settlementReleases)
    .values({
      id: release.id,
      paymentIntentId: release.payment_intent_id,
      orderId: release.order_id,

      productAmountMinor: String(release.product_amount.amount_minor),
      productCurrency: release.product_amount.currency,
      productReleaseStatus: release.product_release_status,
      deliveryConfirmedAt: release.delivery_confirmed_at
        ? new Date(release.delivery_confirmed_at)
        : null,
      buyerReviewDeadline: release.buyer_review_deadline
        ? new Date(release.buyer_review_deadline)
        : null,
      productReleasedAt: release.product_released_at
        ? new Date(release.product_released_at)
        : null,

      bufferAmountMinor: String(release.buffer_amount.amount_minor),
      bufferCurrency: release.buffer_amount.currency,
      bufferReleaseStatus: release.buffer_release_status,
      bufferReleaseDeadline: release.buffer_release_deadline
        ? new Date(release.buffer_release_deadline)
        : null,
      apvAdjustmentMinor: String(release.apv_adjustment_minor),
      bufferFinalAmountMinor: release.buffer_final_amount_minor != null
        ? String(release.buffer_final_amount_minor)
        : null,
      bufferReleasedAt: release.buffer_released_at
        ? new Date(release.buffer_released_at)
        : null,

      createdAt: new Date(release.created_at),
      updatedAt: new Date(release.updated_at),
    })
    .onConflictDoNothing({ target: settlementReleases.orderId })
    .returning();

  if (!row) {
    const existing = await getSettlementReleaseByOrderId(db, release.order_id);
    if (!existing) {
      throw new Error(`settlement release insert conflicted but no row found for order ${release.order_id}`);
    }
    return existing;
  }

  return mapRelease(row);
}

export async function getSettlementReleaseById(
  db: Database,
  id: string,
): Promise<SettlementRelease | null> {
  const row = await db.query.settlementReleases.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ? mapRelease(row) : null;
}

export async function getSettlementReleaseByOrderId(
  db: Database,
  orderId: string,
): Promise<SettlementRelease | null> {
  const row = await db.query.settlementReleases.findFirst({
    where: (fields, ops) => ops.eq(fields.orderId, orderId),
  });
  return row ? mapRelease(row) : null;
}

export async function getSettlementReleaseByPaymentIntentId(
  db: Database,
  paymentIntentId: string,
): Promise<SettlementRelease | null> {
  const row = await db.query.settlementReleases.findFirst({
    where: (fields, ops) => ops.eq(fields.paymentIntentId, paymentIntentId),
  });
  return row ? mapRelease(row) : null;
}

export async function updateSettlementReleaseRecord(
  db: Database,
  release: SettlementRelease,
): Promise<void> {
  await db
    .update(settlementReleases)
    .set({
      productAmountMinor: String(release.product_amount.amount_minor),
      productCurrency: release.product_amount.currency,
      productReleaseStatus: release.product_release_status,
      deliveryConfirmedAt: release.delivery_confirmed_at
        ? new Date(release.delivery_confirmed_at)
        : null,
      buyerReviewDeadline: release.buyer_review_deadline
        ? new Date(release.buyer_review_deadline)
        : null,
      productReleasedAt: release.product_released_at
        ? new Date(release.product_released_at)
        : null,

      bufferAmountMinor: String(release.buffer_amount.amount_minor),
      bufferCurrency: release.buffer_amount.currency,
      bufferReleaseStatus: release.buffer_release_status,
      bufferReleaseDeadline: release.buffer_release_deadline
        ? new Date(release.buffer_release_deadline)
        : null,
      apvAdjustmentMinor: String(release.apv_adjustment_minor),
      bufferFinalAmountMinor: release.buffer_final_amount_minor != null
        ? String(release.buffer_final_amount_minor)
        : null,
      bufferReleasedAt: release.buffer_released_at
        ? new Date(release.buffer_released_at)
        : null,

      updatedAt: new Date(release.updated_at),
    })
    .where(eq(settlementReleases.id, release.id));
}
