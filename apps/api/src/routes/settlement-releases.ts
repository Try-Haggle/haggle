// biome-ignore-all lint/suspicious/noImplicitAnyLet: Guarded assignments retain settlement state-machine result types.
import { randomUUID } from "node:crypto";
import {
  CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
  CONDITIONAL_SETTLEMENT_EIP712_TYPES,
  HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
} from "@haggle/contracts";
import type { Database } from "@haggle/db";
import {
  buyerConfirmReceipt,
  completeBufferRelease,
  completeBuyerReview,
  completeVerifiedTestBufferRelease,
  computeReleasePhase,
  confirmDelivery,
  createSettlementRelease,
  PaymentService,
} from "@haggle/payment-core";
import { toSettlementAssetMoney } from "@haggle/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { type Address, createPublicClient, decodeEventLog, type Hex, http, isAddress } from "viem";
import { base, baseSepolia } from "viem/chains";
import { z } from "zod";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import {
  calculateSellerFeeSplit,
  MAX_HAGGLE_FEE_BPS,
  readHaggleFeeBpsFromEnv,
} from "../payments/fee-policy.js";
import {
  type ConditionalReleaseMessage,
  createConditionalReleaseSigner,
} from "../payments/settlement-signer.js";
import { writeAuditLog } from "../services/admin-action-log.service.js";
import {
  CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS,
  conditionalSettlementConfirmationRetry,
  evaluateConditionalSettlementFinality,
} from "../services/conditional-settlement-finality.service.js";
import { getActiveDisputeByOrderId } from "../services/dispute-record.service.js";
import {
  createPaymentSettlementRecord,
  getCommerceOrderByOrderId,
  getPaymentIntentById,
  getPaymentIntentRowById,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import {
  createSettlementReleaseRecord,
  getSettlementReleaseById,
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";
import {
  decideShipmentApvPayoutCancellation,
  getShipmentApvPayoutCancellationTimeline,
  listPendingShipmentApvPayoutCancellations,
  requestShipmentApvPayoutCancellation,
} from "../services/shipment-apv-payout-cancellation.service.js";
import {
  enqueueShipmentApvCancellationAuditArchive,
  getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus,
  getShipmentApvCancellationAuditArchiveHealth,
  getShipmentApvCancellationAuditArchiveStatus,
  listShipmentApvCancellationAuditArchiveFailures,
  requeueShipmentApvCancellationAuditArchive,
} from "../services/shipment-apv-payout-cancellation-audit-archive.service.js";
import { getShipmentApvCancellationAuditArchiveAlertPolicyStatus } from "../services/shipment-apv-payout-cancellation-audit-archive-alert.service.js";
import {
  createSignedShipmentApvPayoutCancellationAuditExport,
  ShipmentApvCancellationAuditSigningNotConfiguredError,
} from "../services/shipment-apv-payout-cancellation-audit-export.service.js";
import {
  bindShipmentApvPayoutOffsetSignature,
  completeShipmentApvPayoutOffset,
  reserveShipmentApvPayoutOffset,
} from "../services/shipment-apv-payout-offset.service.js";
import { getShipmentByOrderId } from "../services/shipment-record.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createReleaseSchema = z.object({
  payment_intent_id: z.string(),
  order_id: z.string(),
  product_amount_minor: z.number().int().nonnegative(),
  buffer_amount_minor: z.number().int().nonnegative(),
  currency: z.string().default("USDC"),
});

const confirmDeliverySchema = z.object({
  delivered_at: z.string().datetime({ offset: true }),
});

const conditionalReleaseRequestSchema = z.object({
  seller_wallet_address: z.string().optional(),
  payout_offset_request_id: z.string().uuid().optional(),
  deadline_unix: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalReleaseExecutionSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  settlement_id: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  contract_address: z.string().optional(),
  chain_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalReleaseConfirmationSchema = z.object({
  tx_hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});
const cancelExpiredPayoutOffsetSchema = z.object({
  client_request_id: z.string().uuid(),
  reason: z.string().trim().min(12).max(500),
});
const payoutCancellationDecisionSchema = z.object({
  decision_request_id: z.string().uuid(),
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(12).max(500),
  expected_version: z.number().int().nonnegative(),
});
const payoutCancellationQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1024).optional(),
});
const payoutCancellationTimelineParamsSchema = z.object({ requestId: z.string().uuid() });
const payoutCancellationArchiveRetrySchema = z.object({
  reason: z.string().trim().min(12).max(500),
});
const payoutCancellationArchiveFailureQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(1024).optional(),
});

function cancellationAuditArchiveSummary(
  archive: Awaited<ReturnType<typeof getShipmentApvCancellationAuditArchiveStatus>>,
) {
  if (!archive) return null;
  return {
    id: archive.id,
    archive_key: archive.archiveKey,
    cancellation_request_id: archive.cancellationRequestId,
    payload_sha256: archive.payloadSha256,
    status: archive.status,
    attempt_count: archive.attemptCount,
    next_attempt_at: archive.nextAttemptAt,
    last_error: archive.lastError,
    http_status: archive.httpStatus,
    receipt_id: archive.receiptId,
    receipt_sha256: archive.receiptSha256,
    delivered_at: archive.deliveredAt,
    created_at: archive.createdAt,
    updated_at: archive.updatedAt,
  };
}

function getConditionalSettlementContext(providerContext: Record<string, unknown>) {
  return providerContext.conditional_settlement &&
    typeof providerContext.conditional_settlement === "object" &&
    !Array.isArray(providerContext.conditional_settlement)
    ? (providerContext.conditional_settlement as Record<string, unknown>)
    : {};
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && isAddress(value) ? value.toLowerCase() : null;
}

