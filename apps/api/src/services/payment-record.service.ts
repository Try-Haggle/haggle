import {
  agentPaymentGrants,
  and,
  commerceOrders,
  eq,
  paymentDisclosures,
  paymentAuthorizations,
  paymentIntents,
  paymentOperationIdempotency,
  paymentSettlements,
  refunds,
  settlementApprovals,
  type Database,
} from "@haggle/db";
import type { SettlementApproval } from "@haggle/commerce-core";
import type {
  AgentPaymentGrant,
  AgentPaymentGrantStatus,
  PaymentLegalAcknowledgement,
  PaymentTermTag,
} from "@haggle/commerce-core";
import type {
  BuyerAuthorizationMode,
  PaymentAuthorization,
  PaymentIntent,
  PaymentSettlement,
  Refund,
} from "@haggle/payment-core";
import {
  mapLegacyStatusToProductionState,
  normalizeProductionPaymentState,
  type LegacyPaymentIntentStatus,
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
  const status = row.status as LegacyPaymentIntentStatus;
  const productionStatus = normalizeProductionPaymentState(status, row.canonicalStatus);
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
    status,
    production_status: productionStatus,
    agent_payment_grant_id: row.agentPaymentGrantId ?? undefined,
    approval_policy_hash: row.approvalPolicyHash ?? undefined,
    agreement_hash: row.agreementHash ?? undefined,
    listing_hash: row.listingHash ?? undefined,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapPaymentSettlement(row: typeof paymentSettlements.$inferSelect): PaymentSettlement {
  return {
    id: row.id,
    payment_intent_id: row.paymentIntentId,
    rail: row.rail,
    provider_reference: row.providerReference,
    settled_amount: {
      currency: row.currency,
      amount_minor: parseMinor(row.settledAmountMinor),
    },
    settled_at: toIso(row.settledAt),
    status: row.status,
  };
}

export function mapAgentPaymentGrant(row: typeof agentPaymentGrants.$inferSelect): AgentPaymentGrant & {
  approval_policy_hash: string;
  status: AgentPaymentGrantStatus;
  created_at: string;
  updated_at: string;
} {
  return {
    grant_id: row.id,
    buyer_id: row.buyerId,
    agent_id: row.agentId,
    listing_id: row.listingId,
    seller_id: row.sellerId,
    order_id: row.orderId ?? undefined,
    settlement_approval_id: row.settlementApprovalId ?? undefined,
    max_amount_minor: parseMinor(row.maxAmountMinor),
    currency: row.currency,
    asset: row.asset,
    network: row.network,
    allowed_rails: row.allowedRails as ("x402" | "stripe")[],
    preferred_rail: row.preferredRail,
    terms: row.terms as PaymentTermTag[],
    expires_at: row.expiresAt.toISOString(),
    nonce: row.nonce,
    human_confirmation_required: row.humanConfirmationRequired,
    legal_acknowledgements: row.legalAcknowledgements as PaymentLegalAcknowledgement,
    approval_policy_hash: row.approvalPolicyHash,
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

export async function getAgentPaymentGrantById(db: Database, id: string): Promise<ReturnType<typeof mapAgentPaymentGrant> | null> {
  const row = await db.query.agentPaymentGrants.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ? mapAgentPaymentGrant(row) : null;
}

export async function ensureCommerceOrderForApproval(db: Database, approval: SettlementApproval) {
  // Use insert-on-conflict to prevent TOCTOU race condition.
  // Two concurrent calls with the same approval_id will not create duplicates.
  const [upserted] = await db
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
    .onConflictDoNothing({ target: commerceOrders.settlementApprovalId })
    .returning();

  if (upserted) {
    return upserted;
  }

  // Conflict occurred — return existing row
  const existing = await db.query.commerceOrders.findFirst({
    where: (fields, ops) => ops.eq(fields.settlementApprovalId, approval.id),
  });

  return existing!;
}

export async function createStoredPaymentIntent(
  db: Database,
  intent: PaymentIntent,
  providerContext?: Record<string, unknown>,
) {
  const canonicalStatus = intent.production_status ?? mapLegacyStatusToProductionState(intent.status);
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
      canonicalStatus,
      agentPaymentGrantId: intent.agent_payment_grant_id ?? null,
      approvalPolicyHash: intent.approval_policy_hash ?? null,
      agreementHash: intent.agreement_hash ?? null,
      listingHash: intent.listing_hash ?? null,
      providerContext: providerContext ?? null,
      createdAt: new Date(intent.created_at),
      updatedAt: new Date(intent.updated_at),
    })
    .returning();

  return mapPaymentIntent(row);
}

export async function createAgentPaymentGrantRecord(
  db: Database,
  grant: AgentPaymentGrant,
  approvalPolicyHash: string,
  status: AgentPaymentGrantStatus = "ACTIVE",
) {
  const [row] = await db
    .insert(agentPaymentGrants)
    .values({
      id: grant.grant_id,
      buyerId: grant.buyer_id,
      agentId: grant.agent_id,
      listingId: grant.listing_id,
      sellerId: grant.seller_id,
      orderId: grant.order_id ?? null,
      settlementApprovalId: grant.settlement_approval_id ?? null,
      maxAmountMinor: String(grant.max_amount_minor),
      currency: grant.currency,
      asset: grant.asset,
      network: grant.network,
      allowedRails: grant.allowed_rails,
      preferredRail: grant.preferred_rail,
      terms: grant.terms as unknown as Record<string, unknown>[],
      expiresAt: new Date(grant.expires_at),
      nonce: grant.nonce,
      humanConfirmationRequired: grant.human_confirmation_required,
      legalAcknowledgements: grant.legal_acknowledgements,
      approvalPolicyHash,
      status,
    })
    .onConflictDoNothing({ target: agentPaymentGrants.approvalPolicyHash })
    .returning();

  if (row) {
    return mapAgentPaymentGrant(row);
  }

  const existing = await db.query.agentPaymentGrants.findFirst({
    where: (fields, ops) => ops.eq(fields.approvalPolicyHash, approvalPolicyHash),
  });
  return existing ? mapAgentPaymentGrant(existing) : null;
}

export async function createPaymentDisclosureRecord(
  db: Database,
  input: {
    agent_payment_grant_id: string;
    payment_intent_id?: string;
    rail: "x402" | "stripe";
    version: string;
    text_hash: string;
    accepted_at?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(paymentDisclosures)
    .values({
      agentPaymentGrantId: input.agent_payment_grant_id,
      paymentIntentId: input.payment_intent_id ?? null,
      rail: input.rail,
      version: input.version,
      textHash: input.text_hash,
      acceptedAt: input.accepted_at ? new Date(input.accepted_at) : new Date(),
      metadata: input.metadata ?? null,
    })
    .returning();

  return row;
}

export async function getPaymentIntentById(db: Database, id: string): Promise<PaymentIntent | null> {
  const row = await db.query.paymentIntents.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ? mapPaymentIntent(row) : null;
}

/**
 * Raw payment-intent row (includes providerContext which the DTO drops).
 * Used by admin routes that need to inspect or merge provider metadata.
 */
export async function getPaymentIntentRowById(
  db: Database,
  id: string,
): Promise<typeof paymentIntents.$inferSelect | null> {
  const row = await db.query.paymentIntents.findFirst({
    where: (fields, ops) => ops.eq(fields.id, id),
  });
  return row ?? null;
}

/**
 * Overwrite the providerContext jsonb column for a payment intent. Callers
 * are expected to have merged any existing context before calling this.
 */
export async function setPaymentIntentProviderContext(
  db: Database,
  id: string,
  providerContext: Record<string, unknown>,
): Promise<void> {
  await db
    .update(paymentIntents)
    .set({ providerContext, updatedAt: new Date() })
    .where(eq(paymentIntents.id, id));
}

export async function updateStoredPaymentIntent(
  db: Database,
  intent: PaymentIntent,
  providerContext?: Record<string, unknown>,
) {
  const canonicalStatus = intent.production_status ?? mapLegacyStatusToProductionState(intent.status);
  const [row] = await db
    .update(paymentIntents)
    .set({
      selectedRail: intent.selected_rail,
      allowedRails: intent.allowed_rails,
      buyerAuthorizationMode: intent.buyer_authorization_mode ?? "human_wallet",
      currency: intent.amount.currency,
      amountMinor: String(intent.amount.amount_minor),
      status: intent.status,
      canonicalStatus,
      agentPaymentGrantId: intent.agent_payment_grant_id ?? null,
      approvalPolicyHash: intent.approval_policy_hash ?? null,
      agreementHash: intent.agreement_hash ?? null,
      listingHash: intent.listing_hash ?? null,
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
): Promise<PaymentSettlement> {
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
    .onConflictDoNothing({ target: paymentSettlements.paymentIntentId })
    .returning();

  if (!row) {
    const existing = await db.query.paymentSettlements.findFirst({
      where: (fields, ops) => ops.eq(fields.paymentIntentId, settlement.payment_intent_id),
    });
    if (!existing) {
      throw new Error(`PAYMENT_SETTLEMENT_RECORD_NOT_CREATED:${settlement.payment_intent_id}`);
    }
    return mapPaymentSettlement(existing);
  }

  return mapPaymentSettlement(row);
}

export async function getPaymentSettlementByPaymentIntentId(
  db: Database,
  paymentIntentId: string,
): Promise<PaymentSettlement | null> {
  const row = await db.query.paymentSettlements.findFirst({
    where: (fields, ops) => ops.eq(fields.paymentIntentId, paymentIntentId),
  });
  return row ? mapPaymentSettlement(row) : null;
}

type CommerceOrderStatus =
  | "APPROVED"
  | "PAYMENT_PENDING"
  | "PAID"
  | "FULFILLMENT_PENDING"
  | "FULFILLMENT_ACTIVE"
  | "DELIVERED"
  | "IN_DISPUTE"
  | "REFUNDED"
  | "CLOSED"
  | "CANCELED";

export async function updateCommerceOrderStatus(
  db: Database,
  orderId: string,
  status: CommerceOrderStatus,
): Promise<void> {
  await db
    .update(commerceOrders)
    .set({ status, updatedAt: new Date() })
    .where(eq(commerceOrders.id, orderId));
}

export async function getCommerceOrderByOrderId(
  db: Database,
  orderId: string,
): Promise<typeof commerceOrders.$inferSelect | null> {
  const row = await db.query.commerceOrders.findFirst({
    where: (fields, ops) => ops.eq(fields.id, orderId),
  });
  return row ?? null;
}

export async function getPaymentIntentByOrderId(
  db: Database,
  orderId: string,
): Promise<PaymentIntent | null> {
  const row = await db.query.paymentIntents.findFirst({
    where: (fields, ops) => ops.eq(fields.orderId, orderId),
  });
  return row ? mapPaymentIntent(row) : null;
}

export async function getActivePaymentIntentByOrderId(
  db: Database,
  orderId: string,
): Promise<PaymentIntent | null> {
  const row = await db.query.paymentIntents.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.orderId, orderId),
      ops.inArray(fields.status, ["CREATED", "QUOTED", "AUTHORIZED", "SETTLEMENT_PENDING", "SETTLED"]),
    ),
  });
  return row ? mapPaymentIntent(row) : null;
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

export async function getRefundRecordsByPaymentIntentId(
  db: Database,
  paymentIntentId: string,
): Promise<(typeof refunds.$inferSelect)[]> {
  return db.query.refunds.findMany({
    where: (fields, ops) => ops.eq(fields.paymentIntentId, paymentIntentId),
  });
}

export async function getPaymentOperationIdempotencyRecord(
  db: Database,
  operation: string,
  idempotencyKey: string,
): Promise<typeof paymentOperationIdempotency.$inferSelect | null> {
  const row = await db.query.paymentOperationIdempotency.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.operation, operation),
      ops.eq(fields.idempotencyKey, idempotencyKey),
    ),
  });
  return row ?? null;
}

