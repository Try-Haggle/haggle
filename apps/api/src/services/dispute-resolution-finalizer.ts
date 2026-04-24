import { and, eq, refunds as refundsTable, type Database } from "@haggle/db";
import type { DisputeCase, DisputeResolution } from "@haggle/dispute-core";
import type { Refund } from "@haggle/payment-core";
import {
  anchorDisputeOnChain,
  computeEvidenceMerkleRoot,
  computeResolutionHash,
} from "../chain/dispute-anchoring.js";
import { refundDeposit } from "../payments/deposit-refunder.js";
import type { DepositPaymentRail } from "../payments/deposit-collector.js";
import { executeRefund } from "../payments/refund-executor.js";
import { createPaymentServiceFromEnv } from "../payments/providers.js";
import {
  createDisputeResolutionRecord,
  updateDisputeRecord,
} from "./dispute-record.service.js";
import {
  getDepositByDisputeId,
  updateDepositStatus,
} from "./dispute-deposit.service.js";
import {
  createRefundRecord,
  getCommerceOrderByOrderId,
  getPaymentIntentByOrderId,
  getPaymentIntentRowById,
  updateCommerceOrderStatus,
} from "./payment-record.service.js";

type AutoRefundResult = {
  refund_id?: string;
  provider_reference?: string | null;
  skipped?: "already_completed";
} | null;

export interface FinalizeDisputeResolutionResult {
  dispute: DisputeCase;
  auto_refund: AutoRefundResult;
  deposit_refund: { tx_hash?: string; refund_id?: string } | null;
}

function createRefundId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusForOutcome(outcome: DisputeResolution["outcome"]): DisputeCase["status"] {
  if (outcome === "buyer_favor") return "RESOLVED_BUYER_FAVOR" as DisputeCase["status"];
  if (outcome === "seller_favor") return "RESOLVED_SELLER_FAVOR" as DisputeCase["status"];
  return "PARTIAL_REFUND" as DisputeCase["status"];
}

async function hasCompletedRefund(db: Database, paymentIntentId: string): Promise<boolean> {
  const existingCompleted = await db
    .select({ id: refundsTable.id })
    .from(refundsTable)
    .where(and(
      eq(refundsTable.paymentIntentId, paymentIntentId),
      eq(refundsTable.status, "COMPLETED"),
    ));
  return existingCompleted.length > 0;
}

async function markRefundStatus(
  db: Database,
  refundId: string,
  status: "COMPLETED" | "FAILED",
  providerReference?: string | null,
): Promise<void> {
  await db
    .update(refundsTable)
    .set({
      status,
      providerReference: providerReference ?? null,
      updatedAt: new Date(),
    })
    .where(eq(refundsTable.id, refundId));
}

async function lookupBuyerWalletAddress(db: Database, buyerId: string): Promise<string | undefined> {
  const walletRow = await db.query.userWallets.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.userId, buyerId),
      ops.eq(fields.isPrimary, true),
    ),
  });
  return walletRow?.walletAddress;
}

async function lookupStripePaymentIntentId(db: Database, intentId: string): Promise<string | undefined> {
  const intentRow = await getPaymentIntentRowById(db, intentId);
  const providerContext = intentRow?.providerContext as Record<string, unknown> | null;
  return providerContext?.stripe_payment_intent_id as string | undefined;
}

