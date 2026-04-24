import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettlementApproval } from "@haggle/commerce-core";
import type { Database } from "@haggle/db";
import { eq, and, userWallets, webhookIdempotency } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { createOnrampSession, getStripeConfig, verifyStripeWebhook } from "../payments/stripe-onramp.js";

// ---------------------------------------------------------------------------
// Webhook idempotency helpers (DB-backed)
// Prevents duplicate processing when x402 facilitator retries webhooks.
// Survives restarts and works across horizontal replicas.
// ---------------------------------------------------------------------------
async function hasWebhookBeenProcessed(
  db: Database,
  idempotencyKey: string,
  source: string,
): Promise<boolean> {
  const existing = await db.query.webhookIdempotency.findFirst({
    where: (fields, ops) => ops.and(
      ops.eq(fields.idempotencyKey, idempotencyKey),
      ops.eq(fields.source, source),
    ),
  });
  return Boolean(existing);
}

async function recordWebhookProcessed(
  db: Database,
  idempotencyKey: string,
  source: string,
  responseStatus: number,
): Promise<void> {
  await db
    .insert(webhookIdempotency)
    .values({
      idempotencyKey,
      source,
      responseStatus,
    })
    .onConflictDoNothing();
}

import {
  assertPaymentReadyForExecution,
  createSettlementRelease,
  type PaymentIntent,
  type Refund,
  type BuyerAuthorizationMode,
  type X402PaymentPayloadEnvelope,
} from "@haggle/payment-core";
import { computeWeightBuffer } from "@haggle/shipping-core";
import {
  createSettlementReleaseRecord,
  getSettlementReleaseByOrderId,
} from "../services/settlement-release.service.js";
import { createPaymentServiceFromEnv, getX402EnvConfig, getRealStripeAdapterOrNull } from "../payments/providers.js";
import {
  createPaymentAuthorizationRecord,
  createPaymentSettlementRecord,
  createRefundRecord,
  createStoredPaymentIntent,
  ensureCommerceOrderForApproval,
  getCommerceOrderByOrderId,
  getPaymentIntentById,
  getPaymentIntentByOrderId,
  getSettlementApprovalById,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";
import { getDepositById, updateDepositStatus } from "../services/dispute-deposit.service.js";
import { createX402PaymentRequirement } from "../payments/x402-requirements.js";
import { X402FacilitatorClient } from "../payments/facilitator-client.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import { INPUT_LIMITS, boundedJson } from "../lib/input-limits.js";

const settlementApprovalSchema = z.object({
  id: z.string().max(INPUT_LIMITS.shortTextChars),
  approval_state: z.enum([
    "NEGOTIATING",
    "MUTUALLY_ACCEPTABLE",
    "HELD_BY_BUYER",
    "RESERVED_PENDING_APPROVAL",
    "AWAITING_SELLER_APPROVAL",
    "APPROVED",
    "DECLINED",
    "EXPIRED",
  ]),
  seller_policy: z.object({
    mode: z.enum(["AUTO_WITHIN_POLICY", "MANUAL_CONFIRMATION"]),
    fulfillment_sla: z.object({
      shipment_input_due_days: z.number(),
    }),
    responsiveness: z.object({
      median_response_minutes: z.number(),
      p95_response_minutes: z.number(),
      reliable_fast_responder: z.boolean(),
    }),
    auto_approval_price_guard_minor: z.number().optional(),
  }),
  terms: z.object({
    listing_id: z.string().max(INPUT_LIMITS.shortTextChars),
    seller_id: z.string().max(INPUT_LIMITS.shortTextChars),
    buyer_id: z.string().max(INPUT_LIMITS.shortTextChars),
    final_amount_minor: z.number().int().positive(),
    currency: z.string().max(8),
    selected_payment_rail: z.enum(["x402", "stripe"]),
    shipment_input_due_at: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  }),
  hold_snapshot: boundedJson(z.any(), INPUT_LIMITS.jsonPayloadBytes, "hold_snapshot").optional(),
  buyer_approved_at: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  seller_approved_at: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
  created_at: z.string().max(INPUT_LIMITS.mediumTextChars),
  updated_at: z.string().max(INPUT_LIMITS.mediumTextChars),
});

const preparePaymentSchema = z
  .object({
    settlement_approval_id: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
    settlement_approval: settlementApprovalSchema.optional(),
    buyer_authorization_mode: z.enum(["human_wallet", "agent_wallet"]).optional(),
  })
  .refine((value) => Boolean(value.settlement_approval_id || value.settlement_approval), {
    message: "settlement_approval_id or settlement_approval is required",
    path: ["settlement_approval_id"],
  });

const refundSchema = z.object({
  payment_intent_id: z.string().max(INPUT_LIMITS.shortTextChars),
  amount_minor: z.number().int().positive(),
  currency: z.string().max(8),
  reason_code: z.string().max(INPUT_LIMITS.shortTextChars),
});

const x402SubmitSchema = z.object({
  payment_payload: boundedJson(z.object({
    x402Version: z.literal(1),
    scheme: z.literal("exact"),
    network: z.string().max(INPUT_LIMITS.shortTextChars),
    payload: boundedJson(z.record(z.any()), INPUT_LIMITS.paymentPayloadBytes, "x402 payload"),
    paymentRequirements: boundedJson(z.any(), INPUT_LIMITS.paymentPayloadBytes, "x402 payment requirements").optional(),
  }), INPUT_LIMITS.paymentPayloadBytes, "x402 payment payload"),
  verify_only: z.boolean().optional(),
});

type PaymentRail = "x402" | "stripe";

function requiresRealPaymentProviders(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function getProductionPaymentRailError(rail: PaymentRail) {
  if (!requiresRealPaymentProviders()) return null;

  if (rail === "x402" && process.env.HAGGLE_X402_MODE !== "real") {
    return {
      error: "PAYMENT_RAIL_NOT_CONFIGURED",
      message: "HAGGLE_X402_MODE=real is required for x402 payments in production",
    };
  }

  if (rail === "stripe" && process.env.STRIPE_MODE !== "real") {
    return {
      error: "PAYMENT_RAIL_NOT_CONFIGURED",
      message: "STRIPE_MODE=real is required for Stripe payments in production",
    };
  }

  return null;
}

import { createHmac, timingSafeEqual } from "node:crypto";

function requireWebhookSignature(
  headers: Record<string, unknown>,
  rawBody: string | Buffer,
  provider: "x402",
): void {
  const secret = process.env.HAGGLE_X402_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("HAGGLE_X402_WEBHOOK_SECRET is not configured");
    }
    // In development/test, skip HMAC verification if secret is absent
    return;
  }

  const receivedSig = headers["x-haggle-x402-signature"];
  if (!receivedSig || typeof receivedSig !== "string") {
    throw new Error("missing x-haggle-x402-signature header");
  }

  const expectedSig = createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"))
    .digest("hex");

  const receivedBuf = Buffer.from(receivedSig.replace(/^sha256=/, ""), "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");

  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    throw new Error("invalid x402 webhook signature");
  }
}

