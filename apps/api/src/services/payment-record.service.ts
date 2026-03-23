import {
  commerceOrders,
  eq,
  paymentAuthorizations,
  paymentIntents,
  paymentSettlements,
  refunds,
  settlementApprovals,
  type Database,
} from "@haggle/db";
import type { SettlementApproval } from "@haggle/commerce-core";
import type {
  BuyerAuthorizationMode,
  PaymentAuthorization,
  PaymentIntent,
  PaymentSettlement,
  Refund,
} from "@haggle/payment-core";

function parseMinor(value: string | number): number {
  if (typeof value === "number") {
    return value;
  }
  return Number(value);
}

function toIso(value: Date | string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function mapSettlementApproval(row: typeof settlementApprovals.$inferSelect): SettlementApproval {
  const termsSnapshot = row.termsSnapshot as Record<string, unknown>;
  return {
    id: row.id,
    approval_state: row.approvalState,
    seller_policy: {
      mode: row.sellerApprovalMode,
      fulfillment_sla: {
        shipment_input_due_days:
          Number((termsSnapshot.seller_policy_shipment_input_due_days as number | string | undefined) ?? 0) ||
          0,
      },
      responsiveness: {
        median_response_minutes: Number((termsSnapshot.seller_policy_median_response_minutes as number | string | undefined) ?? 0) || 0,
        p95_response_minutes: Number((termsSnapshot.seller_policy_p95_response_minutes as number | string | undefined) ?? 0) || 0,
        reliable_fast_responder: Boolean(termsSnapshot.seller_policy_reliable_fast_responder),
      },
      auto_approval_price_guard_minor:
        termsSnapshot.seller_policy_auto_approval_price_guard_minor == null
          ? undefined
          : Number(termsSnapshot.seller_policy_auto_approval_price_guard_minor),
    },
    terms: {
      listing_id: row.listingId,
      seller_id: row.sellerId,
      buyer_id: row.buyerId,
      final_amount_minor: parseMinor(row.finalAmountMinor),
      currency: row.currency,
      selected_payment_rail: row.selectedPaymentRail,
      shipment_input_due_at: toIso(row.shipmentInputDueAt),
    },
    hold_snapshot: row.holdKind
      ? {
          kind: row.holdKind,
          held_snapshot_price_minor: row.heldSnapshotPriceMinor ? parseMinor(row.heldSnapshotPriceMinor) : 0,
          held_snapshot_utility: row.heldSnapshotUtility == null ? undefined : Number(row.heldSnapshotUtility),
          held_at: toIso(row.heldAt) ?? row.createdAt.toISOString(),
          hold_reason: row.holdReason ?? undefined,
          resume_reprice_required: row.resumeRepriceRequired,
          expires_at: toIso(row.reservedUntil),
        }
      : undefined,
    buyer_approved_at: toIso(row.buyerApprovedAt),
    seller_approved_at: toIso(row.sellerApprovedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapPaymentIntent(row: typeof paymentIntents.$inferSelect): PaymentIntent {
  return {
    id: row.id,
    order_id: row.orderId,
    seller_id: row.sellerId,
    buyer_id: row.buyerId,
    selected_rail: row.selectedRail,
    allowed_rails: row.allowedRails as ("x402" | "stripe")[],
    buyer_authorization_mode: row.buyerAuthorizationMode as BuyerAuthorizationMode,
    amount: {
      currency: row.currency,
      amount_minor: parseMinor(row.amountMinor),
    },
    status: row.status,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function getSettlementApprovalById(db: Database, id: string): Promise<SettlementApproval | null> {
  const row = await db.query.settlementApprovals.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ? mapSettlementApproval(row) : null;
}

export async function ensureCommerceOrderForApproval(db: Database, approval: SettlementApproval) {
  const existing = await db.query.commerceOrders.findFirst({
    where: (fields, ops) => ops.eq(fields.settlementApprovalId, approval.id),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(commerceOrders)
    .values({
      settlementApprovalId: approval.id,
      listingId: approval.terms.listing_id,
      sellerId: approval.terms.seller_id,
      buyerId: approval.terms.buyer_id,
      status: "PAYMENT_PENDING",
      currency: approval.terms.currency,
      amountMinor: String(approval.terms.final_amount_minor),
      orderSnapshot: {
        settlement_approval_id: approval.id,
        terms: approval.terms,
        seller_policy: approval.seller_policy,
        hold_snapshot: approval.hold_snapshot ?? null,
      },
    })
    .returning();

  return created;
}

export async function createStoredPaymentIntent(
  db: Database,
  intent: PaymentIntent,
  providerContext?: Record<string, unknown>,
) {
  const [row] = await db
    .insert(paymentIntents)
    .values({
      id: intent.id,
      orderId: intent.order_id,
      sellerId: intent.seller_id,
      buyerId: intent.buyer_id,
      selectedRail: intent.selected_rail,
      allowedRails: intent.allowed_rails,
      buyerAuthorizationMode: intent.buyer_authorization_mode ?? "human_wallet",
      currency: intent.amount.currency,
      amountMinor: String(intent.amount.amount_minor),
      status: intent.status,
      providerContext: providerContext ?? null,
      createdAt: new Date(intent.created_at),
      updatedAt: new Date(intent.updated_at),
    })
    .returning();

  return mapPaymentIntent(row);
}

export async function getPaymentIntentById(db: Database, id: string): Promise<PaymentIntent | null> {
  const row = await db.query.paymentIntents.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ? mapPaymentIntent(row) : null;
}

export async function updateStoredPaymentIntent(
  db: Database,
  intent: PaymentIntent,
  providerContext?: Record<string, unknown>,
) {
  const [row] = await db
    .update(paymentIntents)
    .set({
      selectedRail: intent.selected_rail,
      allowedRails: intent.allowed_rails,
      buyerAuthorizationMode: intent.buyer_authorization_mode ?? "human_wallet",
      currency: intent.amount.currency,
      amountMinor: String(intent.amount.amount_minor),
      status: intent.status,
      providerContext: providerContext,
      updatedAt: new Date(intent.updated_at),
    })
    .where(eq(paymentIntents.id, intent.id))
    .returning();

  return row ? mapPaymentIntent(row) : null;
}

export async function createPaymentAuthorizationRecord(
  db: Database,
  authorization: PaymentAuthorization,
  metadata?: Record<string, unknown>,
) {
  const [row] = await db
    .insert(paymentAuthorizations)
    .values({
      id: authorization.id,
      paymentIntentId: authorization.payment_intent_id,
      rail: authorization.rail,
      providerReference: authorization.provider_reference,
      authorizedAmountMinor: String(authorization.authorized_amount.amount_minor),
      currency: authorization.authorized_amount.currency,
      metadata: metadata ?? null,
      createdAt: new Date(authorization.created_at),
    })
    .returning();

  return row;
}

export async function createPaymentSettlementRecord(
  db: Database,
  settlement: PaymentSettlement,
) {
  const [row] = await db
    .insert(paymentSettlements)
    .values({
      id: settlement.id,
      paymentIntentId: settlement.payment_intent_id,
      rail: settlement.rail,
      providerReference: settlement.provider_reference,
      settledAmountMinor: String(settlement.settled_amount.amount_minor),
      currency: settlement.settled_amount.currency,
      status: settlement.status,
      settledAt: settlement.settled_at ? new Date(settlement.settled_at) : null,
    })
    .returning();

  return row;
}

export async function createRefundRecord(db: Database, refund: Refund, providerReference?: string | null) {
  const [row] = await db
    .insert(refunds)
    .values({
      id: refund.id,
      paymentIntentId: refund.payment_intent_id,
      amountMinor: String(refund.amount.amount_minor),
      currency: refund.amount.currency,
      reasonCode: refund.reason_code,
      status: refund.status,
      providerReference: providerReference ?? null,
      createdAt: new Date(refund.created_at),
      updatedAt: new Date(refund.updated_at),
    })
    .returning();

  return row;
}
