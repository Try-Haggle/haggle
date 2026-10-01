import { and, type Database, eq, refunds as refundsTable } from "@haggle/db";
import type { DisputeCase, DisputeResolution } from "@haggle/dispute-core";
import type { Refund } from "@haggle/payment-core";
import {
  anchorDisputeOnChain,
  computeEvidenceMerkleRoot,
  computeResolutionHash,
  uuidToBytes32,
} from "../chain/dispute-anchoring.js";
import { t1HumanApprovalBlocksMoneyMovement } from "../lib/dispute-t1-human-review-gate.js";
import type { DepositPaymentRail } from "../payments/deposit-collector.js";
import { refundDeposit } from "../payments/deposit-refunder.js";
import { createPaymentServiceFromEnv } from "../payments/providers.js";
import { executeRefund } from "../payments/refund-executor.js";
import {
  finalizeReviewBonds,
  finalizeSellerDefaultBonds,
  readBondTier,
} from "./dispute-bond-escrow.service.js";
import {
  getDepositByDisputeId,
  getReviewDeposits,
  updateDepositStatus,
} from "./dispute-deposit.service.js";
import {
  buildDisputeModuleWebhookEnvelope,
  createDisputeModuleWebhookOutboxRecord,
  type DisputeModuleWebhookEnvelope,
  type DisputeModuleWebhookOutboxRecord,
  deliverDisputeModuleWebhookOutboxRecord,
} from "./dispute-module-webhook.service.js";
import { createDisputeResolutionRecord, updateDisputeRecord } from "./dispute-record.service.js";
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
  review_bond_settlement?: { tx_hash: string | null; fee_cents: number } | null;
  module_settlement_webhook: DisputeModuleWebhookOutboxRecord | null;
}

async function finalizeTwoPartyReviewBonds(
  db: Database,
  dispute: DisputeCase,
  resolution: DisputeResolution,
): Promise<{ tx_hash: string | null; fee_cents: number }> {
  const metadata = (dispute.metadata ?? {}) as Record<string, unknown>;
  const tier = Number(metadata.tier);
  if ((tier !== 2 && tier !== 3) || metadata.review_phase !== "ACTIVE") {
    throw new Error("REVIEW_BONDS_NOT_READY_FOR_SETTLEMENT");
  }
  if (!["buyer_favor", "seller_favor", "partial_refund"].includes(resolution.outcome)) {
    throw new Error("REVIEW_BOND_OUTCOME_UNSUPPORTED");
  }
  const sellerWon = resolution.outcome === "seller_favor";
  const bonds = await getReviewDeposits(db, dispute.id);
  const expectedCount = tier === 2 ? 2 : 4;
  if (bonds.length !== expectedCount) throw new Error("REVIEW_BONDS_INCOMPLETE");
  let feeCents = 0;
  for (const reviewedTier of (tier === 2 ? [2] : [2, 3]) as (2 | 3)[]) {
    const pair = bonds.filter((bond) => bond.tier === reviewedTier);
    if (
      pair.length !== 2 ||
      !pair.some((bond) => bond.party === "buyer") ||
      !pair.some((bond) => bond.party === "seller") ||
      pair.some((bond) => {
        const target = bond.party === (sellerWon ? "seller" : "buyer") ? "REFUNDED" : "FORFEITED";
        return bond.status !== "DEPOSITED" && bond.status !== target;
      }) ||
      pair[0].amountCents !== pair[1].amountCents
    ) {
      throw new Error("REVIEW_BONDS_INCOMPLETE");
    }
    feeCents += pair[0].amountCents;
  }
  const mockOnly = bonds.every((bond) => bond.metadata?.rail === "mock");
  const mockAllowed =
    process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
  let txHash: string | null = null;
  if (mockOnly) {
    if (!mockAllowed) throw new Error("MOCK_REVIEW_BONDS_FORBIDDEN");
  } else {
    if (bonds.some((bond) => bond.metadata?.rail !== "usdc")) {
      throw new Error("REVIEW_BOND_RAIL_MISMATCH");
    }
    for (const reviewedTier of (tier === 2 ? [2] : [2, 3]) as (2 | 3)[]) {
      const onChain = await readBondTier(dispute.id, reviewedTier);
      if (onChain.state !== 2 && onChain.state !== 4) {
        throw new Error("REVIEW_BOND_ONCHAIN_REVIEW_NOT_STARTED");
      }
    }
    const settlement = await finalizeReviewBonds(dispute.id, sellerWon);
    if (settlement.feeCents !== feeCents) throw new Error("REVIEW_BOND_FEE_MISMATCH");
    txHash = settlement.txHash;
  }
  for (const bond of bonds) {
    const winner = bond.party === (sellerWon ? "seller" : "buyer");
    const target = winner ? "REFUNDED" : "FORFEITED";
    if (bond.status === target) continue;
    if (bond.status !== "DEPOSITED") throw new Error("REVIEW_BOND_SETTLEMENT_STATE_MISMATCH");
    await updateDepositStatus(db, bond.id, target, {
      resolvedAt: new Date(),
      metadata: {
        ...(bond.metadata ?? {}),
        settlement_tx_hash: txHash,
        review_fee_cents: winner ? 0 : bond.amountCents,
        reviewer_payment_status: "HELD",
      },
    });
  }
  return { tx_hash: txHash, fee_cents: feeCents };
}