async function resolveSettlementApproval(
  db: Database,
  body: z.infer<typeof preparePaymentSchema>,
): Promise<SettlementApproval | null> {
  if (body.settlement_approval_id) {
    return getSettlementApprovalById(db, body.settlement_approval_id);
  }
  return (body.settlement_approval as SettlementApproval | undefined) ?? null;
}

/**
 * Auto-create a SettlementRelease when a payment reaches SETTLED.
 * Calculates weight buffer from a default parcel weight (can be overridden
 * when actual shipment weight is known).
 */
async function ensureSettlementReleaseForPayment(
  db: Database,
  intent: PaymentIntent,
  declaredWeightOz?: number,
) {
  const existing = await getSettlementReleaseByOrderId(db, intent.order_id);
  if (existing) {
    return existing;
  }

  const weightOz = declaredWeightOz ?? 16; // default 1lb if unknown
  const buffer = computeWeightBuffer(weightOz);
  const bufferMinor = buffer.buffer_amount_minor;

  const release = createSettlementRelease({
    payment_intent_id: intent.id,
    order_id: intent.order_id,
    product_amount: {
      currency: intent.amount.currency,
      amount_minor: intent.amount.amount_minor - bufferMinor,
    },
    buffer_amount: {
      currency: intent.amount.currency,
      amount_minor: bufferMinor,
    },
  });

  return await createSettlementReleaseRecord(db, release);
}

/**
 * Auto-create a shipment record after payment settles.
 */