export async function getInProgressPaymentOperationForIntent(
  db: Database,
  paymentIntentId: string,
  excludeIdempotencyKey?: string,
): Promise<typeof paymentOperationIdempotency.$inferSelect | null> {
  const row = await db.query.paymentOperationIdempotency.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.paymentIntentId, paymentIntentId),
      ops.eq(fields.responseStatus, 409),
    ),
  });
  if (!row || row.idempotencyKey === excludeIdempotencyKey) {
    return null;
  }
  const responseBody = row.responseBody as Record<string, unknown>;
  return responseBody.error === "PAYMENT_OPERATION_IN_PROGRESS" ? row : null;
}

export async function createPaymentOperationIdempotencyRecord(
  db: Database,
  input: {
    operation: string;
    idempotencyKey: string;
    paymentIntentId?: string | null;
    requestHash: string;
    responseStatus: number;
    responseBody: Record<string, unknown>;
  },
): Promise<typeof paymentOperationIdempotency.$inferSelect | null> {
  const [row] = await db
    .insert(paymentOperationIdempotency)
    .values({
      operation: input.operation,
      idempotencyKey: input.idempotencyKey,
      paymentIntentId: input.paymentIntentId ?? null,
      requestHash: input.requestHash,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
    })
    .onConflictDoNothing()
    .returning();

  return row ?? null;
}

export async function completePaymentOperationIdempotencyRecord(
  db: Database,
  operation: string,
  idempotencyKey: string,
  input: {
    responseStatus: number;
    responseBody: Record<string, unknown>;
  },
): Promise<void> {
  await db
    .update(paymentOperationIdempotency)
    .set({
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
    })
    .where(and(
      eq(paymentOperationIdempotency.operation, operation),
      eq(paymentOperationIdempotency.idempotencyKey, idempotencyKey),
    ));
}