async function finalizeUnfundedSellerReview(
  db: Database,
  dispute: DisputeCase,
  resolution: DisputeResolution,
): Promise<{ tx_hash: string | null; fee_cents: number }> {
  const metadata = (dispute.metadata ?? {}) as Record<string, unknown>;
  const tier = Number(metadata.tier);
  if (
    (tier !== 2 && tier !== 3) ||
    metadata.review_phase !== "SELLER_DEFAULT" ||
    resolution.outcome !== "buyer_favor"
  ) {
    throw new Error("SELLER_DEFAULT_RESOLUTION_INVALID");
  }
  const bonds = await getReviewDeposits(db, dispute.id);
  if (bonds.length !== (tier === 2 ? 2 : 4)) throw new Error("REVIEW_BONDS_INCOMPLETE");
  const currentBuyer = bonds.find((bond) => bond.tier === tier && bond.party === "buyer");
  const currentSeller = bonds.find((bond) => bond.tier === tier && bond.party === "seller");
  if (
    !currentBuyer ||
    !currentSeller ||
    !["DEPOSITED", "REFUNDED"].includes(currentBuyer.status) ||
    !["PENDING", "CANCELLED"].includes(currentSeller.status) ||
    !currentSeller.deadlineAt ||
    currentSeller.deadlineAt.getTime() >= Date.now()
  ) {
    throw new Error("SELLER_NONPAYMENT_NOT_PROVEN");
  }
  const prior = bonds.filter((bond) => bond.tier === 2 && tier === 3);
  if (
    tier === 3 &&
    (prior.length !== 2 ||
      prior.some(
        (bond) =>
          bond.status !== "DEPOSITED" &&
          bond.status !== (bond.party === "buyer" ? "REFUNDED" : "FORFEITED"),
      ) ||
      prior[0].amountCents !== prior[1].amountCents)
  ) {
    throw new Error("PRIOR_REVIEW_BONDS_INCOMPLETE");
  }
  const feeCents = tier === 3 ? prior[0].amountCents : 0;
  const funded = [currentBuyer, ...prior];
  const mockOnly = funded.every((bond) => bond.metadata?.rail === "mock");
  const mockAllowed =
    process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production";
  let txHash: string | null = null;
  if (mockOnly) {
    if (!mockAllowed) throw new Error("MOCK_REVIEW_BONDS_FORBIDDEN");
  } else {
    if (funded.some((bond) => bond.metadata?.rail !== "usdc")) {
      throw new Error("REVIEW_BOND_RAIL_MISMATCH");
    }
    const current = await readBondTier(dispute.id, tier);
    if (![1, 3].includes(current.state) || !current.buyerFunded || current.sellerFunded) {
      throw new Error("SELLER_NONPAYMENT_NOT_PROVEN_ON_CHAIN");
    }
    if (tier === 3) {
      const previous = await readBondTier(dispute.id, 2);
      if (![2, 4].includes(previous.state)) throw new Error("PRIOR_REVIEW_NOT_STARTED_ON_CHAIN");
    }
    const settled = await finalizeSellerDefaultBonds(dispute.id, tier);
    if (settled.feeCents !== feeCents) throw new Error("REVIEW_BOND_FEE_MISMATCH");
    txHash = settled.txHash;
  }
  for (const bond of bonds) {
    const target =
      bond.tier === tier
        ? bond.party === "buyer"
          ? "REFUNDED"
          : "CANCELLED"
        : bond.party === "buyer"
          ? "REFUNDED"
          : "FORFEITED";
    if (bond.status === target) continue;
    if (bond.status !== (bond.tier === tier && bond.party === "seller" ? "PENDING" : "DEPOSITED")) {
      throw new Error("REVIEW_BOND_SETTLEMENT_STATE_MISMATCH");
    }
    await updateDepositStatus(db, bond.id, target, {
      resolvedAt: new Date(),
      metadata: {
        ...(bond.metadata ?? {}),
        settlement_tx_hash: txHash,
        review_fee_cents: target === "FORFEITED" ? bond.amountCents : 0,
        reviewer_payment_status: target === "FORFEITED" ? "HELD" : "NONE",
        settlement_reason: "seller_deposit_timeout",
      },
    });
  }
  return { tx_hash: txHash, fee_cents: feeCents };
}