async function ensureShipmentForPayment(db: Database, intent: PaymentIntent) {
  const existing = await getShipmentByOrderId(db, intent.order_id);
  if (existing) {
    return { shipment: existing, created: false };
  }
  const shipment = await createShipmentRecord(db, intent.order_id, intent.seller_id, intent.buyer_id);
  return { shipment, created: true };
}

async function finalizeSettledPayment(db: Database, intent: PaymentIntent) {
  const settlementRelease = await ensureSettlementReleaseForPayment(db, intent);

  const order = await getCommerceOrderByOrderId(db, intent.order_id);
  const orderStatus = order?.status;
  if (!orderStatus || orderStatus === "APPROVED" || orderStatus === "PAYMENT_PENDING") {
    await updateCommerceOrderStatus(db, intent.order_id, "PAID");
  }

  const shipmentResult = await ensureShipmentForPayment(db, intent);
  if (
    shipmentResult.created
    && (!orderStatus || orderStatus === "APPROVED" || orderStatus === "PAYMENT_PENDING" || orderStatus === "PAID")
  ) {
    await updateCommerceOrderStatus(db, intent.order_id, "FULFILLMENT_PENDING");
  }

  return {
    settlementRelease,
    shipment: shipmentResult.shipment,
    shipmentCreated: shipmentResult.created,
  };
}

async function finalizeStripeDepositFulfillment(
  db: Database,
  depositCorrelationId: string,
  event: { id: string; type: string; data?: { object?: unknown } },
) {
  if (!depositCorrelationId.startsWith("deposit_")) {
    return null;
  }

  const depositId = depositCorrelationId.slice("deposit_".length);
  if (!depositId) {
    throw new Error("INVALID_DEPOSIT_CORRELATION_ID");
  }

  const deposit = await getDepositById(db, depositId);
  if (!deposit) {
    return { accepted: true, action: "ignored", reason: "unknown_deposit" };
  }
  if (deposit.status === "DEPOSITED") {
    return { accepted: true, action: "deposit_already_confirmed", deposit_id: depositId };
  }
  if (deposit.status !== "PENDING") {
    return { accepted: true, action: "ignored", reason: `deposit_${deposit.status.toLowerCase()}` };
  }

  const eventObject = event.data?.object as Record<string, unknown> | undefined;
  const stripeSessionId = eventObject?.id as string | undefined;
  const depositMeta = deposit.metadata as Record<string, unknown> | null;
  if (depositMeta?.rail !== "stripe") {
    throw new Error("DEPOSIT_RAIL_MISMATCH");
  }
  if (
    typeof depositMeta.stripe_payment_intent_id === "string"
    && stripeSessionId
    && depositMeta.stripe_payment_intent_id !== stripeSessionId
  ) {
    throw new Error("DEPOSIT_STRIPE_SESSION_MISMATCH");
  }

  const updated = await updateDepositStatus(db, deposit.id, "DEPOSITED", {
    depositedAt: new Date(),
    metadata: {
      ...(depositMeta ?? {}),
      stripe_event_id: event.id,
      stripe_event_type: event.type,
      stripe_session_id: stripeSessionId ?? depositMeta?.stripe_payment_intent_id,
      confirmed_at: new Date().toISOString(),
    },
  });

  return {
    accepted: true,
    action: "deposit_confirmed",
    deposit_id: depositId,
    deposit: updated,
  };
}