async function finalizeBuyerRefund(
  db: Database,
  dispute: DisputeCase,
  resolution: DisputeResolution,
): Promise<AutoRefundResult> {
  const intent = await getPaymentIntentByOrderId(db, dispute.order_id);
  if (!intent) {
    throw new Error("PAYMENT_INTENT_NOT_FOUND");
  }

  const refundAmountMinor = resolution.refund_amount_minor ?? intent.amount.amount_minor;
  if (refundAmountMinor <= 0) {
    throw new Error("INVALID_REFUND_AMOUNT");
  }

  if (await hasCompletedRefund(db, intent.id)) {
    await updateCommerceOrderStatus(db, dispute.order_id, "REFUNDED");
    return { skipped: "already_completed" };
  }

  const refund: Refund = {
    id: createRefundId(),
    payment_intent_id: intent.id,
    amount: {
      currency: intent.amount.currency,
      amount_minor: refundAmountMinor,
    },
    reason_code: `dispute_${resolution.outcome}`,
    status: "REQUESTED",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const paymentService = createPaymentServiceFromEnv();
  const providerResult = await paymentService.refundIntent(intent, refund);
  const providerReference =
    typeof providerResult.metadata?.provider_reference === "string"
      ? providerResult.metadata.provider_reference
      : typeof providerResult.metadata?.refund_id === "string"
        ? providerResult.metadata.refund_id
        : null;

  await createRefundRecord(db, providerResult.refund, providerReference);

  if (providerResult.refund.status === "COMPLETED") {
    await updateCommerceOrderStatus(db, dispute.order_id, "REFUNDED");
    return {
      refund_id: providerResult.refund.id,
      provider_reference: providerReference,
    };
  }

  const order = await getCommerceOrderByOrderId(db, dispute.order_id);
  const refundRail = intent.selected_rail === "stripe" ? "stripe" as const : "usdc" as const;
  const buyerWalletAddress = order ? await lookupBuyerWalletAddress(db, order.buyerId) : undefined;
  const stripePaymentIntentId =
    refundRail === "stripe" ? await lookupStripePaymentIntentId(db, intent.id) : undefined;

  try {
    const refundExecResult = await executeRefund({
      order_id: dispute.order_id,
      buyer_wallet_address: buyerWalletAddress,
      amount_cents: refundAmountMinor,
      rail: refundRail,
      reason: `dispute_${resolution.outcome}`,
      stripe_payment_intent_id: stripePaymentIntentId,
    });
    const executedReference = refundExecResult.tx_hash ?? refundExecResult.refund_id ?? providerReference;
    await markRefundStatus(db, refund.id, "COMPLETED", executedReference);
    await updateCommerceOrderStatus(db, dispute.order_id, "REFUNDED");
    return {
      refund_id: refund.id,
      provider_reference: executedReference,
    };
  } catch (error) {
    await markRefundStatus(db, refund.id, "FAILED", providerReference).catch((updateErr) => {
      console.error(
        "[disputes] Failed to mark refund as FAILED:",
        updateErr instanceof Error ? updateErr.message : String(updateErr),
      );
    });
    throw error;
  }
}

async function finalizeSellerFavor(
  db: Database,
  dispute: DisputeCase,
): Promise<{ tx_hash?: string; refund_id?: string } | null> {
  const deposit = await getDepositByDisputeId(db, dispute.id);
  if (!deposit || deposit.status !== "DEPOSITED") {
    await updateCommerceOrderStatus(db, dispute.order_id, "CLOSED");
    return null;
  }

  const depositMeta = deposit.metadata as Record<string, unknown> | null;
  const depositRail = (depositMeta?.rail as DepositPaymentRail) ?? "mock";
  if (depositRail === "stripe") {
    throw new Error("STRIPE_DEPOSIT_REFUND_REQUIRES_MANUAL_PROCESSING");
  }

  const refundResult = await refundDeposit({
    deposit_id: deposit.id,
    amount_cents: deposit.amountCents,
    seller_wallet_address: depositMeta?.wallet_address as string | undefined,
    stripe_payment_intent_id: depositMeta?.stripe_payment_intent_id as string | undefined,
    rail: depositRail,
  });

  await updateDepositStatus(db, deposit.id, "REFUNDED", {
    resolvedAt: new Date(),
    metadata: {
      ...(depositMeta ?? {}),
      refund_tx_hash: refundResult.tx_hash,
      refund_id: refundResult.refund_id,
      refunded_at: new Date().toISOString(),
    },
  });
  await updateCommerceOrderStatus(db, dispute.order_id, "CLOSED");
  return refundResult;
}

function withPendingAnchorMetadata(dispute: DisputeCase, resolution: DisputeResolution): DisputeCase {
  const evidenceRootHash = computeEvidenceMerkleRoot(dispute.evidence);
  const resolutionHash = computeResolutionHash(resolution);
  return {
    ...dispute,
    metadata: {
      ...(dispute.metadata as Record<string, unknown> ?? {}),
      pending_anchor: true,
      anchor_evidence_root: evidenceRootHash,
      anchor_resolution_hash: resolutionHash,
    },
  };
}

function anchorResolution(dispute: DisputeCase, resolution: DisputeResolution): void {
  anchorDisputeOnChain({
    orderId: dispute.order_id,
    disputeCaseId: dispute.id,
    evidence: dispute.evidence,
    resolution,
  }).catch((anchorErr) => {
    console.error(
      "[disputes] On-chain anchoring failed (fire-and-forget):",
      anchorErr instanceof Error ? anchorErr.message : String(anchorErr),
    );
  });
}

async function persistResolvedDispute(
  db: Database,
  dispute: DisputeCase,
  resolution: DisputeResolution,
): Promise<void> {
  const persist = async (tx: unknown) => {
    const txDb = tx as Database;
    await updateDisputeRecord(txDb, dispute);
    await createDisputeResolutionRecord(txDb, dispute.id, resolution);
  };

  if (typeof db.transaction === "function") {
    await db.transaction(persist);
    return;
  }

  await persist(db);
}

export async function finalizeDisputeResolution(
  db: Database,
  dispute: DisputeCase,
  resolution: DisputeResolution,
  resolvedDispute?: DisputeCase,
): Promise<FinalizeDisputeResolutionResult> {
  let autoRefund: AutoRefundResult = null;
  let depositRefund: { tx_hash?: string; refund_id?: string } | null = null;

  if (resolution.outcome === "buyer_favor" || resolution.outcome === "partial_refund") {
    autoRefund = await finalizeBuyerRefund(db, dispute, resolution);
  } else if (resolution.outcome === "seller_favor") {
    depositRefund = await finalizeSellerFavor(db, dispute);
  }

  const disputeToPersist = withPendingAnchorMetadata({
    ...(resolvedDispute ?? dispute),
    status: resolvedDispute?.status ?? statusForOutcome(resolution.outcome),
    resolution,
  }, resolution);

  await persistResolvedDispute(db, disputeToPersist, resolution);
  anchorResolution(dispute, resolution);

  return {
    dispute: disputeToPersist,
    auto_refund: autoRefund,
    deposit_refund: depositRefund,
  };
}