function createRefundId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function statusForOutcome(outcome: DisputeResolution["outcome"]): DisputeCase["status"] {
  if (outcome === "buyer_favor") return "RESOLVED_BUYER_FAVOR" as DisputeCase["status"];
  if (outcome === "seller_favor") return "RESOLVED_SELLER_FAVOR" as DisputeCase["status"];
  if (outcome === "no_action") return "RESOLVED_SELLER_FAVOR" as DisputeCase["status"];
  return "PARTIAL_REFUND" as DisputeCase["status"];
}

function isTerminalDisputeStatus(status: DisputeCase["status"]): boolean {
  return (
    status === "RESOLVED_BUYER_FAVOR" ||
    status === "RESOLVED_SELLER_FAVOR" ||
    status === "PARTIAL_REFUND" ||
    status === "CLOSED"
  );
}

function isModuleDispute(dispute: DisputeCase): boolean {
  const metadata = dispute.metadata as Record<string, unknown> | null;
  return metadata?.source === "dispute_module_api";
}

function finalizationAttempts(dispute: DisputeCase): number {
  const metadata = dispute.metadata as Record<string, unknown> | null;
  const attempts = metadata?.finalization_attempts;
  return typeof attempts === "number" && Number.isFinite(attempts) ? attempts : 0;
}

function buildModuleSettlementInstruction(
  dispute: DisputeCase,
  resolution: DisputeResolution,
): Record<string, unknown> {
  const metadata = dispute.metadata as Record<string, unknown> | null;
  const transaction = metadata?.transaction_snapshot as Record<string, unknown> | undefined;
  const amountMinor =
    typeof transaction?.amount_minor === "number" ? transaction.amount_minor : undefined;
  const currency = typeof transaction?.currency === "string" ? transaction.currency : undefined;
  const refundAmountMinor =
    resolution.outcome === "buyer_favor"
      ? amountMinor
      : resolution.outcome === "partial_refund"
        ? resolution.refund_amount_minor
        : 0;
  const action =
    resolution.outcome === "buyer_favor" || resolution.outcome === "partial_refund"
      ? "refund_buyer"
      : "release_to_seller";

  return {
    action,
    outcome: resolution.outcome,
    amount_minor: action === "refund_buyer" ? refundAmountMinor : amountMinor,
    currency,
  };
}