export function registerPaymentRoutes(app: FastifyInstance, db: Database) {
  const { requirePaymentOwner } = createOwnershipMiddleware(db);
  const service = createPaymentServiceFromEnv();
  const x402Config = getX402EnvConfig();
  const x402Facilitator =
    x402Config.facilitatorUrl && x402Config.mode === "real"
      ? new X402FacilitatorClient(x402Config.facilitatorUrl, x402Config.apiKeyId, x402Config.apiKeySecret)
      : null;

  // ─── GET payment by ID ──────────────────────────────────────
  app.get<{ Params: { id: string } }>("/payments/:id", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, request.params.id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_NOT_FOUND" });
    }
    return reply.send({ payment: intent });
  });

  app.post("/payments/prepare", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = preparePaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_PAYMENT_PREPARE_REQUEST", issues: parsed.error.issues });
    }
    if (
      requiresRealPaymentProviders()
      && parsed.data.settlement_approval
      && !parsed.data.settlement_approval_id
      && request.user?.role !== "admin"
    ) {
      return reply.code(403).send({
        error: "INLINE_SETTLEMENT_APPROVAL_DISABLED",
        message: "Use a stored settlement_approval_id for production payments",
      });
    }

    const actor = {
      actor_id: request.user!.id,
      actor_role: "buyer" as const,
    };

    const settlementApproval = await resolveSettlementApproval(db, parsed.data);
    if (!settlementApproval) {
      return reply.code(404).send({ error: "SETTLEMENT_APPROVAL_NOT_FOUND" });
    }

    let ready;
    try {
      ready = assertPaymentReadyForExecution(settlementApproval, actor);
    } catch (error) {
      return reply.code(400).send({
        error: "PAYMENT_NOT_READY",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const railError = getProductionPaymentRailError(ready.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }

    const order = await ensureCommerceOrderForApproval(db, settlementApproval);

    const existingIntent = await getPaymentIntentByOrderId(db, order.id);
    if (existingIntent && existingIntent.status !== "CANCELED" && existingIntent.status !== "FAILED") {
      return reply.send({
        intent: existingIntent,
        order,
        participants: {
          buyer_id: ready.buyer_id,
          seller_id: ready.seller_id,
        },
        settlement_context: ready,
        idempotent: true,
      });
    }

    const intent = service.createIntent({
      order_id: order.id,
      seller_id: ready.seller_id,
      buyer_id: ready.buyer_id,
      selected_rail: ready.selected_rail,
      buyer_authorization_mode: parsed.data.buyer_authorization_mode as BuyerAuthorizationMode | undefined,
      amount: {
        currency: ready.currency,
        amount_minor: ready.amount_minor,
      },
    });

    const storedIntent = await createStoredPaymentIntent(db, intent, {
      settlement_approval_id: ready.settlement_approval_id,
      listing_id: ready.listing_id,
      actor,
    });

    return reply.code(201).send({
      intent: storedIntent,
      order,
      participants: {
        buyer_id: ready.buyer_id,
        seller_id: ready.seller_id,
      },
      settlement_context: ready,
    });
  });

  app.post("/payments/:id/quote", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }

    // Resolve seller wallet: DB first, fall back to ENV
    const networkName = x402Config.network.startsWith("eip155:") ? "base" : (x402Config.network as string);
    const dbSellerWallet = await db
      .select({ walletAddress: userWallets.walletAddress })
      .from(userWallets)
      .where(
        and(
          eq(userWallets.userId, intent.seller_id),
          eq(userWallets.network, networkName),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]?.walletAddress ?? null);

    const sellerWalletAddress =
      dbSellerWallet ?? process.env.HAGGLE_X402_SELLER_WALLET ?? null;

    const result = await service.quoteIntent(intent);
    // Merge seller_wallet into metadata so x402 requirements can resolve it
    const metadata = {
      ...(result.metadata ?? {}),
      ...(sellerWalletAddress ? { seller_wallet: sellerWalletAddress } : {}),
    };
    await updateStoredPaymentIntent(db, result.intent, metadata);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    return reply.send({ ...result, metadata });
  });

  app.get("/payments/:id/x402/requirements", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }

    const providerContext = await db.query.paymentIntents.findFirst({
      where: (fields, ops) => ops.eq(fields.id, intent.id),
    });

    const sellerWallet =
      typeof providerContext?.providerContext?.seller_wallet === "string"
        ? providerContext.providerContext.seller_wallet
        : undefined;

    if (!sellerWallet) {
      return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
    }

    const resource = `${request.protocol}://${request.hostname}/payments/${intent.id}/x402/submit-signature`;
    const requirement = createX402PaymentRequirement(intent, {
      resource,
      sellerWallet,
      network: x402Config.network,
      assetAddress: x402Config.assetAddress,
    });

    return reply.send(requirement);
  });

  app.post("/payments/:id/x402/submit-signature", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }
    if (!x402Facilitator) {
      return reply.code(400).send({ error: "X402_REAL_MODE_NOT_ENABLED" });
    }

    const parsed = x402SubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_X402_SUBMIT_REQUEST", issues: parsed.error.issues });
    }

    const providerContext = await db.query.paymentIntents.findFirst({
      where: (fields, ops) => ops.eq(fields.id, intent.id),
    });

    const sellerWallet =
      typeof providerContext?.providerContext?.seller_wallet === "string"
        ? providerContext.providerContext.seller_wallet
        : undefined;

    if (!sellerWallet) {
      return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
    }

    const requirement = createX402PaymentRequirement(intent, {
      resource: `${request.protocol}://${request.hostname}/payments/${intent.id}/x402/submit-signature`,
      sellerWallet,
      network: x402Config.network,
      assetAddress: x402Config.assetAddress,
    }).accepts[0];

    if (parsed.data.verify_only) {
      const verify = await x402Facilitator.verify(parsed.data.payment_payload as X402PaymentPayloadEnvelope, requirement);
      return reply.send({ verification: verify });
    }

    if (intent.status === "AUTHORIZED") {
      const pending = service.markSettlementPending(intent);
      await updateStoredPaymentIntent(db, pending.intent);
      intent.status = pending.intent.status;
      intent.updated_at = pending.intent.updated_at;
    }

    const settle = await x402Facilitator.settle(parsed.data.payment_payload as X402PaymentPayloadEnvelope, requirement);
    if (!settle.success) {
      return reply.code(400).send({ error: "X402_SETTLEMENT_FAILED", settlement: settle });
    }

    const result = await service.settleIntent(intent);
    await updateStoredPaymentIntent(db, result.intent, {
      ...(result.metadata ?? {}),
      facilitator_settlement: settle,
    });
    if (result.value) {
      await createPaymentSettlementRecord(db, {
        ...result.value,
        provider_reference: settle.settlementReference ?? result.value.provider_reference,
        settled_at: result.value.settled_at,
      });
    }
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    const finalization = await finalizeSettledPayment(db, result.intent);

    return reply.send({
      settlement: settle,
      payment: result,
      settlement_release: finalization.settlementRelease,
      shipment: finalization.shipment,
    });
  });

  app.post("/payments/:id/authorize", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DIRECT_PAYMENT_MUTATION_DISABLED",
        message: "Use the rail-specific payment flow in production",
      });
    }

    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }
    const result = await service.authorizeIntent(intent);
    await updateStoredPaymentIntent(db, result.intent, result.metadata);
    if (result.value) {
      await createPaymentAuthorizationRecord(db, result.value, result.metadata);
    }
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    return reply.send(result);
  });

  app.post("/payments/:id/settlement-pending", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DIRECT_PAYMENT_MUTATION_DISABLED",
        message: "Payment settlement state is controlled by provider flow in production",
      });
    }

    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }
    const result = service.markSettlementPending(intent);
    await updateStoredPaymentIntent(db, result.intent);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    return reply.send(result);
  });

  app.post("/payments/:id/settle", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DIRECT_PAYMENT_MUTATION_DISABLED",
        message: "Payment settlement is controlled by provider webhook or x402 facilitator in production",
      });
    }

    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }
    const result = await service.settleIntent(intent);
    await updateStoredPaymentIntent(db, result.intent, result.metadata);
    if (result.value) {
      await createPaymentSettlementRecord(db, result.value);
    }
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }

    const finalization = await finalizeSettledPayment(db, result.intent);

    return reply.send({
      ...result,
      settlement_release: finalization.settlementRelease,
      shipment: finalization.shipment,
    });
  });

  app.post("/payments/:id/fail", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DIRECT_PAYMENT_MUTATION_DISABLED",
        message: "Payment failure state is controlled by provider webhook or admin in production",
      });
    }

    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const result = service.failIntent(intent);
    await updateStoredPaymentIntent(db, result.intent);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    return reply.send(result);
  });

  app.post("/payments/:id/cancel", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DIRECT_PAYMENT_MUTATION_DISABLED",
        message: "Direct payment cancellation requires a dedicated cancellation workflow in production",
      });
    }

    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const result = service.cancelIntent(intent);
    await updateStoredPaymentIntent(db, result.intent);
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    return reply.send(result);
  });

  app.post("/payments/:id/refund", { preHandler: [requireAuth, requirePaymentOwner()] }, async (request, reply) => {
    if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
      return reply.code(403).send({
        error: "DIRECT_REFUND_DISABLED",
        message: "Direct refunds require admin review in production",
      });
    }

    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }
    const parsed = refundSchema.safeParse({
      ...(request.body as Record<string, unknown>),
      payment_intent_id: (request.params as { id: string }).id,
    });
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_REFUND_REQUEST", issues: parsed.error.issues });
    }

    const refund: Refund = {
      id:
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      payment_intent_id: parsed.data.payment_intent_id,
      amount: {
        currency: parsed.data.currency,
        amount_minor: parsed.data.amount_minor,
      },
      reason_code: parsed.data.reason_code,
      status: "REQUESTED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await service.refundIntent(intent, refund);
    await createRefundRecord(
      db,
      result.refund,
      typeof result.metadata?.provider_reference === "string" ? result.metadata.provider_reference : null,
    );
    return reply.send(result);
  });

  app.post("/payments/webhooks/x402", { config: { rawBody: true } }, async (request, reply) => {
    try {
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Raw body not available for signature verification" });
      }
      requireWebhookSignature(request.headers as Record<string, unknown>, rawBody, "x402");
    } catch (error) {
      return reply.code(401).send({ error: "INVALID_X402_WEBHOOK", message: error instanceof Error ? error.message : String(error) });
    }

    const body = request.body as { event_type?: string; payment_intent_id?: string; event_id?: string; id?: string; [key: string]: unknown };
    const eventType = body.event_type;
    const paymentIntentId = body.payment_intent_id;

    if (!eventType || !paymentIntentId) {
      return reply.code(400).send({ error: "MISSING_WEBHOOK_FIELDS" });
    }

    // Idempotency: derive a stable event ID and skip if already processed
    const webhookEventId = body.event_id ?? body.id ?? `${eventType}:${paymentIntentId}`;
    const duplicate = await hasWebhookBeenProcessed(db, webhookEventId, "x402");
    if (duplicate) {
      return reply.send({ accepted: true, action: "duplicate", reason: "already_processed" });
    }

    const intent = await getPaymentIntentById(db, paymentIntentId);
    if (!intent) {
      // Ignore events for unknown intents (idempotent)
      return reply.send({ accepted: true, action: "ignored", reason: "unknown_intent" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send({ accepted: false, action: "error", ...railError });
    }

    try {
      switch (eventType) {
        case "settlement.confirmed": {
          let settledIntent = intent;
          if (intent.status !== "SETTLED") {
            const result = await service.settleIntent(intent);
            await updateStoredPaymentIntent(db, result.intent, result.metadata);
            if (result.value) {
              await createPaymentSettlementRecord(db, result.value);
            }
            if (result.trust_triggers.length > 0) {
              await applyTrustTriggers(db, {
                order_id: result.intent.order_id,
                buyer_id: result.intent.buyer_id,
                seller_id: result.intent.seller_id,
                triggers: result.trust_triggers,
              });
            }
            settledIntent = result.intent;
          }

          const finalization = await finalizeSettledPayment(db, settledIntent);

          await recordWebhookProcessed(db, webhookEventId, "x402", 200);
          return reply.send({
            accepted: true,
            action: "settled",
            settlement_release: finalization.settlementRelease,
            shipment: finalization.shipment,
          });
        }

        case "settlement.failed": {
          if (intent.status !== "FAILED" && intent.status !== "SETTLED") {
            const result = service.failIntent(intent);
            await updateStoredPaymentIntent(db, result.intent);
            if (result.trust_triggers.length > 0) {
              await applyTrustTriggers(db, {
                order_id: result.intent.order_id,
                buyer_id: result.intent.buyer_id,
                seller_id: result.intent.seller_id,
                triggers: result.trust_triggers,
              });
            }
          }

          await recordWebhookProcessed(db, webhookEventId, "x402", 200);
          return reply.send({ accepted: true, action: "failed" });
        }

        case "payment.expired": {
          if (intent.status !== "CANCELED" && intent.status !== "SETTLED") {
            const result = service.cancelIntent(intent);
            await updateStoredPaymentIntent(db, result.intent);
          }

          await recordWebhookProcessed(db, webhookEventId, "x402", 200);
          return reply.send({ accepted: true, action: "expired" });
        }

        default:
          await recordWebhookProcessed(db, webhookEventId, "x402", 200);
          return reply.send({ accepted: true, action: "ignored", reason: "unknown_event" });
      }
    } catch (error) {
      console.error("x402 webhook processing error:", error);
      return reply.code(500).send({ accepted: false, action: "error", message: "Webhook processing failed" });
    }
  });

  app.post("/payments/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
    const stripeSig = (request.headers as Record<string, unknown>)["stripe-signature"];
    if (!stripeSig || typeof stripeSig !== "string") {
      return reply.code(401).send({ error: "INVALID_STRIPE_WEBHOOK", message: "missing stripe-signature header" });
    }

    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Raw body not available for signature verification" });
    }
    const stripeAdapter = getRealStripeAdapterOrNull();
    if (!stripeAdapter && requiresRealPaymentProviders()) {
      return reply.code(503).send({
        error: "PAYMENT_RAIL_NOT_CONFIGURED",
        message: "STRIPE_MODE=real is required for Stripe webhooks in production",
      });
    }

    // --- Real mode: use Stripe SDK signature verification ---
    if (stripeAdapter) {
      let event;
      try {
        event = stripeAdapter.constructWebhookEvent(rawBody, stripeSig);
      } catch (err) {
        return reply.code(401).send({
          error: "INVALID_STRIPE_WEBHOOK",
          message: err instanceof Error ? err.message : "Webhook signature verification failed",
        });
      }

      // Idempotency check
      const duplicate = await hasWebhookBeenProcessed(db, event.id, "stripe");
      if (duplicate) {
        return reply.send({ accepted: true, action: "duplicate", reason: "already_processed" });
      }

      // Handle crypto onramp fulfillment
      const { RealStripeAdapter } = await import("../payments/real-stripe-adapter.js");
      if (RealStripeAdapter.isOnrampFulfillmentComplete(event)) {
        const paymentIntentId = RealStripeAdapter.extractPaymentIntentId(event);
        if (paymentIntentId) {
          try {
            const depositResult = await finalizeStripeDepositFulfillment(db, paymentIntentId, event);
            if (depositResult) {
              await recordWebhookProcessed(db, event.id, "stripe", 200);
              return reply.send(depositResult);
            }
          } catch (error) {
            console.error("Stripe deposit fulfillment error:", error);
            return reply.code(500).send({ accepted: false, action: "error", message: "Deposit fulfillment processing failed" });
          }

          const intent = await getPaymentIntentById(db, paymentIntentId);
          if (intent && intent.status !== "SETTLED") {
            // Verify event data matches stored intent
            const eventObj = event.data?.object as unknown as { metadata?: Record<string, string> } | undefined;
            const eventOrderId = eventObj?.metadata?.order_id;
            if (eventOrderId && eventOrderId !== intent.order_id) {
              console.error(`Stripe webhook order_id mismatch: event=${eventOrderId}, intent=${intent.order_id}`);
              return reply.code(400).send({ error: "ORDER_ID_MISMATCH" });
            }

            try {
              // Transition: AUTHORIZED → SETTLEMENT_PENDING → SETTLED
              if (intent.status === "AUTHORIZED") {
                const pending = service.markSettlementPending(intent);
                await updateStoredPaymentIntent(db, pending.intent);
                intent.status = pending.intent.status;
                intent.updated_at = pending.intent.updated_at;
              }

              const result = await service.settleIntent(intent);
              await updateStoredPaymentIntent(db, result.intent, {
                ...(result.metadata ?? {}),
                stripe_event_id: event.id,
                stripe_event_type: event.type,
              });
              if (result.value) {
                await createPaymentSettlementRecord(db, result.value);
              }
              if (result.trust_triggers.length > 0) {
                await applyTrustTriggers(db, {
                  order_id: result.intent.order_id,
                  buyer_id: result.intent.buyer_id,
                  seller_id: result.intent.seller_id,
                  triggers: result.trust_triggers,
                });
              }

              const finalization = await finalizeSettledPayment(db, result.intent);

              await recordWebhookProcessed(db, event.id, "stripe", 200);
              return reply.send({
                accepted: true,
                action: "settled",
                payment_intent_id: paymentIntentId,
                settlement_release: finalization.settlementRelease,
                shipment: finalization.shipment,
              });
            } catch (error) {
              console.error("Stripe webhook settlement error:", error);
              return reply.code(500).send({ accepted: false, action: "error", message: "Settlement processing failed" });
            }
          }
        }
      }

      await recordWebhookProcessed(db, event.id, "stripe", 200);
      return reply.send({
        accepted: true,
        action: "processed",
        event_type: event.type,
        event_id: event.id,
      });
    }

    // --- Mock mode: verify signature manually using our verifyStripeWebhook ---
    const config = getStripeConfig();
    if (config.webhookSecret) {
      const valid = verifyStripeWebhook(rawBody, stripeSig, config.webhookSecret);
      if (!valid) {
        return reply.code(401).send({ error: "INVALID_STRIPE_WEBHOOK", message: "Webhook signature verification failed" });
      }
    } else if (process.env.NODE_ENV === "production") {
      return reply.code(401).send({ error: "INVALID_STRIPE_WEBHOOK", message: "STRIPE_WEBHOOK_SECRET not configured" });
    }

    // In mock mode, just acknowledge receipt
    return reply.send({
      accepted: true,
      provider: "stripe",
      mode: "mock",
      received_at: new Date().toISOString(),
    });
  });

  // ─── Stripe Onramp: Create session ─────────────────────────────────
  // POST /payments/:id/onramp/session
  // Creates a Stripe Crypto Onramp session for fiat → USDC on Base.
  // Returns client_secret for embedding the payment widget in frontend.

  const onrampSchema = z.object({
    destination_wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    buyer_email: z.string().email().optional(),
  });

  app.post<{ Params: { id: string } }>(
    "/payments/:id/onramp/session",
    { preHandler: [requireAuth, requirePaymentOwner()] },
    async (request, reply) => {
      const stripeConfig = getStripeConfig();
      if (!stripeConfig.enabled) {
        return reply.code(503).send({
          error: "STRIPE_NOT_CONFIGURED",
          message: "Stripe onramp is not available. Use x402 direct USDC payment.",
        });
      }

      const { id } = request.params;
      const parsed = onrampSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_INPUT", issues: parsed.error.issues });
      }

      // Load payment intent to get amount
      const intent = await getPaymentIntentById(db, id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const railError = getProductionPaymentRailError(intent.selected_rail);
      if (railError) {
        return reply.code(503).send(railError);
      }

      // Verify requester is the buyer
      if (intent.buyer_id !== request.user!.id) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }

      // Verify destination wallet belongs to the buyer
      const buyerWallets = await db
        .select({ walletAddress: userWallets.walletAddress })
        .from(userWallets)
        .where(
          and(
            eq(userWallets.userId, intent.buyer_id),
            eq(userWallets.walletAddress, parsed.data.destination_wallet.toLowerCase()),
          ),
        )
        .limit(1);
      if (buyerWallets.length === 0) {
        return reply.code(403).send({
          error: "WALLET_NOT_REGISTERED",
          message: "Destination wallet is not registered to the buyer. Register your wallet first.",
        });
      }

      const amountMinor = intent.amount.amount_minor;

      try {
        const session = await createOnrampSession({
          destinationWallet: parsed.data.destination_wallet,
          amountMinor,
          buyerEmail: parsed.data.buyer_email,
          paymentIntentId: id,
          clientIp: request.ip,
        });

        return reply.send({
          onramp_session_id: session.sessionId,
          client_secret: session.clientSecret,
          hosted_url: session.hostedUrl,
          status: session.status,
          stripe_publishable_key: stripeConfig.publishableKey,
          amount_usd: (amountMinor / 100).toFixed(2),
          destination_network: "base",
          destination_currency: "usdc",
        });
      } catch (err) {
        console.error("Stripe onramp session creation failed:", err);
        return reply.code(502).send({
          error: "ONRAMP_SESSION_FAILED",
          message: "Failed to create onramp session. Please try again.",
        });
      }
    },
  );

  // ─── Stripe Onramp: Check availability ─────────────────────────────
  // GET /payments/onramp/status
  // Returns whether Stripe onramp is available + supported currencies.

  app.get("/payments/onramp/status", async (_request, reply) => {
    const config = getStripeConfig();
    return reply.send({
      available: config.enabled,
      provider: "stripe",
      supported_destination: {
        currency: "usdc",
        network: "base",
      },
      supported_source: ["usd"],
      fee_info: {
        stripe_fee_pct: 1.5,
        haggle_fee_pct: 1.5,
        total_buyer_fee_pct: 3.0,
        note: "Stripe 1.5% + Haggle 1.5% = 3% total. No hidden fees.",
      },
    });
  });
}
