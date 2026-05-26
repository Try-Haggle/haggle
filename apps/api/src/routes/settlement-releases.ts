import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
  CONDITIONAL_SETTLEMENT_EIP712_TYPES,
} from "@haggle/contracts";
import type { Database } from "@haggle/db";
import {
  createSettlementRelease,
  confirmDelivery,
  completeBuyerReview,
  buyerConfirmReceipt,
  applyApvAdjustment,
  completeBufferRelease,
  computeReleasePhase,
  PaymentService,
} from "@haggle/payment-core";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { randomUUID } from "node:crypto";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import {
  createPaymentSettlementRecord,
  getPaymentIntentById,
  getPaymentIntentRowById,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createConditionalReleaseSigner, type ConditionalReleaseMessage } from "../payments/settlement-signer.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import {
  createSettlementReleaseRecord,
  getSettlementReleaseById,
  getSettlementReleaseByOrderId,
  updateSettlementReleaseRecord,
} from "../services/settlement-release.service.js";
import { readHaggleFeeBpsFromEnv } from "../payments/fee-policy.js";
import { toSettlementAssetMoney } from "@haggle/shared";

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

const applyAdjustmentSchema = z.object({
  adjustment_minor: z.number().int(),
});

const conditionalReleaseRequestSchema = z.object({
  seller_wallet_address: z.string().optional(),
  deadline_unix: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalReleaseExecutionSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  settlement_id: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  contract_address: z.string().optional(),
  chain_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalReleaseConfirmationSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

function getConditionalSettlementContext(providerContext: Record<string, unknown>) {
  return providerContext.conditional_settlement
    && typeof providerContext.conditional_settlement === "object"
    && !Array.isArray(providerContext.conditional_settlement)
    ? providerContext.conditional_settlement as Record<string, unknown>
    : {};
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
  result: { intent: { order_id: string; buyer_id: string; seller_id: string }; trust_triggers: unknown[] },
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
        return reply.code(403).send({ error: "FORBIDDEN", message: "You do not have access to this resource" });
      }
    }
    return reply.send({
      release,
      phase: computeReleasePhase(release),
    });
  });

  // GET /settlement-releases/by-order/:orderId — Get release by order ID
  app.get("/settlement-releases/by-order/:orderId", { preHandler: [requireAuth, requireOrderOwner()] }, async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const release = await getSettlementReleaseByOrderId(db, orderId);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }
    return reply.send({
      release,
      phase: computeReleasePhase(release),
    });
  });

  // POST /settlement-releases/:id/confirm-delivery — Confirm delivery
  app.post("/settlement-releases/:id/confirm-delivery", { preHandler: [requireAdmin] }, async (request, reply) => {
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
  });

  // POST /settlement-releases/:id/complete-buyer-review — Complete buyer review
  app.post("/settlement-releases/:id/complete-buyer-review", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
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
  });

  // POST /settlement-releases/:id/apply-adjustment — Apply APV weight adjustment
  app.post("/settlement-releases/:id/apply-adjustment", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }

    const parsed = applyAdjustmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REQUEST", issues: parsed.error.issues });
    }

    let updated;
    try {
      updated = applyApvAdjustment(release, parsed.data.adjustment_minor);
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
  });

  // POST /settlement-releases/:id/release-buffer — Release weight buffer
  app.post("/settlement-releases/:id/release-buffer", { preHandler: [requireAdmin] }, async (request, reply) => {
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
  });

  app.post("/settlement-releases/:id/conditional-release-request", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }
    if (computeReleasePhase(release) !== "FULLY_RELEASED") {
      return reply.code(409).send({
        error: "RELEASE_NOT_FULLY_UNLOCKED",
        message: "conditional settlement release moves the full funded amount, so product and buffer release phases must both be complete",
        phase: computeReleasePhase(release),
      });
    }

    const parsed = conditionalReleaseRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONDITIONAL_RELEASE_REQUEST", issues: parsed.error.issues });
    }

    const intent = await getPaymentIntentById(db, release.payment_intent_id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
    const providerContext =
      intentRow?.providerContext && typeof intentRow.providerContext === "object" && !Array.isArray(intentRow.providerContext)
        ? intentRow.providerContext
        : {};
    const conditionalContext = getConditionalSettlementContext(providerContext);
    const settlementId = typeof conditionalContext.settlement_id === "string" ? conditionalContext.settlement_id : undefined;
    if (!settlementId) {
      return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
    }
    if (conditionalContext.status !== "FUNDING_CONFIRMED") {
      return reply.code(409).send({ error: "CONDITIONAL_SETTLEMENT_NOT_CONFIRMED", status: conditionalContext.status });
    }

    const sellerWallet = parsed.data.seller_wallet_address
      ?? (typeof providerContext.seller_wallet === "string" ? providerContext.seller_wallet : undefined)
      ?? process.env.HAGGLE_X402_SELLER_WALLET;
    const feeWallet = process.env.HAGGLE_X402_FEE_WALLET;
    if (!sellerWallet) {
      return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
    }
    if (!feeWallet) {
      return reply.code(503).send({ error: "HAGGLE_X402_FEE_WALLET_REQUIRED" });
    }

    let signature;
    try {
      const signer = createConditionalReleaseSigner();
      const settlementAmount = toSettlementAssetMoney(intent.amount, "USDC");
      signature = await signer({
        settlementId,
        sellerWallet: sellerWallet as Address,
        feeWallet: feeWallet as Address,
        grossAmountMinor: settlementAmount.amount_minor,
        feeBps: readHaggleFeeBpsFromEnv(),
        deadline: parsed.data.deadline_unix ? BigInt(parsed.data.deadline_unix) : undefined,
      });
    } catch (error) {
      return reply.code(503).send({
        error: "CONDITIONAL_RELEASE_SIGNATURE_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const message = serializeConditionalReleaseMessage(signature.message);
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
      signer_nonce: signature.signer_nonce.toString(),
    });
  });

  app.post("/settlement-releases/:id/conditional-release-execution", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }
    if (computeReleasePhase(release) !== "FULLY_RELEASED") {
      return reply.code(409).send({
        error: "RELEASE_NOT_FULLY_UNLOCKED",
        phase: computeReleasePhase(release),
      });
    }

    const parsed = conditionalReleaseExecutionSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONDITIONAL_RELEASE_EXECUTION", issues: parsed.error.issues });
    }

    const intent = await getPaymentIntentById(db, release.payment_intent_id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }

    const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
    const providerContext =
      intentRow?.providerContext && typeof intentRow.providerContext === "object" && !Array.isArray(intentRow.providerContext)
        ? intentRow.providerContext
        : {};
    const conditionalContext = getConditionalSettlementContext(providerContext);
    const settlementId = parsed.data.settlement_id
      ?? (typeof conditionalContext.settlement_id === "string" ? conditionalContext.settlement_id : undefined);
    if (!settlementId) {
      return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
    }
    if (conditionalContext.status !== "FUNDING_CONFIRMED" && conditionalContext.status !== "RELEASE_SUBMITTED") {
      return reply.code(409).send({ error: "CONDITIONAL_SETTLEMENT_NOT_RELEASABLE", status: conditionalContext.status });
    }

    const submittedContext = {
      ...conditionalContext,
      settlement_id: settlementId,
      release_tx_hash: parsed.data.tx_hash,
      release_contract_address: parsed.data.contract_address ?? process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
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
  });

  app.post("/settlement-releases/:id/conditional-release-confirmation", { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const release = await getSettlementReleaseById(db, id);
    if (!release) {
      return reply.code(404).send({ error: "SETTLEMENT_RELEASE_NOT_FOUND" });
    }

    const parsed = conditionalReleaseConfirmationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONDITIONAL_RELEASE_CONFIRMATION", issues: parsed.error.issues });
    }

    const intent = await getPaymentIntentById(db, release.payment_intent_id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }

    const intentRow = await getPaymentIntentRowById(db, release.payment_intent_id);
    const providerContext =
      intentRow?.providerContext && typeof intentRow.providerContext === "object" && !Array.isArray(intentRow.providerContext)
        ? intentRow.providerContext
        : {};
    const conditionalContext = getConditionalSettlementContext(providerContext);
    const txHash = parsed.data.tx_hash
      ?? (typeof conditionalContext.release_tx_hash === "string" ? conditionalContext.release_tx_hash : undefined);
    if (!txHash) {
      return reply.code(400).send({ error: "CONDITIONAL_RELEASE_TX_REQUIRED" });
    }

    const client = createConditionalReleaseReceiptClient();
    if (!client) {
      return reply.code(503).send({
        error: "CONDITIONAL_RELEASE_RECEIPT_RPC_NOT_CONFIGURED",
        message: "HAGGLE_BASE_RPC_URL is required to confirm conditional settlement release",
      });
    }

    const receipt = await client
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null);

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
      return reply.code(202).send({
        release,
        intent,
        conditional_settlement: pendingContext,
      });
    }

    const confirmedContext = {
      ...conditionalContext,
      release_tx_hash: txHash,
      status: receipt.status === "success" ? "RELEASE_CONFIRMED" : "RELEASE_FAILED",
      release_confirmed_at: new Date().toISOString(),
      release_block_hash: receipt.blockHash,
      release_block_number: receipt.blockNumber?.toString(),
      release_transaction_index: receipt.transactionIndex,
      release_gas_used: receipt.gasUsed?.toString(),
      release_effective_gas_price: receipt.effectiveGasPrice?.toString(),
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
      return reply.code(409).send({ error: "PAYMENT_NOT_SETTLEMENT_PENDING", status: intent.status });
    }

    const paymentService = new PaymentService({});
    const settledAt = new Date().toISOString();
    const result = paymentService.recordExternalSettlement(intent, {
      id: `conditional_release_${randomUUID()}`,
      payment_intent_id: intent.id,
      rail: "x402",
      provider_reference: txHash,
      settled_amount: intent.amount,
      settled_at: settledAt,
      status: "SETTLED",
    }, settledAt);

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
  });

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