function buildModuleSettlementWebhookEnvelope(
  dispute: DisputeCase,
  resolution: DisputeResolution,
): DisputeModuleWebhookEnvelope | null {
  const metadata = dispute.metadata as Record<string, unknown> | null;
  const platformId = metadata?.platform_id;
  const externalOrderId = metadata?.external_order_id;
  if (typeof platformId !== "string" || typeof externalOrderId !== "string") {
    return null;
  }

  return buildDisputeModuleWebhookEnvelope({
    type: "dispute.settlement.instruction",
    platformId,
    externalOrderId,
    dispute,
    dedupeKey: "resolution",
    data: {
      dispute_id: dispute.id,
      status: dispute.status,
      tier: metadata?.tier ?? 1,
      outcome: resolution.outcome,
      refund_amount_minor: resolution.refund_amount_minor ?? null,
      resolved_at: resolution.resolved_at ?? null,
      settlement_instruction: buildModuleSettlementInstruction(dispute, resolution),
    },
  });
}

async function hasCompletedRefund(db: Database, paymentIntentId: string): Promise<boolean> {
  const existingCompleted = await db
    .select({ id: refundsTable.id })
    .from(refundsTable)
    .where(
      and(eq(refundsTable.paymentIntentId, paymentIntentId), eq(refundsTable.status, "COMPLETED")),
    );
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

async function lookupBuyerWalletAddress(
  db: Database,
  buyerId: string,
): Promise<string | undefined> {
  const walletRow = await db.query.userWallets.findFirst({
    where: (fields, ops) => ops.and(ops.eq(fields.userId, buyerId), ops.eq(fields.isPrimary, true)),
  });
  return walletRow?.walletAddress;
}

async function lookupStripePaymentIntentId(
  db: Database,
  intentId: string,
): Promise<string | undefined> {
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
  const refundRail = intent.selected_rail === "stripe" ? ("stripe" as const) : ("usdc" as const);
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
    const executedReference =
      refundExecResult.tx_hash ?? refundExecResult.refund_id ?? providerReference;
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
  if (deposit?.status !== "DEPOSITED") {
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

function withPendingAnchorMetadata(
  dispute: DisputeCase,
  resolution: DisputeResolution,
): DisputeCase {
  const evidenceRootHash = computeEvidenceMerkleRoot(dispute.evidence);
  const resolutionHash = computeResolutionHash(resolution);
  const existingMetadata = isRecord(dispute.metadata) ? dispute.metadata : {};
  const existingLookup = isRecord(existingMetadata.onchain_lookup)
    ? existingMetadata.onchain_lookup
    : {};
  return {
    ...dispute,
    metadata: {
      ...existingMetadata,
      pending_anchor: true,
      anchor_evidence_root: evidenceRootHash,
      anchor_resolution_hash: resolutionHash,
      onchain_lookup: {
        ...existingLookup,
        order_id_hash: uuidToBytes32(dispute.order_id),
        dispute_case_id_hash: uuidToBytes32(dispute.id),
      },
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
  moduleWebhookEnvelope?: DisputeModuleWebhookEnvelope | null,
): Promise<DisputeModuleWebhookOutboxRecord | null> {
  let moduleWebhookOutboxRecord: DisputeModuleWebhookOutboxRecord | null = null;
  const persist = async (tx: unknown) => {
    const txDb = tx as Database;
    await updateDisputeRecord(txDb, dispute);
    await createDisputeResolutionRecord(txDb, dispute.id, resolution);
    if (moduleWebhookEnvelope) {
      moduleWebhookOutboxRecord = await createDisputeModuleWebhookOutboxRecord(
        txDb,
        moduleWebhookEnvelope,
      );
    }
  };

  if (typeof db.transaction === "function") {
    await db.transaction(persist);
    return moduleWebhookOutboxRecord;
  }

  await persist(db);
  return moduleWebhookOutboxRecord;
}

export async function finalizeDisputeResolution(
  db: Database,
  dispute: DisputeCase,
  resolution: DisputeResolution,
  resolvedDispute?: DisputeCase,
): Promise<FinalizeDisputeResolutionResult> {
  if (isTerminalDisputeStatus(dispute.status)) {
    throw new Error(`DISPUTE_ALREADY_FINALIZED:${dispute.id}`);
  }

  // E2b defense-in-depth: T1 COMPLETED assess requires human approval before money.
  const metadata = (dispute.metadata as Record<string, unknown> | null) ?? {};
  if (
    t1HumanApprovalBlocksMoneyMovement({
      tier: typeof metadata.tier === "number" ? metadata.tier : 1,
      ai_resolution_assessor: metadata.ai_resolution_assessor,
      t1_human_review: metadata.t1_human_review,
    })
  ) {
    throw new Error("T1_HUMAN_APPROVAL_REQUIRED");
  }

  let autoRefund: AutoRefundResult = null;
  let depositRefund: { tx_hash?: string; refund_id?: string } | null = null;
  const moduleDispute = isModuleDispute(dispute);
  const twoPartyReview = !moduleDispute && metadata.review_policy_version === 2;
  const reviewBondSettlement = twoPartyReview
    ? metadata.review_phase === "SELLER_DEFAULT"
      ? await finalizeUnfundedSellerReview(db, dispute, resolution)
      : await finalizeTwoPartyReviewBonds(db, dispute, resolution)
    : null;

  if (
    !moduleDispute &&
    (resolution.outcome === "buyer_favor" || resolution.outcome === "partial_refund")
  ) {
    autoRefund = await finalizeBuyerRefund(db, dispute, resolution);
  } else if (!moduleDispute && resolution.outcome === "seller_favor" && !twoPartyReview) {
    depositRefund = await finalizeSellerFavor(db, dispute);
  } else if (!moduleDispute && resolution.outcome === "seller_favor") {
    await updateCommerceOrderStatus(db, dispute.order_id, "CLOSED");
  }

  const anchoredDispute = withPendingAnchorMetadata(
    {
      ...(resolvedDispute ?? dispute),
      status: resolvedDispute?.status ?? statusForOutcome(resolution.outcome),
      resolution,
    },
    resolution,
  );
  const disputeToPersist = {
    ...anchoredDispute,
    metadata: {
      ...((anchoredDispute.metadata as Record<string, unknown>) ?? {}),
      finalized_at: resolution.resolved_at ?? new Date().toISOString(),
      finalization_attempts: finalizationAttempts(dispute) + 1,
    },
  };

  const moduleWebhookEnvelope = moduleDispute
    ? buildModuleSettlementWebhookEnvelope(disputeToPersist, resolution)
    : null;
  if (moduleDispute && !moduleWebhookEnvelope) {
    throw new Error("MODULE_SETTLEMENT_METADATA_MISSING");
  }
  const moduleWebhookOutboxRecord = await persistResolvedDispute(
    db,
    disputeToPersist,
    resolution,
    moduleWebhookEnvelope,
  );
  if (moduleWebhookOutboxRecord) {
    deliverDisputeModuleWebhookOutboxRecord(db, moduleWebhookOutboxRecord).catch((error) => {
      console.warn(
        "[disputes] Module settlement instruction webhook dispatch error:",
        error instanceof Error ? error.message : String(error),
      );
    });
  }
  anchorResolution(dispute, resolution);

  return {
    dispute: disputeToPersist,
    auto_refund: autoRefund,
    deposit_refund: depositRefund,
    review_bond_settlement: reviewBondSettlement,
    module_settlement_webhook: moduleWebhookOutboxRecord,
  };
}