function normalizeHex(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function isConditionalSettlementRail(value: unknown): value is "x402" | "stripe" {
  return value === "x402" || value === "stripe";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getStripeOnrampContext(providerContext: Record<string, unknown>) {
  return isRecord(providerContext.stripe_onramp) ? providerContext.stripe_onramp : {};
}

function conditionalSettlementSettlementRail(
  intentRail: unknown,
  providerContext: Record<string, unknown>,
): "x402" | "stripe" {
  const stripeOnramp = getStripeOnrampContext(providerContext);
  return typeof stripeOnramp.status === "string"
    ? "stripe"
    : intentRail === "stripe"
      ? "stripe"
      : "x402";
}

function expectedConditionalReleaseSellerWallet(
  providerContext: Record<string, unknown>,
  conditionalContext: Record<string, unknown>,
): string | null {
  return (
    normalizeAddress(conditionalContext.seller_wallet) ??
    normalizeAddress(conditionalContext.release_seller_wallet) ??
    normalizeAddress(providerContext.seller_wallet) ??
    normalizeAddress(process.env.HAGGLE_X402_SELLER_WALLET)
  );
}

function parseContextBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint")
    return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function expectedConditionalReleaseAmounts(
  intent: { amount: { currency: string; amount_minor: number } },
  conditionalContext: Record<string, unknown>,
): { sellerAmountMinor: bigint; feeAmountMinor: bigint; feeBps?: number } {
  const sellerAmountMinor = parseContextBigInt(conditionalContext.release_seller_amount_minor);
  const feeAmountMinor = parseContextBigInt(conditionalContext.release_fee_amount_minor);
  if (sellerAmountMinor !== null && feeAmountMinor !== null) {
    return {
      sellerAmountMinor,
      feeAmountMinor,
      feeBps:
        typeof conditionalContext.release_fee_bps === "number"
          ? conditionalContext.release_fee_bps
          : undefined,
    };
  }

  const settlementAmount = toSettlementAssetMoney(intent.amount, "USDC");
  const feeBps = readHaggleFeeBpsFromEnv();
  const split = calculateSellerFeeSplit(settlementAmount.amount_minor, feeBps);
  return {
    sellerAmountMinor: BigInt(split.sellerAmountMinor),
    feeAmountMinor: BigInt(split.feeAmountMinor),
    feeBps,
  };
}

function expectedConditionalSettlementChainId(): number {
  return process.env.HAGGLE_X402_NETWORK === "base-sepolia" ? 84532 : 8453;
}

function isVerifiedSettlementTestRuntime(): boolean {
  const easypostKey = process.env.EASYPOST_API_KEY?.trim() ?? "";
  return (
    process.env.HAGGLE_ENV?.trim().toLowerCase() === "staging" &&
    process.env.HAGGLE_X402_NETWORK === "base-sepolia" &&
    process.env.HAGGLE_SETTLEMENT_ASSET_PROFILE === "base-sepolia-husdc" &&
    (easypostKey.startsWith("EZTK") || easypostKey.startsWith("EZTEST"))
  );
}

function validateConditionalReleaseReceipt(
  receipt: { logs?: Array<{ address?: string; topics?: readonly Hex[]; data?: Hex }> },
  expected: {
    contractAddress: string;
    settlementId: string;
    sellerWallet: string;
    feeWallet: string;
    sellerAmountMinor: bigint;
    feeAmountMinor: bigint;
  },
): { ok: true; event: Record<string, unknown> } | { ok: false; message: string } {
  const expectedContractAddress = normalizeAddress(expected.contractAddress);
  if (!expectedContractAddress) {
    return { ok: false, message: "conditional settlement contract address is not configured" };
  }

  for (const log of receipt.logs ?? []) {
    if (normalizeAddress(log.address) !== expectedContractAddress) continue;
    if (!log.topics || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
        data: log.data ?? "0x",
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "SettlementReleased") continue;
      const args = decoded.args as Record<string, unknown>;
      if (normalizeHex(args.settlementId) !== expected.settlementId) continue;
      if (normalizeAddress(args.sellerWallet) !== expected.sellerWallet) continue;
      if (normalizeAddress(args.feeWallet) !== expected.feeWallet) continue;
      if (BigInt(String(args.sellerAmount)) !== expected.sellerAmountMinor) continue;
      if (BigInt(String(args.feeAmount)) !== expected.feeAmountMinor) continue;

      return {
        ok: true,
        event: {
          release_settlement_id: normalizeHex(args.settlementId),
          release_seller_wallet: normalizeAddress(args.sellerWallet),
          release_fee_wallet: normalizeAddress(args.feeWallet),
          release_seller_amount_minor: expected.sellerAmountMinor.toString(),
          release_fee_amount_minor: expected.feeAmountMinor.toString(),
        },
      };
    } catch {}
  }

  return { ok: false, message: "receipt does not contain a matching SettlementReleased event" };
}

function serializeConditionalReleaseMessage(message: ConditionalReleaseMessage) {
  return {
    settlementId: message.settlementId,
    sellerWallet: message.sellerWallet,
    feeWallet: message.feeWallet,
    sellerAmount: message.sellerAmount.toString(),
    feeAmount: message.feeAmount.toString(),
    deadline: message.deadline.toString(),
    signerNonce: message.signerNonce.toString(),
  };
}

function createConditionalReleaseReceiptClient() {
  const rpcUrl = process.env.HAGGLE_BASE_RPC_URL;
  if (!rpcUrl) {
    return null;
  }
  const chain = process.env.HAGGLE_X402_NETWORK === "base-sepolia" ? baseSepolia : base;
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

async function applyPaymentTransitionTriggers(
  db: Database,
  result: {
    intent: { order_id: string; buyer_id: string; seller_id: string };
    trust_triggers: unknown[];
  },
) {
  if (result.trust_triggers.length > 0) {
    await applyTrustTriggers(db, {
      order_id: result.intent.order_id,
      buyer_id: result.intent.buyer_id,
      seller_id: result.intent.seller_id,
      triggers: result.trust_triggers as Parameters<typeof applyTrustTriggers>[1]["triggers"],
    });
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerSettlementReleaseRoutes(app: FastifyInstance, db: Database) {
  const { requireOrderOwner } = createOwnershipMiddleware(db);

  async function isOrderInDispute(orderId: string): Promise<boolean> {
    const [order, activeDispute] = await Promise.all([
      getCommerceOrderByOrderId(db, orderId),
      getActiveDisputeByOrderId(db, orderId),
    ]);
    return order?.status === "IN_DISPUTE" || Boolean(activeDispute);
  }

  async function requireReleaseSeller(
    request: FastifyRequest,
    reply: FastifyReply,
    orderId: string,
  ): Promise<boolean> {
    if (request.user?.role === "admin") return true;
    const order = await getCommerceOrderByOrderId(db, orderId);
    if (!order) {
      reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      return false;
    }
    if (request.user?.id !== order.sellerId) {
      reply.code(403).send({
        error: "FORBIDDEN",
        message: "Only the order seller may release this settlement",
      });
      return false;
    }
    return true;
  }

  // POST /settlement-releases — Create a new settlement release
  app.post("/settlement-releases", { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = createReleaseSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }

    const { payment_intent_id, order_id, product_amount_minor, buffer_amount_minor, currency } =
      parsed.data;

    const release = createSettlementRelease({
      payment_intent_id,
      order_id,
      product_amount: { currency, amount_minor: product_amount_minor },
      buffer_amount: { currency, amount_minor: buffer_amount_minor },
    });

    const stored = await createSettlementReleaseRecord(db, release);
    return reply.code(201).send({
      release: stored,
      phase: computeReleasePhase(stored),
    });
  });

  // GET /settlement-releases/:id — Get release by ID
  app.get("/settlement-releases/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }
    if (request.user?.role !== "admin") {
      const order = await db.query.commerceOrders.findFirst({
        where: (fields, ops) => ops.eq(fields.id, release.order_id),
      });
      if (!order) {
        return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
      }
      const userId = request.user!.id;
      if (userId !== order.buyerId && userId !== order.sellerId) {
        return reply
          .code(403)
          .send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }
    return reply.send({
      release,
      phase: computeReleasePhase(release),
    });
  });

  // GET /settlement-releases/by-order/:orderId — Get release by order ID
  app.get(
    "/settlement-releases/by-order/:orderId",
    { preHandler: [requireAuth, requireOrderOwner()] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const release = await getSettlementReleaseByOrderId(db, orderId);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
      const providerContext = isRecord(intentRow?.providerContext) ? intentRow.providerContext : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      return reply.send({
        release,
        phase: computeReleasePhase(release),
        conditional_settlement: {
          status: typeof conditionalContext.status === "string" ? conditionalContext.status : null,
          release_tx_hash:
            typeof conditionalContext.release_tx_hash === "string"
              ? conditionalContext.release_tx_hash
              : null,
        },
      });
    },
  );

  // POST /settlement-releases/:id/confirm-delivery — Confirm delivery
  app.post(
    "/settlement-releases/:id/confirm-delivery",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const release = await getSettlementReleaseById(db, id);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }

      const parsed = confirmDeliverySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
      }

      let updated;
      try {
        updated = confirmDelivery(release, parsed.data.delivered_at);
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );

  // POST /settlement-releases/:id/complete-buyer-review — Complete buyer review
  app.post(
    "/settlement-releases/:id/complete-buyer-review",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const release = await getSettlementReleaseById(db, id);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      if (await isOrderInDispute(release.order_id)) {
        return reply.code(409).send({
          error: "ORDER_IN_DISPUTE",
          message: "Product release is blocked while the order has an active dispute",
        });
      }

      let updated;
      try {
        updated = completeBuyerReview(release, new Date().toISOString());
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );

  // Legacy direct mutation is deliberately closed: APV changes must retain
  // provider invoice identity and pass through the adjustment/review ledger.
  app.post(
    "/settlement-releases/:id/apply-adjustment",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      return reply.code(410).send({
        error: "DIRECT_APV_ADJUSTMENT_DISABLED",
        message: "Use the signed shipment invoice webhook and APV review endpoints",
      });
    },
  );

  // POST /settlement-releases/:id/release-buffer — Release weight buffer
  app.post(
    "/settlement-releases/:id/release-buffer",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const release = await getSettlementReleaseById(db, id);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }

      let updated;
      try {
        updated = completeBufferRelease(release, new Date().toISOString());
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );

  app.post(
    "/settlement-releases/:id/conditional-release-request",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const release = await getSettlementReleaseById(db, id);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      if (!(await requireReleaseSeller(request, reply, release.order_id))) return;
      if (await isOrderInDispute(release.order_id)) {
        return reply.code(409).send({
          error: "ORDER_IN_DISPUTE",
          message: "Settlement release is blocked while the order has an active dispute",
        });
      }
      if (computeReleasePhase(release) !== "FULLY_RELEASED") {
        return reply.code(409).send({
          error: "RELEASE_NOT_FULLY_UNLOCKED",
          message:
            "conditional settlement release moves the full funded amount, so product and buffer release phases must both be complete",
          phase: computeReleasePhase(release),
        });
      }

      const parsed = conditionalReleaseRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_RELEASE_REQUEST", issues: parsed.error.issues });
      }

      const intent = await getPaymentIntentById(db, release.payment_intent_id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
      const providerContext =
        intentRow?.providerContext &&
        typeof intentRow.providerContext === "object" &&
        !Array.isArray(intentRow.providerContext)
          ? intentRow.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const settlementId =
        typeof conditionalContext.settlement_id === "string"
          ? conditionalContext.settlement_id
          : undefined;
      if (!settlementId) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }
      if (conditionalContext.status !== "FUNDING_CONFIRMED") {
        return reply.code(409).send({
          error: "CONDITIONAL_SETTLEMENT_NOT_CONFIRMED",
          status: conditionalContext.status,
        });
      }

      const expectedSellerWallet = expectedConditionalReleaseSellerWallet(
        providerContext,
        conditionalContext,
      );
      if (!expectedSellerWallet) {
        return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
      }
      const requestedSellerWallet = parsed.data.seller_wallet_address
        ? normalizeAddress(parsed.data.seller_wallet_address)
        : null;
      if (parsed.data.seller_wallet_address && !requestedSellerWallet) {
        return reply.code(400).send({ error: "SELLER_WALLET_INVALID" });
      }
      if (requestedSellerWallet && requestedSellerWallet !== expectedSellerWallet) {
        return reply.code(409).send({
          error: "CONDITIONAL_RELEASE_SELLER_WALLET_MISMATCH",
          message:
            "conditional release seller wallet must match the funded settlement seller wallet",
        });
      }
      const sellerWallet = expectedSellerWallet;
      const feeWallet = process.env.HAGGLE_X402_FEE_WALLET;
      if (!feeWallet) {
        return reply.code(503).send({ error: "HAGGLE_X402_FEE_WALLET_REQUIRED" });
      }

      const settlementAmount = toSettlementAssetMoney(intent.amount, "USDC");
      const baseSplit = calculateSellerFeeSplit(
        settlementAmount.amount_minor,
        readHaggleFeeBpsFromEnv(),
      );
      const maxContractFeeMinor = Math.floor(
        (settlementAmount.amount_minor * MAX_HAGGLE_FEE_BPS) / 10_000,
      );
      const feeHeadroomMinor = Math.max(0, maxContractFeeMinor - baseSplit.feeAmountMinor);
      const payoutOffsetResult = await reserveShipmentApvPayoutOffset(db, {
        settlementReleaseId: release.id,
        requestId: parsed.data.payout_offset_request_id ?? `apv-payout:${release.id}`,
        maxOffsetMinor: Math.min(baseSplit.sellerAmountMinor, feeHeadroomMinor),
      });
      if (payoutOffsetResult.outcome === "pending_revision") {
        return reply.code(409).send({ error: "APV_REVISION_REVIEW_PENDING" });
      }
      if (
        payoutOffsetResult.outcome === "snapshot_conflict" ||
        payoutOffsetResult.outcome === "request_conflict"
      ) {
        return reply.code(409).send({ error: "APV_PAYOUT_OFFSET_SNAPSHOT_CONFLICT" });
      }
      if (payoutOffsetResult.outcome === "not_found" || !("offset" in payoutOffsetResult)) {
        return reply.code(409).send({ error: "APV_PAYOUT_OFFSET_UNAVAILABLE" });
      }
      const payoutOffset = payoutOffsetResult.offset;

      let signature;
      try {
        const signer = createConditionalReleaseSigner();
        signature = await signer({
          settlementId,
          sellerWallet: sellerWallet as Address,
          feeWallet: feeWallet as Address,
          grossAmountMinor: settlementAmount.amount_minor,
          feeBps: readHaggleFeeBpsFromEnv(),
          sellerOffsetMinor: payoutOffset.applied_offset_minor,
          deadline: parsed.data.deadline_unix ? BigInt(parsed.data.deadline_unix) : undefined,
        });
      } catch (error) {
        return reply.code(503).send({
          error: "CONDITIONAL_RELEASE_SIGNATURE_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      const signatureBinding = await bindShipmentApvPayoutOffsetSignature(db, {
        settlementReleaseId: release.id,
        payoutOffsetId: payoutOffset.id,
        deadlineUnix: Number(signature.deadline),
      });
      if (signatureBinding.outcome !== "bound" && signatureBinding.outcome !== "duplicate") {
        return reply.code(409).send({ error: "APV_PAYOUT_OFFSET_SIGNATURE_BINDING_CONFLICT" });
      }

      const message = serializeConditionalReleaseMessage(signature.message);
      const releaseSnapshotContext = {
        ...conditionalContext,
        release_seller_wallet: sellerWallet,
        release_fee_wallet: feeWallet,
        release_seller_amount_minor: signature.message.sellerAmount.toString(),
        release_fee_amount_minor: signature.message.feeAmount.toString(),
        release_fee_bps: readHaggleFeeBpsFromEnv(),
        apv_payout_offset_id: payoutOffset.id,
        apv_payout_offset_minor: String(payoutOffset.applied_offset_minor),
        apv_unapplied_liability_minor: String(payoutOffset.unapplied_liability_minor),
        apv_evidence_manifest_sha256: payoutOffset.evidence_manifest_sha256,
        release_signature_created_at: new Date().toISOString(),
      };
      await updateStoredPaymentIntent(db, intent, {
        ...providerContext,
        conditional_settlement: releaseSnapshotContext,
      });

      return reply.send({
        mode: "contract_call",
        contract_call: {
          function_name: "release",
          params: message,
          signature: signature.signature,
        },
        typed_data: {
          domain: {
            ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
            chainId: process.env.HAGGLE_X402_NETWORK === "base-sepolia" ? 84532 : 8453,
            verifyingContract: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
          },
          types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
          primaryType: "Release",
          message,
        },
        signature: signature.signature,
        deadline_unix: signature.deadline.toString(),
        apv_payout_offset: payoutOffset,
        signer_nonce: signature.signer_nonce.toString(),
      });
    },
  );

  app.post(
    "/settlement-releases/:id/conditional-release-execution",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const release = await getSettlementReleaseById(db, id);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      if (!(await requireReleaseSeller(request, reply, release.order_id))) return;
      if (await isOrderInDispute(release.order_id)) {
        return reply.code(409).send({
          error: "ORDER_IN_DISPUTE",
          message: "Settlement release is blocked while the order has an active dispute",
        });
      }
      if (computeReleasePhase(release) !== "FULLY_RELEASED") {
        return reply.code(409).send({
          error: "RELEASE_NOT_FULLY_UNLOCKED",
          phase: computeReleasePhase(release),
        });
      }

      const parsed = conditionalReleaseExecutionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_RELEASE_EXECUTION", issues: parsed.error.issues });
      }
      const expectedContractAddress = normalizeAddress(
        process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
      );
      if (
        parsed.data.contract_address &&
        (!expectedContractAddress ||
          normalizeAddress(parsed.data.contract_address) !== expectedContractAddress)
      ) {
        return reply.code(400).send({ error: "CONDITIONAL_RELEASE_CONTRACT_MISMATCH" });
      }
      if (
        parsed.data.chain_id &&
        Number(parsed.data.chain_id) !== expectedConditionalSettlementChainId()
      ) {
        return reply.code(400).send({ error: "CONDITIONAL_RELEASE_CHAIN_MISMATCH" });
      }

      const intent = await getPaymentIntentById(db, release.payment_intent_id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (!isConditionalSettlementRail(intent.selected_rail)) {
        return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_SUPPORTED" });
      }

      const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
      const providerContext =
        intentRow?.providerContext &&
        typeof intentRow.providerContext === "object" &&
        !Array.isArray(intentRow.providerContext)
          ? intentRow.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const settlementId =
        parsed.data.settlement_id ??
        (typeof conditionalContext.settlement_id === "string"
          ? conditionalContext.settlement_id
          : undefined);
      if (!settlementId) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }
      if (
        conditionalContext.status !== "FUNDING_CONFIRMED" &&
        conditionalContext.status !== "RELEASE_SUBMITTED"
      ) {
        return reply.code(409).send({
          error: "CONDITIONAL_SETTLEMENT_NOT_RELEASABLE",
          status: conditionalContext.status,
        });
      }

      const submittedContext = {
        ...conditionalContext,
        settlement_id: settlementId,
        release_tx_hash: parsed.data.tx_hash,
        release_contract_address:
          parsed.data.contract_address ?? process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
        release_chain_id: parsed.data.chain_id ? String(parsed.data.chain_id) : undefined,
        status: "RELEASE_SUBMITTED",
        release_submitted_at: new Date().toISOString(),
      };
      await updateStoredPaymentIntent(db, intent, {
        ...providerContext,
        conditional_settlement: submittedContext,
      });

      return reply.send({
        release,
        intent,
        conditional_settlement: submittedContext,
      });
    },
  );

  app.post(
    "/settlement-releases/:id/conditional-release-confirmation",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const release = await getSettlementReleaseById(db, id);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      if (!(await requireReleaseSeller(request, reply, release.order_id))) return;

      const parsed = conditionalReleaseConfirmationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_RELEASE_CONFIRMATION", issues: parsed.error.issues });
      }

      const intent = await getPaymentIntentById(db, release.payment_intent_id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (!isConditionalSettlementRail(intent.selected_rail)) {
        return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_SUPPORTED" });
      }

      const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
      const providerContext =
        intentRow?.providerContext &&
        typeof intentRow.providerContext === "object" &&
        !Array.isArray(intentRow.providerContext)
          ? intentRow.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const txHash =
        parsed.data.tx_hash ??
        (typeof conditionalContext.release_tx_hash === "string"
          ? conditionalContext.release_tx_hash
          : undefined);
      if (!txHash) {
        return reply.code(400).send({ error: "CONDITIONAL_RELEASE_TX_REQUIRED" });
      }
      const settlementId = normalizeHex(conditionalContext.settlement_id);
      if (!settlementId) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }
      const sellerWallet = expectedConditionalReleaseSellerWallet(
        providerContext,
        conditionalContext,
      );
      if (!sellerWallet) {
        return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
      }
      const feeWallet =
        normalizeAddress(conditionalContext.release_fee_wallet) ??
        normalizeAddress(process.env.HAGGLE_X402_FEE_WALLET);
      if (!feeWallet) {
        return reply.code(503).send({ error: "HAGGLE_X402_FEE_WALLET_REQUIRED" });
      }

      const client = createConditionalReleaseReceiptClient();
      if (!client) {
        return reply.code(503).send({
          error: "CONDITIONAL_RELEASE_RECEIPT_RPC_NOT_CONFIGURED",
          message: "HAGGLE_BASE_RPC_URL is required to confirm conditional settlement release",
        });
      }

      const receipt = await client.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);

      if (!receipt) {
        const pendingContext = {
          ...conditionalContext,
          release_tx_hash: txHash,
          status: "RELEASE_PENDING",
          release_checked_at: new Date().toISOString(),
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: pendingContext,
        });
        return reply
          .header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS))
          .code(202)
          .send({
            release,
            intent,
            conditional_settlement: pendingContext,
            retry: conditionalSettlementConfirmationRetry(),
          });
      }

      const finality = await evaluateConditionalSettlementFinality({
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        client,
      });
      if (!finality.ready) {
        const pendingContext = {
          ...conditionalContext,
          release_tx_hash: txHash,
          status:
            finality.status === "pending"
              ? "RELEASE_CONFIRMATIONS_PENDING"
              : "RELEASE_FINALITY_UNAVAILABLE",
          release_checked_at: new Date().toISOString(),
          finality,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: pendingContext,
        });
        const statusCode = finality.status === "pending" ? 202 : 503;
        if (statusCode === 202)
          reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
        return reply.code(statusCode).send({
          release,
          intent,
          conditional_settlement: pendingContext,
          ...(statusCode === 202 ? { retry: conditionalSettlementConfirmationRetry() } : {}),
        });
      }

      const releaseEvent =
        receipt.status === "success"
          ? (() => {
              const expectedAmounts = expectedConditionalReleaseAmounts(intent, conditionalContext);
              return validateConditionalReleaseReceipt(receipt, {
                contractAddress: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS ?? "",
                settlementId,
                sellerWallet,
                feeWallet,
                sellerAmountMinor: expectedAmounts.sellerAmountMinor,
                feeAmountMinor: expectedAmounts.feeAmountMinor,
              });
            })()
          : null;
      if (releaseEvent && !releaseEvent.ok) {
        const rejectedContext = {
          ...conditionalContext,
          release_tx_hash: txHash,
          status: "RELEASE_EVENT_MISMATCH",
          release_checked_at: new Date().toISOString(),
          release_mismatch_reason: releaseEvent.message,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: rejectedContext,
        });
        return reply.code(400).send({
          error: "CONDITIONAL_RELEASE_EVENT_MISMATCH",
          message: releaseEvent.message,
          release,
          intent,
          conditional_settlement: rejectedContext,
        });
      }

      const payoutOffsetId =
        typeof conditionalContext.apv_payout_offset_id === "string"
          ? conditionalContext.apv_payout_offset_id
          : undefined;
      const payoutOffsetResult =
        receipt.status === "success" && payoutOffsetId
          ? await completeShipmentApvPayoutOffset(db, {
              settlementReleaseId: release.id,
              payoutOffsetId,
              releaseTxHash: txHash,
            })
          : null;
      if (
        payoutOffsetResult &&
        (payoutOffsetResult.outcome === "snapshot_conflict" ||
          payoutOffsetResult.outcome === "request_conflict")
      ) {
        return reply.code(409).send({ error: "APV_PAYOUT_OFFSET_CONFIRMATION_CONFLICT" });
      }
      const confirmedPayoutOffset =
        payoutOffsetResult && "offset" in payoutOffsetResult ? payoutOffsetResult.offset : null;

      const confirmedContext = {
        ...conditionalContext,
        ...(releaseEvent?.ok ? releaseEvent.event : {}),
        release_tx_hash: txHash,
        status: receipt.status === "success" ? "RELEASE_CONFIRMED" : "RELEASE_FAILED",
        release_confirmed_at: new Date().toISOString(),
        release_block_hash: receipt.blockHash,
        release_block_number: receipt.blockNumber?.toString(),
        release_transaction_index: receipt.transactionIndex,
        release_gas_used: receipt.gasUsed?.toString(),
        release_effective_gas_price: receipt.effectiveGasPrice?.toString(),
        finality,
        apv_payout_offset_status: confirmedPayoutOffset?.status,
        apv_payout_offset_tx_hash: confirmedPayoutOffset?.release_tx_hash,
      };

      if (receipt.status !== "success") {
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: confirmedContext,
        });
        return reply.send({
          release,
          intent,
          conditional_settlement: confirmedContext,
        });
      }

      if (intent.status === "SETTLED") {
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: confirmedContext,
        });
        return reply.send({
          release,
          intent,
          conditional_settlement: confirmedContext,
        });
      }

      if (intent.status !== "SETTLEMENT_PENDING") {
        return reply
          .code(409)
          .send({ error: "PAYMENT_NOT_SETTLEMENT_PENDING", status: intent.status });
      }

      const paymentService = new PaymentService({});
      const settledAt = new Date().toISOString();
      const result = paymentService.recordExternalSettlement(
        intent,
        {
          id: `conditional_release_${randomUUID()}`,
          payment_intent_id: intent.id,
          rail: conditionalSettlementSettlementRail(intent.selected_rail, providerContext),
          provider_reference: txHash,
          settled_amount: intent.amount,
          settled_at: settledAt,
          status: "SETTLED",
        },
        settledAt,
      );

      if (result.value) {
        await createPaymentSettlementRecord(db, result.value);
      }
      await updateStoredPaymentIntent(db, result.intent, {
        ...providerContext,
        conditional_settlement: confirmedContext,
      });
      await applyPaymentTransitionTriggers(db, result);

      return reply.send({
        release,
        intent: result.intent,
        settlement: result.value,
        conditional_settlement: confirmedContext,
      });
    },
  );

  app.post(
    "/settlement-releases/:id/apv-payout-offsets/:offsetId/cancel-expired",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      return reply.code(410).send({
        error: "APV_PAYOUT_CANCELLATION_APPROVAL_REQUIRED",
        message: "Create a cancellation request and obtain approval from a different administrator",
      });
    },
  );

  app.post(
    "/settlement-releases/:id/apv-payout-offsets/:offsetId/cancellation-requests",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id, offsetId } = request.params as { id: string; offsetId: string };
      const parsed = cancelExpiredPayoutOffsetSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_PAYOUT_CANCELLATION", issues: parsed.error.issues });
      const result = await requestShipmentApvPayoutCancellation(db, {
        clientRequestId: parsed.data.client_request_id,
        payoutOffsetId: offsetId,
        settlementReleaseId: id,
        requesterId: request.user!.id,
        reason: parsed.data.reason,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_PAYOUT_OFFSET_NOT_FOUND" });
      if (result.outcome === "not_expired")
        return reply.code(409).send({ error: "APV_PAYOUT_OFFSET_NOT_EXPIRED" });
      if (result.outcome === "invalid_state")
        return reply.code(409).send({ error: "APV_PAYOUT_OFFSET_STATE_CONFLICT" });
      if (result.outcome === "request_conflict" || result.outcome === "pending_conflict") {
        return reply.code(409).send({ error: "APV_PAYOUT_CANCELLATION_REQUEST_CONFLICT" });
      }
      if (!("request" in result))
        return reply.code(400).send({ error: "APV_PAYOUT_CANCELLATION_REQUEST_REJECTED" });
      return reply.send({
        cancellation_request: result.request,
        idempotent: result.outcome === "duplicate",
      });
    },
  );

  app.get(
    "/admin/settlement-releases/apv-payout-cancellation-requests/pending",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = payoutCancellationQueueQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_APV_PAYOUT_CANCELLATION_QUEUE_QUERY",
          issues: parsed.error.issues,
        });
      }
      try {
        const queue = await listPendingShipmentApvPayoutCancellations(db, parsed.data);
        return reply.send({ cancellation_requests: queue });
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_APV_PAYOUT_CANCELLATION_CURSOR") {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/settlement-releases/apv-payout-cancellation-requests/:requestId/timeline",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = payoutCancellationTimelineParamsSchema.safeParse(request.params ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_PAYOUT_CANCELLATION_REQUEST_ID" });
      const timeline = await getShipmentApvPayoutCancellationTimeline(db, parsed.data.requestId);
      if (!timeline)
        return reply.code(404).send({ error: "APV_PAYOUT_CANCELLATION_REQUEST_NOT_FOUND" });
      return reply.send({ cancellation_timeline: timeline });
    },
  );

  app.get(
    "/admin/settlement-releases/apv-payout-cancellation-requests/:requestId/audit-export",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = payoutCancellationTimelineParamsSchema.safeParse(request.params ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_PAYOUT_CANCELLATION_REQUEST_ID" });
      const timeline = await getShipmentApvPayoutCancellationTimeline(db, parsed.data.requestId);
      if (!timeline)
        return reply.code(404).send({ error: "APV_PAYOUT_CANCELLATION_REQUEST_NOT_FOUND" });
      if (!timeline.integrity.valid) {
        return reply.code(409).send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_CHAIN_INVALID" });
      }
      try {
        const auditExport = createSignedShipmentApvPayoutCancellationAuditExport({
          cancellationRequestId: parsed.data.requestId,
          events: timeline.events,
          generatedAt: new Date(),
        });
        reply.header(
          "Content-Disposition",
          `attachment; filename="haggle-apv-cancellation-${parsed.data.requestId}-audit.json"`,
        );
        return reply.send({ cancellation_audit_export: auditExport });
      } catch (error) {
        if (error instanceof ShipmentApvCancellationAuditSigningNotConfiguredError) {
          return reply
            .code(503)
            .send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_SIGNING_NOT_CONFIGURED" });
        }
        request.log.error(
          { error, cancellation_request_id: parsed.data.requestId },
          "Failed to sign APV cancellation audit export",
        );
        return reply.code(500).send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_SIGNING_FAILED" });
      }
    },
  );

  app.post(
    "/admin/settlement-releases/apv-payout-cancellation-requests/:requestId/audit-archive",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = payoutCancellationTimelineParamsSchema.safeParse(request.params ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_PAYOUT_CANCELLATION_REQUEST_ID" });
      const timeline = await getShipmentApvPayoutCancellationTimeline(db, parsed.data.requestId);
      if (!timeline)
        return reply.code(404).send({ error: "APV_PAYOUT_CANCELLATION_REQUEST_NOT_FOUND" });
      if (!timeline.integrity.valid)
        return reply.code(409).send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_CHAIN_INVALID" });
      if (timeline.request.status === "PENDING")
        return reply.code(409).send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_NOT_FINAL" });
      try {
        const result = await enqueueShipmentApvCancellationAuditArchive(db, {
          cancellationRequestId: parsed.data.requestId,
          events: timeline.events,
        });
        return reply.send({
          audit_archive: cancellationAuditArchiveSummary(result.archive),
          idempotent: result.outcome === "duplicate",
        });
      } catch (error) {
        if (error instanceof ShipmentApvCancellationAuditSigningNotConfiguredError) {
          return reply
            .code(503)
            .send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_SIGNING_NOT_CONFIGURED" });
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/settlement-releases/apv-payout-cancellation-audit-archives/health",
    { preHandler: [requireAdmin] },
    async (_request, reply) => {
      return reply.send({
        audit_archive_health: await getShipmentApvCancellationAuditArchiveHealth(db),
        archive_delivery: getShipmentApvCancellationAuditArchiveDeliveryPolicyStatus(),
        alerting: getShipmentApvCancellationAuditArchiveAlertPolicyStatus(),
      });
    },
  );

  app.get(
    "/admin/settlement-releases/apv-payout-cancellation-audit-archives/failures",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = payoutCancellationArchiveFailureQuerySchema.safeParse(request.query ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_AUDIT_ARCHIVE_FAILURE_QUERY" });
      try {
        return reply.send({
          audit_archive_failures: await listShipmentApvCancellationAuditArchiveFailures(
            db,
            parsed.data,
          ),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "INVALID_APV_AUDIT_ARCHIVE_FAILURE_CURSOR"
        ) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/admin/settlement-releases/apv-payout-cancellation-requests/:requestId/audit-archive",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const parsed = payoutCancellationTimelineParamsSchema.safeParse(request.params ?? {});
      if (!parsed.success)
        return reply.code(400).send({ error: "INVALID_APV_PAYOUT_CANCELLATION_REQUEST_ID" });
      const archive = await getShipmentApvCancellationAuditArchiveStatus(db, parsed.data.requestId);
      if (!archive)
        return reply.code(404).send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_ARCHIVE_NOT_FOUND" });
      return reply.send({ audit_archive: cancellationAuditArchiveSummary(archive) });
    },
  );

  app.post(
    "/admin/settlement-releases/apv-payout-cancellation-requests/:requestId/audit-archive/retry",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const params = payoutCancellationTimelineParamsSchema.safeParse(request.params ?? {});
      const body = payoutCancellationArchiveRetrySchema.safeParse(request.body ?? {});
      if (!params.success || !body.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_PAYOUT_CANCELLATION_AUDIT_ARCHIVE_RETRY" });
      const result = await requeueShipmentApvCancellationAuditArchive(db, {
        cancellationRequestId: params.data.requestId,
        actorId: request.user!.id,
        reason: body.data.reason,
      });
      if (result.outcome === "invalid_reason")
        return reply
          .code(400)
          .send({ error: "INVALID_APV_PAYOUT_CANCELLATION_AUDIT_ARCHIVE_RETRY" });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_PAYOUT_CANCELLATION_AUDIT_ARCHIVE_NOT_FOUND" });
      if (result.outcome === "already_delivered")
        return reply.code(409).send({
          error: "APV_PAYOUT_CANCELLATION_AUDIT_ARCHIVE_ALREADY_DELIVERED",
          audit_archive: cancellationAuditArchiveSummary(result.archive),
        });
      return reply.send({
        audit_archive: cancellationAuditArchiveSummary(result.archive),
        outcome: result.outcome,
      });
    },
  );

  app.post(
    "/settlement-releases/:id/apv-payout-offsets/:offsetId/cancellation-requests/:requestId/decision",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { id, offsetId, requestId } = request.params as {
        id: string;
        offsetId: string;
        requestId: string;
      };
      const parsed = payoutCancellationDecisionSchema.safeParse(request.body ?? {});
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "INVALID_APV_PAYOUT_CANCELLATION_DECISION", issues: parsed.error.issues });
      let state: "FUNDED" | "RELEASED" | "REFUNDED" | "DISPUTED" | "NONE" = "NONE";
      if (parsed.data.decision === "APPROVE") {
        const release = await getSettlementReleaseById(db, id);
        if (!release) return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
        const intent = await getPaymentIntentById(db, release.payment_intent_id);
        const intentRow = intent
          ? await getPaymentIntentRowById(db, release.payment_intent_id)
          : null;
        if (!intent || !intentRow)
          return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
        const providerContext =
          intentRow.providerContext &&
          typeof intentRow.providerContext === "object" &&
          !Array.isArray(intentRow.providerContext)
            ? intentRow.providerContext
            : {};
        const settlementId = normalizeHex(
          getConditionalSettlementContext(providerContext).settlement_id,
        );
        if (!settlementId)
          return reply.code(409).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
        const client = createConditionalReleaseReceiptClient();
        const contractAddress = normalizeAddress(process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS);
        if (!client || !contractAddress)
          return reply.code(503).send({ error: "CONDITIONAL_RELEASE_RECEIPT_RPC_NOT_CONFIGURED" });
        const stateValue = await client
          .readContract({
            address: contractAddress as Address,
            abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
            functionName: "settlementState",
            args: [settlementId as Hex],
          })
          .catch(() => null);
        if (stateValue === null)
          return reply.code(503).send({ error: "CONDITIONAL_SETTLEMENT_STATE_UNAVAILABLE" });
        state =
          (["NONE", "FUNDED", "RELEASED", "REFUNDED", "DISPUTED"] as const)[Number(stateValue)] ??
          "NONE";
      }
      const result = await decideShipmentApvPayoutCancellation(db, {
        requestId,
        payoutOffsetId: offsetId,
        settlementReleaseId: id,
        decisionRequestId: parsed.data.decision_request_id,
        approverId: request.user!.id,
        decision: parsed.data.decision,
        reason: parsed.data.reason,
        expectedVersion: parsed.data.expected_version,
        onchainState: state,
      });
      if (result.outcome === "not_found")
        return reply.code(404).send({ error: "APV_PAYOUT_CANCELLATION_REQUEST_NOT_FOUND" });
      if (result.outcome === "self_approval_forbidden")
        return reply.code(403).send({ error: "APV_PAYOUT_CANCELLATION_SELF_APPROVAL_FORBIDDEN" });
      if (
        [
          "request_conflict",
          "decision_conflict",
          "version_conflict",
          "invalid_state",
          "expired",
          "onchain_state_conflict",
        ].includes(result.outcome)
      ) {
        return reply.code(409).send({
          error: `APV_PAYOUT_CANCELLATION_${result.outcome.toUpperCase()}`,
          onchain_state: state,
        });
      }
      if (!("request" in result))
        return reply.code(400).send({ error: "APV_PAYOUT_CANCELLATION_DECISION_REJECTED" });
      return reply.send({
        cancellation_request: result.request,
        idempotent: result.outcome === "duplicate",
        onchain_state: state,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Order-ID-based endpoints (buyer flow)
  // -------------------------------------------------------------------------
  // Note: GET by order ID already exists at /settlement-releases/by-order/:orderId
  // The POST endpoints below use /by-order/:orderId/<action> to avoid
  // route collision with the existing /settlement-releases/:id param routes.

  // POST /settlement-releases/by-order/:orderId/buyer-confirm — Buyer confirms receipt
  app.post(
    "/settlement-releases/by-order/:orderId/buyer-confirm",
    { preHandler: [requireAuth, requireOrderOwner({ role: "buyer" })] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const release = await getSettlementReleaseByOrderId(db, orderId);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      if (await isOrderInDispute(orderId)) {
        return reply.code(409).send({
          error: "ORDER_IN_DISPUTE",
          message: "Buyer confirmation is blocked while the order has an active dispute",
        });
      }

      let updated;
      try {
        updated = buyerConfirmReceipt(release, new Date().toISOString());
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );

  // Staging-only APV completion after an EasyPost test delivery and buyer receipt confirmation.
  app.post(
    "/settlement-releases/by-order/:orderId/complete-test-buffer",
    { preHandler: [requireAuth, requireOrderOwner({ role: "seller" })] },
    async (request, reply) => {
      if (!isVerifiedSettlementTestRuntime()) {
        return reply.code(404).send({ error: "TEST_BUFFER_COMPLETION_NOT_AVAILABLE" });
      }

      const { orderId } = request.params as { orderId: string };
      if (await isOrderInDispute(orderId)) {
        return reply.code(409).send({
          error: "ORDER_IN_DISPUTE",
          message: "Test buffer completion is blocked while the order has an active dispute",
        });
      }

      const [release, shipment] = await Promise.all([
        getSettlementReleaseByOrderId(db, orderId),
        getShipmentByOrderId(db, orderId),
      ]);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }
      if (shipment?.status !== "DELIVERED") {
        return reply.code(409).send({ error: "VERIFIED_TEST_DELIVERY_REQUIRED" });
      }

      const testTracker = isRecord(shipment.metadata?.easypost_test_tracker)
        ? shipment.metadata.easypost_test_tracker
        : {};
      if (
        testTracker.easypost_test_status_verified !== true ||
        testTracker.requested_status !== "delivered"
      ) {
        return reply.code(409).send({ error: "EASYPOST_TEST_DELIVERY_NOT_VERIFIED" });
      }

      if (release.buffer_release_status === "RELEASED") {
        return reply.send({
          release,
          phase: computeReleasePhase(release),
          already_completed: true,
        });
      }

      let updated;
      try {
        updated = completeVerifiedTestBufferRelease(release, new Date().toISOString());
      } catch (error) {
        return reply.code(409).send({
          error: "TEST_BUFFER_NOT_RELEASABLE",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database;
        await updateSettlementReleaseRecord(txDb, updated);
        await writeAuditLog(txDb, {
          actorId: request.user!.id,
          actionType: "shipment.test_buffer_completion",
          targetType: "settlement_release",
          targetId: release.id,
          payload: {
            order_id: orderId,
            shipment_id: shipment.id,
            provider: "easypost",
            provider_mode: "test",
            provider_tracker_id: testTracker.easypost_tracker_id,
            provider_tracking_code: testTracker.easypost_test_tracking_code,
          },
        });
      });
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
        provider_verification: {
          provider: "easypost",
          mode: "test",
          tracker_id: testTracker.easypost_tracker_id,
          tracking_code: testTracker.easypost_test_tracking_code,
        },
        already_completed: false,
      });
    },
  );

  // POST /settlement-releases/by-order/:orderId/complete-buffer — Complete buffer release
  app.post(
    "/settlement-releases/by-order/:orderId/complete-buffer",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const { orderId } = request.params as { orderId: string };
      const release = await getSettlementReleaseByOrderId(db, orderId);
      if (!release) {
        return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
      }

      let updated;
      try {
        updated = completeBufferRelease(release, new Date().toISOString());
      } catch (error) {
        return reply.code(400).send({
          error: "INVALID_STATE_TRANSITION",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      await updateSettlementReleaseRecord(db, updated);
      return reply.send({
        release: updated,
        phase: computeReleasePhase(updated),
      });
    },
  );
}
