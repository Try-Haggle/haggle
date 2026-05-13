import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
  CONDITIONAL_SETTLEMENT_EIP712_TYPES,
} from "@haggle/contracts";
import {
  canonicalJson,
  canonicalizeAgentPaymentPolicy,
  type AgentPaymentGrant,
  type PaymentLegalAcknowledgement,
  type PaymentTermTag,
  type SettlementApproval,
} from "@haggle/commerce-core";
import {
  PAYMENT_DISCLOSURE_TEXT_HASH,
  PAYMENT_DISCLOSURE_VERSION,
  type DisplayMoney,
  toSettlementAssetMoney,
  withMoneyDecimals,
} from "@haggle/shared";
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
  redactPaymentSensitiveData,
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
  completePaymentOperationIdempotencyRecord,
  createPaymentOperationIdempotencyRecord,
  createAgentPaymentGrantRecord,
  createPaymentDisclosureRecord,
  createPaymentSettlementRecord,
  createRefundRecord,
  createStoredPaymentIntent,
  ensureCommerceOrderForApproval,
  getAgentPaymentGrantById,
  getActivePaymentIntentByOrderId,
  getCommerceOrderByOrderId,
  getPaymentSettlementByPaymentIntentId,
  getPaymentIntentRowById,
  getPaymentIntentById,
  getPaymentOperationIdempotencyRecord,
  getSettlementApprovalById,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";
import { getDepositById, updateDepositStatus } from "../services/dispute-deposit.service.js";
import { createX402PaymentRequirement } from "../payments/x402-requirements.js";
import { X402FacilitatorClient } from "../payments/facilitator-client.js";
import { createConditionalSettlementSigner, type ConditionalSettlementMessage } from "../payments/settlement-signer.js";
import { calculateFeeMinor, calculateSellerFeeSplit, readFeeBpsFromEnv, readHaggleFeeBpsFromEnv } from "../payments/fee-policy.js";
import { writeAuditLog, type AdminActionType } from "../services/admin-action-log.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import { INPUT_LIMITS, boundedJson } from "../lib/input-limits.js";
import { createPublicClient, encodeAbiParameters, http, isAddress, keccak256, type Address, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";

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
    settlement_approval_id: z.string().uuid().max(INPUT_LIMITS.shortTextChars).optional(),
    settlement_approval: settlementApprovalSchema.optional(),
    buyer_authorization_mode: z.enum(["human_wallet", "agent_wallet"]).optional(),
    payment_disclosure_ack: z.object({
      version: z.string().max(INPUT_LIMITS.shortTextChars),
      text_hash: z.string().max(INPUT_LIMITS.mediumTextChars),
      accepted_at: z.string().datetime().max(INPUT_LIMITS.mediumTextChars),
      no_custody: z.boolean().optional(),
      buyer_approved_rules: z.boolean().optional(),
      stripe_fallback: z.boolean().optional(),
      stablecoin_not_investment: z.boolean().optional(),
    }).optional(),
  })
  .refine((value) => Boolean(value.settlement_approval_id || value.settlement_approval), {
    message: "settlement_approval_id or settlement_approval is required",
    path: ["settlement_approval_id"],
  })
  .refine((value) => !(value.settlement_approval_id && value.settlement_approval), {
    message: "provide either settlement_approval_id or settlement_approval, not both",
    path: ["settlement_approval"],
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

const conditionalSettlementRequestSchema = z.object({
  buyer_wallet_address: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  expires_at_unix: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalSettlementFundingSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  settlement_id: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  contract_address: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  chain_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalSettlementConfirmationSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});

type PaymentRail = "x402" | "stripe";

type PaymentQuoteConfirmation = {
  rail: PaymentRail;
  currency: string;
  display: {
    rail_label: string;
    payment_method_label: string;
    settlement_asset: "USDC";
    settlement_network: "Base";
    buyer_total_label: string;
    seller_receives_label: string;
    fee_summary_label: string;
  };
  amount: PaymentIntent["amount"];
  buyer_total: PaymentIntent["amount"];
  seller_receives: PaymentIntent["amount"];
  amount_confirmation: {
    order_amount: DisplayMoney;
    buyer_pays: DisplayMoney;
    settlement_amount: DisplayMoney;
    seller_receives: DisplayMoney;
    buyer_fee: DisplayMoney;
    seller_fee: DisplayMoney;
  };
  fees: {
    buyer_fee_total: PaymentIntent["amount"];
    seller_fee_total: PaymentIntent["amount"];
    items: Array<{
      code: string;
      label: string;
      payer: "buyer" | "seller";
      amount: PaymentIntent["amount"];
      rate_bps: number;
      included_in_buyer_total: boolean;
    }>;
  };
  expires_at?: string;
  provider_reference?: string;
};

function requiresRealPaymentProviders(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function minorFromMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStoredQuoteConfirmation(metadata: Record<string, unknown>): PaymentQuoteConfirmation | null {
  const confirmation = metadata.quote_confirmation;
  if (
    !isRecord(confirmation)
    || !isRecord(confirmation.amount)
    || !isRecord(confirmation.buyer_total)
    || !isRecord(confirmation.seller_receives)
  ) {
    return null;
  }
  if (
    typeof confirmation.rail !== "string"
    || typeof confirmation.currency !== "string"
    || !isRecord(confirmation.fees)
  ) {
    return null;
  }
  if (
    !isRecord(confirmation.fees.buyer_fee_total)
    || !isRecord(confirmation.fees.seller_fee_total)
  ) {
    return null;
  }
  if (confirmation.rail !== "x402" && confirmation.rail !== "stripe") {
    return null;
  }
  return withQuoteDisplay(confirmation as PaymentQuoteConfirmation);
}

function buildQuoteDisplay(rail: PaymentRail): PaymentQuoteConfirmation["display"] {
  if (rail === "x402") {
    return {
      rail_label: "USDC Direct",
      payment_method_label: "Pay from wallet with USDC on Base",
      settlement_asset: "USDC",
      settlement_network: "Base",
      buyer_total_label: "Buyer pays",
      seller_receives_label: "Seller receives",
      fee_summary_label: "No buyer fee. Haggle fee is deducted from seller proceeds.",
    };
  }

  return {
    rail_label: "Card via Stripe",
    payment_method_label: "Pay by card; Stripe converts to USDC on Base",
    settlement_asset: "USDC",
    settlement_network: "Base",
    buyer_total_label: "Buyer pays",
    seller_receives_label: "Seller receives",
    fee_summary_label: "Buyer pays the Stripe onramp fee. Haggle fee is deducted from seller proceeds.",
  };
}

function withQuoteDisplay(confirmation: PaymentQuoteConfirmation): PaymentQuoteConfirmation {
  return {
    ...confirmation,
    display: isRecord(confirmation.display)
      ? { ...buildQuoteDisplay(confirmation.rail), ...confirmation.display }
      : buildQuoteDisplay(confirmation.rail),
    amount_confirmation: buildAmountConfirmation(confirmation),
  };
}

function buildAmountConfirmation(
  confirmation: Omit<PaymentQuoteConfirmation, "amount_confirmation">,
): PaymentQuoteConfirmation["amount_confirmation"] {
  const settlementAmount = toSettlementAssetMoney(confirmation.amount, "USDC");
  const sellerReceives = toSettlementAssetMoney(confirmation.seller_receives, "USDC");
  const sellerFee = toSettlementAssetMoney(confirmation.fees.seller_fee_total, "USDC");
  return {
    order_amount: withMoneyDecimals(confirmation.amount),
    buyer_pays: confirmation.rail === "x402" ? settlementAmount : withMoneyDecimals(confirmation.buyer_total),
    settlement_amount: settlementAmount,
    seller_receives: sellerReceives,
    buyer_fee: confirmation.rail === "x402"
      ? toSettlementAssetMoney(confirmation.fees.buyer_fee_total, "USDC")
      : withMoneyDecimals(confirmation.fees.buyer_fee_total),
    seller_fee: sellerFee,
  };
}

function buildPaymentQuoteConfirmation(
  intent: PaymentIntent,
  metadata: Record<string, unknown>,
  quote?: { provider_reference?: string; expires_at?: string },
): PaymentQuoteConfirmation {
  const currency = intent.amount.currency;
  const grossMinor = intent.amount.amount_minor;
  const haggleFeeBps = readHaggleFeeBpsFromEnv();
  const stripeFeeBps = intent.selected_rail === "stripe" ? readFeeBpsFromEnv("HAGGLE_STRIPE_ONRAMP_FEE_BPS", 150) : 0;
  const defaultSplit = calculateSellerFeeSplit(grossMinor, haggleFeeBps);
  const haggleFeeMinor = minorFromMetadata(metadata, "haggle_fee_minor") ?? defaultSplit.feeAmountMinor;
  const stripeFeeMinor = stripeFeeBps > 0 ? calculateFeeMinor(grossMinor, stripeFeeBps) : 0;
  const sellerAmountMinor = minorFromMetadata(metadata, "seller_amount_minor") ?? defaultSplit.sellerAmountMinor;
  const feeItems: PaymentQuoteConfirmation["fees"]["items"] = [];

  if (haggleFeeMinor > 0) {
    feeItems.push({
      code: "haggle_platform_fee",
      label: "Haggle platform fee",
      payer: "seller",
      amount: { currency, amount_minor: haggleFeeMinor },
      rate_bps: haggleFeeBps,
      included_in_buyer_total: true,
    });
  }
  if (stripeFeeMinor > 0) {
    feeItems.push({
      code: "stripe_onramp_fee",
      label: "Stripe card/onramp fee",
      payer: "buyer",
      amount: { currency, amount_minor: stripeFeeMinor },
      rate_bps: stripeFeeBps,
      included_in_buyer_total: false,
    });
  }

  const confirmation: Omit<PaymentQuoteConfirmation, "amount_confirmation"> = {
    rail: intent.selected_rail,
    currency,
    display: buildQuoteDisplay(intent.selected_rail),
    amount: intent.amount,
    buyer_total: { currency, amount_minor: grossMinor + stripeFeeMinor },
    seller_receives: { currency, amount_minor: sellerAmountMinor },
    fees: {
      buyer_fee_total: { currency, amount_minor: stripeFeeMinor },
      seller_fee_total: { currency, amount_minor: haggleFeeMinor },
      items: feeItems,
    },
    expires_at: quote?.expires_at,
    provider_reference: quote?.provider_reference,
  };
  return {
    ...confirmation,
    amount_confirmation: buildAmountConfirmation(confirmation),
  };
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

function getPaymentOperationFailure(error: unknown):
  | { statusCode: number; body: { error: string; message: string } }
  | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("invalid payment transition:")) {
    return {
      statusCode: 409,
      body: { error: "PAYMENT_STATE_TRANSITION_INVALID", message },
    };
  }
  if (message.startsWith("refund requires SETTLED intent")) {
    return {
      statusCode: 409,
      body: { error: "PAYMENT_REFUND_STATE_INVALID", message },
    };
  }
  if (message.startsWith("refund amount ")) {
    return {
      statusCode: 400,
      body: { error: "PAYMENT_REFUND_AMOUNT_INVALID", message },
    };
  }
  if (
    message.startsWith("unsupported source currency")
    || message.startsWith("unsupported money currency")
    || message.startsWith("unsupported settlement asset")
  ) {
    return {
      statusCode: 400,
      body: { error: "PAYMENT_MONEY_UNSUPPORTED", message },
    };
  }
  return null;
}

function sendPaymentOperationFailure(reply: FastifyReply, error: unknown) {
  const failure = getPaymentOperationFailure(error);
  if (!failure) {
    throw error;
  }
  return reply.code(failure.statusCode).send(failure.body);
}

function getPaymentDisclosureAckError(
  ack: z.infer<typeof preparePaymentSchema>["payment_disclosure_ack"],
): string | null {
  if (!ack) return null;
  if (ack.version !== PAYMENT_DISCLOSURE_VERSION) return "payment disclosure version is not supported";
  if (ack.text_hash !== PAYMENT_DISCLOSURE_TEXT_HASH) return "payment disclosure text_hash is not supported";
  if (ack.no_custody !== true) return "no_custody acknowledgement is required";
  if (ack.buyer_approved_rules !== true) return "buyer_approved_rules acknowledgement is required";
  if (ack.stablecoin_not_investment !== true) return "stablecoin_not_investment acknowledgement is required";
  return null;
}

function isActivePaymentIntentUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown; detail?: unknown };
  if (candidate.code !== "23505") return false;
  return [candidate.constraint, candidate.message, candidate.detail]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.includes("uq_active_payment_intents_order_id"));
}

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function sha256Hex(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requestHeaderString(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getCorrelationId(request: FastifyRequest): string {
  return requestHeaderString(request, "x-request-id")
    ?? requestHeaderString(request, "x-correlation-id")
    ?? request.id;
}

function getPaymentIdempotencyKey(request: FastifyRequest): string | null {
  return requestHeaderString(request, "idempotency-key")
    ?? requestHeaderString(request, "x-idempotency-key");
}

function paymentOperationRequestHash(
  operation: string,
  paymentIntentId: string | null,
  body: unknown,
  actorId: string | undefined,
): string {
  return sha256Hex(canonicalJson({
    operation,
    payment_intent_id: paymentIntentId,
    actor_id: actorId ?? null,
    body: body ?? null,
  }));
}

function safeRedactPaymentLog(value: unknown): unknown {
  try {
    return redactPaymentSensitiveData(value);
  } catch {
    return { redaction_error: true };
  }
}

function mapLegacyPaymentStatusForAudit(status: PaymentIntent["status"]) {
  switch (status) {
    case "CREATED":
    case "QUOTED":
      return "pending";
    case "AUTHORIZED":
    case "SETTLEMENT_PENDING":
      return "authorized";
    case "SETTLED":
      return "captured";
    case "FAILED":
      return "failed";
    case "CANCELED":
      return "canceled";
  }
}

async function beginPaymentOperationIdempotency(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  operation: string,
  paymentIntentId: string | null,
): Promise<{ key: string | null; requestHash: string; replayed: boolean }> {
  const key = getPaymentIdempotencyKey(request);
  const requestHash = paymentOperationRequestHash(operation, paymentIntentId, request.body, request.user?.id);

  if (!key) {
    if (requiresRealPaymentProviders()) {
      reply.code(400).send({
        error: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required for payment mutations in production",
      });
      return { key: null, requestHash, replayed: true };
    }
    return { key: null, requestHash, replayed: false };
  }

  const existing = await getPaymentOperationIdempotencyRecord(db, operation, key);
  if (!existing) {
    const inserted = await createPaymentOperationIdempotencyRecord(db, {
      operation,
      idempotencyKey: key,
      paymentIntentId,
      requestHash,
      responseStatus: 409,
      responseBody: {
        error: "PAYMENT_OPERATION_IN_PROGRESS",
        message: "A payment operation with this idempotency key is already in progress",
      },
    });
    if (inserted) {
      return { key, requestHash, replayed: false };
    }
  }

  const current = existing ?? await getPaymentOperationIdempotencyRecord(db, operation, key);
  if (!current) {
    reply.code(409).send({ error: "IDEMPOTENCY_RECORD_CONFLICT" });
    return { key, requestHash, replayed: true };
  }

  if (current.requestHash !== requestHash) {
    reply.code(409).send({
      error: "IDEMPOTENCY_KEY_CONFLICT",
      message: "Idempotency key was already used with a different payment request",
    });
    return { key, requestHash, replayed: true };
  }

  const responseBody = current.responseBody as Record<string, unknown>;
  const inProgress = current.responseStatus === 409
    && responseBody.error === "PAYMENT_OPERATION_IN_PROGRESS";
  reply.code(current.responseStatus).send(
    inProgress
      ? responseBody
      : {
          ...responseBody,
          idempotent: true,
        },
  );
  return { key, requestHash, replayed: true };
}

async function recordPaymentOperationIdempotency(
  db: Database,
  operation: string,
  idempotency: { key: string | null; requestHash: string },
  _paymentIntentId: string | null,
  responseStatus: number,
  responseBody: Record<string, unknown>,
): Promise<void> {
  if (!idempotency.key) return;
  await completePaymentOperationIdempotencyRecord(db, operation, idempotency.key, {
    responseStatus,
    responseBody: safeRedactPaymentLog(responseBody) as Record<string, unknown>,
  });
}

async function sendAndRecordPaymentOperationFailure(
  db: Database,
  reply: FastifyReply,
  operation: string,
  idempotency: { key: string | null; requestHash: string },
  paymentIntentId: string | null,
  error: unknown,
) {
  const failure = getPaymentOperationFailure(error);
  if (!failure) {
    throw error;
  }
  await recordPaymentOperationIdempotency(
    db,
    operation,
    idempotency,
    paymentIntentId,
    failure.statusCode,
    failure.body,
  );
  return reply.code(failure.statusCode).send(failure.body);
}

async function auditPaymentAction(
  db: Database,
  request: FastifyRequest,
  actionType: AdminActionType,
  params: {
    intent: PaymentIntent;
    previousStatus?: PaymentIntent["status"];
    nextStatus?: PaymentIntent["status"];
    reason: string;
    providerEventId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const actor = {
    id: request.user?.id ?? "system",
    role: request.user?.role ?? "system",
  };
  const event = {
    type: actionType === "payment.refund"
      ? "refund"
      : actionType === "payment.cancel"
        ? "cancel"
        : actionType === "payment.capture"
          ? "capture"
          : actionType === "payment.authorize"
            ? "authorization"
            : actionType === "payment.webhook_rejected"
              ? "webhook_rejected"
              : actionType === "payment.webhook_received"
                ? "webhook_received"
              : "admin_override",
    actor,
    payment_intent_id: params.intent.id,
    order_id: params.intent.order_id,
    provider_event_id: params.providerEventId,
    previous_state: params.previousStatus ? mapLegacyPaymentStatusForAudit(params.previousStatus) : undefined,
    next_state: params.nextStatus ? mapLegacyPaymentStatusForAudit(params.nextStatus) : undefined,
    reason: params.reason,
    request_id: getCorrelationId(request),
    timestamp: new Date().toISOString(),
    metadata: params.metadata ? safeRedactPaymentLog(params.metadata) : undefined,
  };
  await writeAuditLog(db, {
    actorId: actor.id,
    actionType,
    targetType: "payment_intent",
    targetId: params.intent.id,
    payload: event as unknown as Record<string, unknown>,
  });
}

async function auditPaymentWebhookEvent(
  db: Database,
  request: FastifyRequest,
  actionType: "payment.webhook_received" | "payment.webhook_rejected",
  params: {
    provider: "stripe" | "x402";
    providerEventId?: string;
    paymentIntentId?: string;
    reason: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const actor = {
    id: request.user?.id ?? "system",
    role: request.user?.role ?? "system",
  };
  const event = {
    type: actionType === "payment.webhook_received" ? "webhook_received" : "webhook_rejected",
    actor,
    payment_intent_id: params.paymentIntentId,
    provider_event_id: params.providerEventId,
    reason: params.reason,
    request_id: getCorrelationId(request),
    timestamp: new Date().toISOString(),
    metadata: safeRedactPaymentLog({
      provider: params.provider,
      ...(params.metadata ?? {}),
    }),
  };
  await writeAuditLog(db, {
    actorId: actor.id,
    actionType,
    targetType: "payment_webhook",
    targetId: params.providerEventId ?? params.paymentIntentId ?? null,
    payload: event as unknown as Record<string, unknown>,
  });
}

function createPolicyNonce(...parts: string[]): string {
  return sha256Hex(`${parts.join(":")}:${randomUUID()}`);
}

function addDaysIso(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function inferPaymentTermTags(approval: SettlementApproval): PaymentTermTag[] {
  const terms: PaymentTermTag[] = [
    {
      key: "max_price",
      label: "Maximum approved price",
      type: "money",
      value_minor: approval.terms.final_amount_minor,
      currency: approval.terms.currency,
      required: true,
    },
    {
      key: "seller",
      label: "Approved seller",
      type: "text",
      value: approval.terms.seller_id,
      required: true,
    },
    {
      key: "listing",
      label: "Approved listing",
      type: "text",
      value: approval.terms.listing_id,
      required: true,
    },
    {
      key: "payment_rail",
      label: "Selected payment rail",
      type: "select",
      value: approval.terms.selected_payment_rail,
      options: ["x402", "stripe"],
      required: true,
    },
  ];

  if (typeof approval.terms.shipping_cost_minor === "number") {
    terms.push({
      key: "shipping_cost",
      label: "Shipping cost",
      type: "money",
      value_minor: approval.terms.shipping_cost_minor,
      currency: approval.terms.currency,
      required: false,
    });
  }

  if (approval.terms.fulfillment_type) {
    terms.push({
      key: "fulfillment_type",
      label: "Fulfillment type",
      type: "select",
      value: approval.terms.fulfillment_type,
      options: ["shipped", "local_pickup"],
      required: true,
    });
  }

  return terms;
}

function buildAgentPaymentGrant(
  approval: SettlementApproval,
  input: {
    orderId: string;
    agentId: string;
    authorizationMode: BuyerAuthorizationMode | undefined;
    disclosureAck?: z.infer<typeof preparePaymentSchema>["payment_disclosure_ack"];
  },
): AgentPaymentGrant {
  const acknowledgement: PaymentLegalAcknowledgement = {
    no_custody: Boolean(input.disclosureAck?.no_custody),
    buyer_approved_rules: Boolean(input.disclosureAck?.buyer_approved_rules),
    stripe_fallback: Boolean(input.disclosureAck?.stripe_fallback),
    stablecoin_not_investment: Boolean(input.disclosureAck?.stablecoin_not_investment),
  };

  return {
    grant_id: randomUUID(),
    buyer_id: approval.terms.buyer_id,
    agent_id: input.agentId,
    listing_id: approval.terms.listing_id,
    seller_id: approval.terms.seller_id,
    order_id: input.orderId,
    settlement_approval_id: approval.id,
    max_amount_minor: approval.terms.final_amount_minor,
    currency: approval.terms.currency,
    asset: "USDC",
    network: "base",
    allowed_rails: ["x402", "stripe"],
    preferred_rail: "x402",
    terms: inferPaymentTermTags(approval),
    expires_at: approval.terms.shipment_input_due_at ?? addDaysIso(7),
    nonce: createPolicyNonce(approval.id, input.orderId, approval.terms.buyer_id),
    human_confirmation_required: input.authorizationMode !== "agent_wallet",
    legal_acknowledgements: acknowledgement,
  };
}

function buildAgreementHash(approval: SettlementApproval): string {
  return sha256Hex(canonicalJson({
    version: "haggle.settlement_agreement.v1",
    approval_id: approval.id,
    terms: approval.terms,
    seller_policy: approval.seller_policy,
  }));
}

function buildListingHash(listingId: string): string {
  return sha256Hex(canonicalJson({ version: "haggle.listing_ref.v1", listing_id: listingId }));
}

function resolvePaymentReceiver(
  sellerWallet: string,
  config: ReturnType<typeof getX402EnvConfig>,
): { paymentReceiver: string; receiverRole: "seller_wallet" | "payment_receiver" | "conditional_settlement_receiver" } {
  if (config.paymentReceiverAddress) {
    if (
      config.conditionalSettlementAddress
      && config.paymentReceiverAddress.toLowerCase() === config.conditionalSettlementAddress.toLowerCase()
    ) {
      return { paymentReceiver: sellerWallet, receiverRole: "seller_wallet" };
    }
    return {
      paymentReceiver: config.paymentReceiverAddress,
      receiverRole: "payment_receiver",
    };
  }
  return { paymentReceiver: sellerWallet, receiverRole: "seller_wallet" };
}

function validateX402PolicyBinding(payload: X402PaymentPayloadEnvelope, intent: PaymentIntent): string | null {
  const extra = payload.paymentRequirements?.extra;
  if (!extra) {
    return "paymentRequirements.extra is required";
  }
  if (extra.payment_intent_id !== intent.id) {
    return "payment_intent_id mismatch";
  }
  if (extra.order_id !== intent.order_id) {
    return "order_id mismatch";
  }
  if (intent.agent_payment_grant_id && extra.grant_id !== intent.agent_payment_grant_id) {
    return "grant_id mismatch";
  }
  if (intent.approval_policy_hash && extra.approval_policy_hash !== intent.approval_policy_hash) {
    return "approval_policy_hash mismatch";
  }
  if (intent.agreement_hash && extra.agreement_hash !== intent.agreement_hash) {
    return "agreement_hash mismatch";
  }
  if (intent.listing_hash && extra.listing_hash !== intent.listing_hash) {
    return "listing_hash mismatch";
  }
  const expectedSettlementAmount = String(toSettlementAssetMoney(intent.amount, "USDC").amount_minor);
  if (
    extra.settlement_amount_minor !== undefined
    && String(extra.settlement_amount_minor) !== expectedSettlementAmount
  ) {
    return "settlement_amount_minor mismatch";
  }
  return null;
}

function serializeConditionalSettlementMessage(
  message: ConditionalSettlementMessage,
) {
  return {
    orderId: message.orderId,
    paymentIntentId: message.paymentIntentId,
    approvalPolicyHash: message.approvalPolicyHash,
    agreementHash: message.agreementHash,
    listingHash: message.listingHash,
    grantNonce: message.grantNonce,
    buyer: message.buyer,
    seller: message.seller,
    asset: message.asset,
    grossAmount: message.grossAmount.toString(),
    expiresAt: message.expiresAt.toString(),
    signerNonce: message.signerNonce.toString(),
  };
}

function computeConditionalSettlementId(message: ConditionalSettlementMessage, chainId: number): Hex {
  return keccak256(encodeAbiParameters(
    [
      { name: "orderId", type: "bytes32" },
      { name: "paymentIntentId", type: "bytes32" },
      { name: "approvalPolicyHash", type: "bytes32" },
      { name: "buyer", type: "address" },
      { name: "seller", type: "address" },
      { name: "chainId", type: "uint256" },
    ],
    [
      message.orderId,
      message.paymentIntentId,
      message.approvalPolicyHash,
      message.buyer,
      message.seller,
      BigInt(chainId),
    ],
  ));
}

function parseUnixSeconds(value: number | string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  return BigInt(value);
}

function resolveX402ChainId(config: ReturnType<typeof getX402EnvConfig>): number {
  if (process.env.HAGGLE_X402_NETWORK === "base-sepolia" || config.network === "base-sepolia" || config.network === "eip155:84532") {
    return 84532;
  }
  return 8453;
}

function createConditionalSettlementReceiptClient(config: ReturnType<typeof getX402EnvConfig>) {
  if (!config.baseRpcUrl) {
    return null;
  }
  const chainId = resolveX402ChainId(config);
  return createPublicClient({
    chain: chainId === 84532 ? baseSepolia : base,
    transport: http(config.baseRpcUrl),
  });
}

function getConditionalSettlementContext(providerContext: Record<string, unknown>) {
  return providerContext.conditional_settlement
    && typeof providerContext.conditional_settlement === "object"
    && !Array.isArray(providerContext.conditional_settlement)
    ? providerContext.conditional_settlement as Record<string, unknown>
    : {};
}

async function applyPaymentTransitionTriggers(
  db: Database,
  result: { intent: PaymentIntent; trust_triggers: unknown[] },
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

const X402_WEBHOOK_TIMESTAMP_HEADER = "x-haggle-x402-timestamp";
const X402_WEBHOOK_SIGNATURE_HEADER = "x-haggle-x402-signature";
const X402_WEBHOOK_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function singleHeader(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return null;
}

function parseWebhookTimestampMs(timestamp: string): number {
  if (/^\d+$/.test(timestamp)) {
    const numeric = Number(timestamp);
    return timestamp.length <= 10 ? numeric * 1000 : numeric;
  }
  return Date.parse(timestamp);
}

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

  const receivedSig = singleHeader(headers[X402_WEBHOOK_SIGNATURE_HEADER]);
  if (!receivedSig) {
    throw new Error(`missing ${X402_WEBHOOK_SIGNATURE_HEADER} header`);
  }

  const timestamp = singleHeader(headers[X402_WEBHOOK_TIMESTAMP_HEADER]);
  if (!timestamp) {
    throw new Error(`missing ${X402_WEBHOOK_TIMESTAMP_HEADER} header`);
  }
  const timestampMs = parseWebhookTimestampMs(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new Error("invalid x402 webhook timestamp");
  }
  if (Math.abs(Date.now() - timestampMs) > X402_WEBHOOK_MAX_CLOCK_SKEW_MS) {
    throw new Error("stale x402 webhook timestamp");
  }

  const rawPayload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expectedSig = createHmac("sha256", secret)
    .update(`${timestamp}.${rawPayload}`)
    .digest("hex");

  const receivedBuf = Buffer.from(receivedSig.replace(/^sha256=/, ""), "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");

  if (receivedBuf.length !== expectedBuf.length || !timingSafeEqual(receivedBuf, expectedBuf)) {
    throw new Error("invalid x402 webhook signature");
  }
}

function expectedWebhookEnvironment(provider: "stripe" | "x402"): "live" | "test" {
  const configured = provider === "stripe"
    ? process.env.STRIPE_WEBHOOK_ENV
    : process.env.HAGGLE_X402_WEBHOOK_ENV;
  if (configured === "live" || configured === "test") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "live" : "test";
}

function eventEnvironmentFromPayload(payload: Record<string, unknown>): "live" | "test" | null {
  if (typeof payload.livemode === "boolean") {
    return payload.livemode ? "live" : "test";
  }
  const candidate = payload.environment ?? payload.env ?? payload.mode;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = candidate.toLowerCase();
  if (["live", "prod", "production", "real"].includes(normalized)) {
    return "live";
  }
  if (["test", "sandbox", "mock", "dev", "development"].includes(normalized)) {
    return "test";
  }
  return null;
}

function webhookEnvironmentMismatch(
  provider: "stripe" | "x402",
  payload: Record<string, unknown>,
): { expected: "live" | "test"; received: "live" | "test" } | null {
  const received = eventEnvironmentFromPayload(payload);
  const expected = expectedWebhookEnvironment(provider);
  return received && received !== expected ? { expected, received } : null;
}

async function resolveSettlementApproval(
  db: Database,
  body: z.infer<typeof preparePaymentSchema>,
): Promise<SettlementApproval | null> {
  if (!body.settlement_approval_id) return null;
  return getSettlementApprovalById(db, body.settlement_approval_id);
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

async function requireSettlementRecordForPayment(db: Database, intent: PaymentIntent) {
  const settlement = await getPaymentSettlementByPaymentIntentId(db, intent.id);
  if (!settlement) {
    throw new Error(`PAYMENT_SETTLEMENT_RECORD_MISSING:${intent.id}`);
  }
  return settlement;
}

async function prepareFulfillmentForSecuredPayment(db: Database, intent: PaymentIntent) {
  const settlementRelease = await ensureSettlementReleaseForPayment(db, intent);

  const order = await getCommerceOrderByOrderId(db, intent.order_id);
  const orderStatus = order?.status;
  const canAdvanceToFulfillment =
    !orderStatus || orderStatus === "APPROVED" || orderStatus === "PAYMENT_PENDING" || orderStatus === "PAID";

  if (!orderStatus || orderStatus === "APPROVED" || orderStatus === "PAYMENT_PENDING") {
    await updateCommerceOrderStatus(db, intent.order_id, "PAID");
  }

  const shipmentResult = await ensureShipmentForPayment(db, intent);
  if (canAdvanceToFulfillment) {
    await updateCommerceOrderStatus(db, intent.order_id, "FULFILLMENT_PENDING");
  }

  return {
    settlementRelease,
    shipment: shipmentResult.shipment,
    shipmentCreated: shipmentResult.created,
  };
}

async function finalizeSettledPayment(db: Database, intent: PaymentIntent) {
  return prepareFulfillmentForSecuredPayment(db, intent);
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
      parsed.data.settlement_approval
      && !parsed.data.settlement_approval_id
    ) {
      return reply.code(403).send({
        error: "INLINE_SETTLEMENT_APPROVAL_DISABLED",
        message: "Use a stored settlement_approval_id for payment preparation",
      });
    }
    if (requiresRealPaymentProviders() && !parsed.data.payment_disclosure_ack) {
      return reply.code(400).send({
        error: "PAYMENT_DISCLOSURE_ACK_REQUIRED",
        message: "Production payments require an explicit buyer acknowledgement for payment authorization terms",
      });
    }
    const disclosureAckError = getPaymentDisclosureAckError(parsed.data.payment_disclosure_ack);
    if (disclosureAckError) {
      return reply.code(400).send({
        error: "PAYMENT_DISCLOSURE_ACK_INVALID",
        message: disclosureAckError,
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
    if (settlementApproval.terms.buyer_id !== actor.actor_id) {
      return reply.code(404).send({ error: "SETTLEMENT_APPROVAL_NOT_FOUND" });
    }

    let ready;
    try {
      ready = assertPaymentReadyForExecution(settlementApproval, actor);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(400).send({
        error: "PAYMENT_NOT_READY",
        message,
      });
    }

    const railError = getProductionPaymentRailError(ready.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }

    const order = await ensureCommerceOrderForApproval(db, settlementApproval);

    const existingIntent = await getActivePaymentIntentByOrderId(db, order.id);
    if (existingIntent) {
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

    const grant = buildAgentPaymentGrant(settlementApproval, {
      orderId: order.id,
      agentId: "haggle.negotiation_agent",
      authorizationMode: parsed.data.buyer_authorization_mode as BuyerAuthorizationMode | undefined,
      disclosureAck: parsed.data.payment_disclosure_ack,
    });
    const approvalPolicyHash = sha256Hex(canonicalizeAgentPaymentPolicy(grant));
    const storedGrant = await createAgentPaymentGrantRecord(db, grant, approvalPolicyHash);
    if (!storedGrant) {
      return reply.code(500).send({ error: "AGENT_PAYMENT_GRANT_NOT_CREATED" });
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
      agent_payment_grant_id: storedGrant.grant_id,
      approval_policy_hash: storedGrant.approval_policy_hash,
      agreement_hash: buildAgreementHash(settlementApproval),
      listing_hash: buildListingHash(ready.listing_id),
    });

    let storedIntent;
    try {
      storedIntent = await createStoredPaymentIntent(db, intent, {
        settlement_approval_id: ready.settlement_approval_id,
        listing_id: ready.listing_id,
        agent_payment_grant_id: storedGrant.grant_id,
        approval_policy_hash: storedGrant.approval_policy_hash,
        agreement_hash: intent.agreement_hash,
        listing_hash: intent.listing_hash,
        disclosure_required_before_execution: !parsed.data.payment_disclosure_ack,
        actor,
      });
    } catch (error) {
      if (!isActivePaymentIntentUniqueViolation(error)) throw error;
      const concurrentIntent = await getActivePaymentIntentByOrderId(db, order.id);
      if (!concurrentIntent) throw error;
      return reply.send({
        intent: concurrentIntent,
        order,
        participants: {
          buyer_id: ready.buyer_id,
          seller_id: ready.seller_id,
        },
        settlement_context: ready,
        idempotent: true,
      });
    }

    if (parsed.data.payment_disclosure_ack) {
      await createPaymentDisclosureRecord(db, {
        agent_payment_grant_id: storedGrant.grant_id,
        payment_intent_id: storedIntent.id,
        rail: ready.selected_rail,
        version: parsed.data.payment_disclosure_ack.version,
        text_hash: parsed.data.payment_disclosure_ack.text_hash,
        accepted_at: parsed.data.payment_disclosure_ack.accepted_at,
        metadata: {
          no_custody: Boolean(parsed.data.payment_disclosure_ack.no_custody),
          buyer_approved_rules: Boolean(parsed.data.payment_disclosure_ack.buyer_approved_rules),
          stripe_fallback: Boolean(parsed.data.payment_disclosure_ack.stripe_fallback),
          stablecoin_not_investment: Boolean(parsed.data.payment_disclosure_ack.stablecoin_not_investment),
        },
      });
    }

    return reply.code(201).send({
      intent: storedIntent,
      order,
      participants: {
        buyer_id: ready.buyer_id,
        seller_id: ready.seller_id,
      },
      settlement_context: ready,
      agent_payment_grant: storedGrant,
    });
  });

  app.post("/payments/:id/quote", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      return reply.code(503).send(railError);
    }
    if (intent.status === "QUOTED") {
      const row = await getPaymentIntentRowById(db, intent.id);
      const existingMetadata =
        isRecord(row?.providerContext)
          ? row.providerContext
          : {};
      let quoteConfirmation;
      try {
        quoteConfirmation = getStoredQuoteConfirmation(existingMetadata)
          ?? buildPaymentQuoteConfirmation(intent, existingMetadata);
      } catch (error) {
        return sendPaymentOperationFailure(reply, error);
      }
      return reply.send({
        intent,
        metadata: {
          ...existingMetadata,
          quote_confirmation: quoteConfirmation,
        },
        quote_confirmation: quoteConfirmation,
        idempotent: true,
      });
    }

    // Resolve seller wallet: DB first, fall back to ENV
    let sellerWalletAddress: string | null = null;
    if (intent.selected_rail === "x402") {
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

      sellerWalletAddress =
        dbSellerWallet ?? process.env.HAGGLE_X402_SELLER_WALLET ?? null;
    }

    try {
      const result = await service.quoteIntent(intent);
      // Merge seller_wallet into metadata so x402 requirements can resolve it
      const metadataWithoutConfirmation = {
        ...(result.metadata ?? {}),
        ...(sellerWalletAddress ? { seller_wallet: sellerWalletAddress } : {}),
        ...(intent.agent_payment_grant_id ? { agent_payment_grant_id: intent.agent_payment_grant_id } : {}),
        ...(intent.approval_policy_hash ? { approval_policy_hash: intent.approval_policy_hash } : {}),
        ...(intent.agreement_hash ? { agreement_hash: intent.agreement_hash } : {}),
        ...(intent.listing_hash ? { listing_hash: intent.listing_hash } : {}),
      };
      const quoteConfirmation = buildPaymentQuoteConfirmation(result.intent, metadataWithoutConfirmation, result.value);
      const metadata = {
        ...metadataWithoutConfirmation,
        quote_confirmation: quoteConfirmation,
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
      return reply.send({ ...result, metadata, quote_confirmation: quoteConfirmation });
    } catch (error) {
      return sendPaymentOperationFailure(reply, error);
    }
  });

  app.get("/payments/:id/x402/requirements", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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

    const receiver = resolvePaymentReceiver(sellerWallet, x402Config);
    const resource = `${request.protocol}://${request.hostname}/payments/${intent.id}/x402/submit-signature`;
    let requirement;
    try {
      requirement = createX402PaymentRequirement(intent, {
        resource,
        sellerWallet,
        paymentReceiver: receiver.paymentReceiver,
        receiverRole: receiver.receiverRole,
        network: x402Config.network,
        assetAddress: x402Config.assetAddress,
      });
    } catch (error) {
      return sendPaymentOperationFailure(reply, error);
    }

    return reply.send(requirement);
  });

  app.post("/payments/:id/x402/conditional-settlement-request", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }
    if (!x402Config.conditionalSettlementAddress) {
      return reply.code(503).send({
        error: "CONDITIONAL_SETTLEMENT_NOT_CONFIGURED",
        message: "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is required",
      });
    }
    if (!isAddress(x402Config.conditionalSettlementAddress)) {
      return reply.code(500).send({ error: "CONDITIONAL_SETTLEMENT_ADDRESS_INVALID" });
    }
    if (!isAddress(x402Config.assetAddress)) {
      return reply.code(503).send({
        error: "USDC_ASSET_ADDRESS_REQUIRED",
        message: "HAGGLE_X402_USDC_ASSET_ADDRESS must be an ERC-20 contract address for conditional settlement",
      });
    }
    if (!intent.agent_payment_grant_id || !intent.approval_policy_hash || !intent.agreement_hash || !intent.listing_hash) {
      return reply.code(400).send({
        error: "PAYMENT_POLICY_BINDING_REQUIRED",
        message: "conditional settlement requires grant_id, approval_policy_hash, agreement_hash, and listing_hash",
      });
    }

    const parsed = conditionalSettlementRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONDITIONAL_SETTLEMENT_REQUEST", issues: parsed.error.issues });
    }

    const grant = await getAgentPaymentGrantById(db, intent.agent_payment_grant_id);
    if (!grant) {
      return reply.code(404).send({ error: "AGENT_PAYMENT_GRANT_NOT_FOUND" });
    }
    if (grant.status !== "ACTIVE") {
      return reply.code(400).send({ error: "AGENT_PAYMENT_GRANT_NOT_ACTIVE", status: grant.status });
    }
    if (grant.buyer_id !== intent.buyer_id || grant.seller_id !== intent.seller_id || grant.order_id !== intent.order_id) {
      return reply.code(400).send({ error: "AGENT_PAYMENT_GRANT_INTENT_MISMATCH" });
    }
    if (grant.approval_policy_hash !== intent.approval_policy_hash) {
      return reply.code(400).send({ error: "AGENT_PAYMENT_GRANT_POLICY_HASH_MISMATCH" });
    }

    const networkName = x402Config.network.startsWith("eip155:") ? "base" : (x402Config.network as string);
    const buyerWalletAddress =
      parsed.data.buyer_wallet_address
      ?? (await db
        .select({ walletAddress: userWallets.walletAddress })
        .from(userWallets)
        .where(
          and(
            eq(userWallets.userId, intent.buyer_id),
            eq(userWallets.network, networkName),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]?.walletAddress ?? null));

    if (!buyerWalletAddress || !isAddress(buyerWalletAddress)) {
      return reply.code(400).send({ error: "BUYER_WALLET_NOT_RESOLVED" });
    }

    const walletLookupAddress = parsed.data.buyer_wallet_address
      ? buyerWalletAddress.toLowerCase()
      : buyerWalletAddress;
    const registeredWallet = await db
      .select({ walletAddress: userWallets.walletAddress })
      .from(userWallets)
      .where(
        and(
          eq(userWallets.userId, intent.buyer_id),
          eq(userWallets.walletAddress, walletLookupAddress),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]?.walletAddress ?? null);
    if (!registeredWallet) {
      return reply.code(403).send({ error: "BUYER_WALLET_NOT_REGISTERED" });
    }

    const providerContext = await db.query.paymentIntents.findFirst({
      where: (fields, ops) => ops.eq(fields.id, intent.id),
    });
    const sellerWalletAddress =
      typeof providerContext?.providerContext?.seller_wallet === "string"
        ? providerContext.providerContext.seller_wallet
        : process.env.HAGGLE_X402_SELLER_WALLET;
    if (!sellerWalletAddress || !isAddress(sellerWalletAddress)) {
      return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
    }

    let signature;
    try {
      const settlementIntent = {
        ...intent,
        amount: toSettlementAssetMoney(intent.amount, "USDC"),
      };
      const signer = createConditionalSettlementSigner({
        buyerAddressResolver: () => buyerWalletAddress as Address,
        sellerAddressResolver: () => sellerWalletAddress as Address,
      });
      signature = await signer(settlementIntent, {
        grantNonce: grant.nonce,
        approvalPolicyHash: intent.approval_policy_hash,
        agreementHash: intent.agreement_hash,
        listingHash: intent.listing_hash,
        expiresAt: parseUnixSeconds(parsed.data.expires_at_unix),
      });
    } catch (error) {
      return reply.code(503).send({
        error: "CONDITIONAL_SETTLEMENT_SIGNATURE_UNAVAILABLE",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const chainId = resolveX402ChainId(x402Config);
    const settlementId = computeConditionalSettlementId(signature.message, chainId);
    const message = serializeConditionalSettlementMessage(signature.message);
    return reply.send({
      mode: "buyer_contract_call",
      settlement_id: settlementId,
      contract: {
        address: x402Config.conditionalSettlementAddress,
        network: x402Config.network,
        asset: "USDC",
        asset_address: x402Config.assetAddress,
      },
      typed_data: {
        domain: {
          ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
          chainId,
          verifyingContract: x402Config.conditionalSettlementAddress,
        },
        types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
        primaryType: "ConditionalSettlement",
        message,
      },
      contract_call: {
        function_name: "createAndFund",
        params: message,
        signature: signature.signature,
      },
      signature: signature.signature,
      signer_nonce: signature.signer_nonce.toString(),
      expires_at_unix: signature.expires_at.toString(),
    });
  });

  app.post("/payments/:id/x402/conditional-settlement-funding", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }
    if (!x402Config.conditionalSettlementAddress) {
      return reply.code(503).send({
        error: "CONDITIONAL_SETTLEMENT_NOT_CONFIGURED",
        message: "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is required",
      });
    }

    const parsed = conditionalSettlementFundingSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONDITIONAL_SETTLEMENT_FUNDING", issues: parsed.error.issues });
    }
    if (
      parsed.data.contract_address
      && parsed.data.contract_address.toLowerCase() !== x402Config.conditionalSettlementAddress.toLowerCase()
    ) {
      return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_CONTRACT_MISMATCH" });
    }
    if (intent.status === "CREATED") {
      return reply.code(409).send({ error: "PAYMENT_QUOTE_REQUIRED" });
    }
    if (intent.status === "FAILED" || intent.status === "CANCELED") {
      return reply.code(400).send({ error: "PAYMENT_NOT_ACTIVE", status: intent.status });
    }
    if (intent.status === "SETTLED") {
      return reply.send({
        intent,
        idempotent: true,
        conditional_settlement: {
          funding_tx_hash: parsed.data.tx_hash,
          status: "ALREADY_SETTLED",
        },
      });
    }

    const row = await getPaymentIntentRowById(db, intent.id);
    const providerContext =
      row?.providerContext && typeof row.providerContext === "object" && !Array.isArray(row.providerContext)
        ? row.providerContext
        : {};
    const conditionalSettlementContext = {
      ...getConditionalSettlementContext(providerContext),
      contract_address: x402Config.conditionalSettlementAddress,
      chain_id: parsed.data.chain_id ? Number(parsed.data.chain_id) : resolveX402ChainId(x402Config),
      funding_tx_hash: parsed.data.tx_hash,
      settlement_id: parsed.data.settlement_id,
      status: "FUNDING_SUBMITTED",
      submitted_at: new Date().toISOString(),
    };

    let currentIntent = intent;
    let mergedContext: Record<string, unknown> = {
      ...providerContext,
      conditional_settlement: conditionalSettlementContext,
    };

    if (currentIntent.status === "QUOTED") {
      const authorization = await service.authorizeIntent(currentIntent);
      currentIntent = authorization.intent;
      mergedContext = {
        ...mergedContext,
        ...(authorization.metadata ?? {}),
      };
      if (authorization.value) {
        await createPaymentAuthorizationRecord(db, authorization.value, authorization.metadata);
      }
      await applyPaymentTransitionTriggers(db, authorization);
    }

    if (currentIntent.status === "AUTHORIZED") {
      const pending = service.markSettlementPending(currentIntent);
      await updateStoredPaymentIntent(db, pending.intent, mergedContext);
      await applyPaymentTransitionTriggers(db, pending);
      return reply.send({
        intent: pending.intent,
        conditional_settlement: conditionalSettlementContext,
      });
    }

    if (currentIntent.status === "SETTLEMENT_PENDING") {
      await updateStoredPaymentIntent(db, currentIntent, mergedContext);
      return reply.send({
        intent: currentIntent,
        conditional_settlement: conditionalSettlementContext,
        idempotent: true,
      });
    }

    return reply.code(409).send({ error: "PAYMENT_STATE_NOT_FUNDABLE", status: currentIntent.status });
  });

  app.post("/payments/:id/x402/conditional-settlement-confirmation", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    if (intent.selected_rail !== "x402") {
      return reply.code(400).send({ error: "PAYMENT_RAIL_NOT_X402" });
    }

    const parsed = conditionalSettlementConfirmationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_CONDITIONAL_SETTLEMENT_CONFIRMATION", issues: parsed.error.issues });
    }

    const row = await getPaymentIntentRowById(db, intent.id);
    const providerContext =
      row?.providerContext && typeof row.providerContext === "object" && !Array.isArray(row.providerContext)
        ? row.providerContext
        : {};
    const conditionalContext = getConditionalSettlementContext(providerContext);
    const txHash = parsed.data.tx_hash ?? (typeof conditionalContext.funding_tx_hash === "string" ? conditionalContext.funding_tx_hash : undefined);
    if (!txHash) {
      return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_FUNDING_TX_REQUIRED" });
    }
    if (intent.status === "CREATED") {
      return reply.code(409).send({ error: "PAYMENT_QUOTE_REQUIRED" });
    }
    if (intent.status === "FAILED" || intent.status === "CANCELED") {
      return reply.code(400).send({ error: "PAYMENT_NOT_ACTIVE", status: intent.status });
    }
    if (intent.status === "SETTLED") {
      return reply.send({
        intent,
        idempotent: true,
        conditional_settlement: {
          funding_tx_hash: txHash,
          status: "ALREADY_SETTLED",
        },
      });
    }

    const client = createConditionalSettlementReceiptClient(x402Config);
    if (!client) {
      return reply.code(503).send({
        error: "CONDITIONAL_SETTLEMENT_RECEIPT_RPC_NOT_CONFIGURED",
        message: "HAGGLE_BASE_RPC_URL is required to confirm conditional settlement funding",
      });
    }

    const receipt = await client
      .getTransactionReceipt({ hash: txHash as Hex })
      .catch(() => null);

    if (!receipt) {
      const pendingContext = {
        ...conditionalContext,
        funding_tx_hash: txHash,
        status: "FUNDING_PENDING",
        checked_at: new Date().toISOString(),
      };
      await updateStoredPaymentIntent(db, intent, {
        ...providerContext,
        conditional_settlement: pendingContext,
      });
      return reply.code(202).send({
        intent,
        conditional_settlement: pendingContext,
      });
    }

    const confirmedContext = {
      ...conditionalContext,
      funding_tx_hash: txHash,
      status: receipt.status === "success" ? "FUNDING_CONFIRMED" : "FUNDING_FAILED",
      confirmed_at: new Date().toISOString(),
      block_hash: receipt.blockHash,
      block_number: receipt.blockNumber?.toString(),
      transaction_index: receipt.transactionIndex,
      gas_used: receipt.gasUsed?.toString(),
      effective_gas_price: receipt.effectiveGasPrice?.toString(),
    };

    if (receipt.status === "success") {
      let confirmedIntent = intent;
      let confirmedProviderContext: Record<string, unknown> = {
        ...providerContext,
        conditional_settlement: confirmedContext,
      };

      if (confirmedIntent.status === "QUOTED") {
        const authorization = await service.authorizeIntent(confirmedIntent);
        confirmedIntent = authorization.intent;
        confirmedProviderContext = {
          ...confirmedProviderContext,
          ...(authorization.metadata ?? {}),
        };
        if (authorization.value) {
          await createPaymentAuthorizationRecord(db, authorization.value, authorization.metadata);
        }
        await applyPaymentTransitionTriggers(db, authorization);
      }

      if (confirmedIntent.status === "AUTHORIZED") {
        const pending = service.markSettlementPending(confirmedIntent);
        confirmedIntent = pending.intent;
        await applyPaymentTransitionTriggers(db, pending);
      }

      await updateStoredPaymentIntent(db, confirmedIntent, confirmedProviderContext);
      const finalization = await prepareFulfillmentForSecuredPayment(db, confirmedIntent);
      return reply.send({
        intent: confirmedIntent,
        conditional_settlement: confirmedContext,
        finalization,
      });
    }

    if (intent.status === "QUOTED" || intent.status === "AUTHORIZED" || intent.status === "SETTLEMENT_PENDING") {
      const failed = service.failIntent(intent);
      await updateStoredPaymentIntent(db, failed.intent, {
        ...providerContext,
        conditional_settlement: confirmedContext,
      });
      await applyPaymentTransitionTriggers(db, failed);
      return reply.send({
        intent: failed.intent,
        conditional_settlement: confirmedContext,
      });
    }

    await updateStoredPaymentIntent(db, intent, {
      ...providerContext,
      conditional_settlement: confirmedContext,
    });
    return reply.send({
      intent,
      conditional_settlement: confirmedContext,
    });
  });

  app.post("/payments/:id/x402/submit-signature", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    if (!parsed.data.verify_only) {
      if (intent.status === "CREATED") {
        return reply.code(409).send({ error: "PAYMENT_QUOTE_REQUIRED" });
      }
      if (intent.status === "QUOTED") {
        return reply.code(409).send({ error: "PAYMENT_AUTHORIZATION_REQUIRED" });
      }
      if (intent.status === "FAILED" || intent.status === "CANCELED") {
        return reply.code(400).send({ error: "PAYMENT_NOT_ACTIVE", status: intent.status });
      }
      if (intent.status === "SETTLED") {
        await requireSettlementRecordForPayment(db, intent);
        const finalization = await finalizeSettledPayment(db, intent);
        return reply.send({
          intent,
          idempotent: true,
          settlement: { status: "ALREADY_SETTLED" },
          settlement_release: finalization.settlementRelease,
          shipment: finalization.shipment,
        });
      }
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

    const receiver = resolvePaymentReceiver(sellerWallet, x402Config);
    const requirement = createX402PaymentRequirement(intent, {
      resource: `${request.protocol}://${request.hostname}/payments/${intent.id}/x402/submit-signature`,
      sellerWallet,
      paymentReceiver: receiver.paymentReceiver,
      receiverRole: receiver.receiverRole,
      network: x402Config.network,
      assetAddress: x402Config.assetAddress,
    }).accepts[0];

    const x402Payload = parsed.data.payment_payload as X402PaymentPayloadEnvelope;
    const bindingError = validateX402PolicyBinding(x402Payload, intent);
    if (bindingError) {
      return reply.code(400).send({ error: "X402_POLICY_BINDING_MISMATCH", message: bindingError });
    }

    if (parsed.data.verify_only) {
      const verify = await x402Facilitator.verify(x402Payload, requirement);
      return reply.send({ verification: verify });
    }

    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.x402_settle", intent.id);
    if (idempotency.replayed) return;

    if (intent.status === "AUTHORIZED") {
      const pending = service.markSettlementPending(intent);
      await updateStoredPaymentIntent(db, pending.intent);
      intent.status = pending.intent.status;
      intent.updated_at = pending.intent.updated_at;
    }

    const settle = await x402Facilitator.settle(x402Payload, requirement, idempotency.key ?? undefined);
    if (!settle.success) {
      const responseBody = { error: "X402_SETTLEMENT_FAILED", settlement: settle };
      await recordPaymentOperationIdempotency(db, "payment.x402_settle", idempotency, intent.id, 400, responseBody);
      return reply.code(400).send(responseBody);
    }

    const result = await service.settleIntent(intent);
    if (result.value) {
      await createPaymentSettlementRecord(db, {
        ...result.value,
        provider_reference: settle.settlementReference ?? result.value.provider_reference,
        settled_at: result.value.settled_at,
      });
    }
    await updateStoredPaymentIntent(db, result.intent, {
      ...(result.metadata ?? {}),
      facilitator_settlement: settle,
    });
    if (result.trust_triggers.length > 0) {
      await applyTrustTriggers(db, {
        order_id: result.intent.order_id,
        buyer_id: result.intent.buyer_id,
        seller_id: result.intent.seller_id,
        triggers: result.trust_triggers,
      });
    }
    const finalization = await finalizeSettledPayment(db, result.intent);

    const responseBody = {
      settlement: settle,
      payment: result,
      settlement_release: finalization.settlementRelease,
      shipment: finalization.shipment,
    };
    await auditPaymentAction(db, request, "payment.capture", {
      intent: result.intent,
      previousStatus: intent.status,
      nextStatus: result.intent.status,
      reason: "x402 facilitator settlement",
      metadata: result.metadata,
    });
    await recordPaymentOperationIdempotency(db, "payment.x402_settle", idempotency, intent.id, 200, responseBody as Record<string, unknown>);
    return reply.send(responseBody);
  });

  app.post("/payments/:id/authorize", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.authorize", intent.id);
    if (idempotency.replayed) return;
    try {
      const previousStatus = intent.status;
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
      await auditPaymentAction(db, request, "payment.authorize", {
        intent: result.intent,
        previousStatus,
        nextStatus: result.intent.status,
        reason: "payment authorization requested",
        metadata: result.metadata,
      });
      await recordPaymentOperationIdempotency(db, "payment.authorize", idempotency, intent.id, 200, result as unknown as Record<string, unknown>);
      return reply.send(result);
    } catch (error) {
      return sendAndRecordPaymentOperationFailure(db, reply, "payment.authorize", idempotency, intent.id, error);
    }
  });

  app.post("/payments/:id/settlement-pending", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.settlement_pending", intent.id);
    if (idempotency.replayed) return;
    try {
      const previousStatus = intent.status;
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
      await auditPaymentAction(db, request, "payment.admin_override", {
        intent: result.intent,
        previousStatus,
        nextStatus: result.intent.status,
        reason: "payment marked settlement pending",
      });
      await recordPaymentOperationIdempotency(db, "payment.settlement_pending", idempotency, intent.id, 200, result as unknown as Record<string, unknown>);
      return reply.send(result);
    } catch (error) {
      return sendAndRecordPaymentOperationFailure(db, reply, "payment.settlement_pending", idempotency, intent.id, error);
    }
  });

  app.post("/payments/:id/settle", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.capture", intent.id);
    if (idempotency.replayed) return;
    try {
      if (intent.status === "SETTLED") {
        await requireSettlementRecordForPayment(db, intent);
        const finalization = await finalizeSettledPayment(db, intent);
        const responseBody = {
          intent,
          trust_triggers: [],
          idempotent: true,
          settlement_release: finalization.settlementRelease,
          shipment: finalization.shipment,
        };
        await recordPaymentOperationIdempotency(db, "payment.capture", idempotency, intent.id, 200, responseBody as Record<string, unknown>);
        return reply.send(responseBody);
      }

      const previousStatus = intent.status;
      const result = await service.settleIntent(intent);
      if (result.value) {
        await createPaymentSettlementRecord(db, result.value);
      }
      await updateStoredPaymentIntent(db, result.intent, result.metadata);
      if (result.trust_triggers.length > 0) {
        await applyTrustTriggers(db, {
          order_id: result.intent.order_id,
          buyer_id: result.intent.buyer_id,
          seller_id: result.intent.seller_id,
          triggers: result.trust_triggers,
        });
      }

      const finalization = await finalizeSettledPayment(db, result.intent);

      const responseBody = {
        ...result,
        settlement_release: finalization.settlementRelease,
        shipment: finalization.shipment,
      };
      await auditPaymentAction(db, request, "payment.capture", {
        intent: result.intent,
        previousStatus,
        nextStatus: result.intent.status,
        reason: "payment capture requested",
        metadata: result.metadata,
      });
      await recordPaymentOperationIdempotency(db, "payment.capture", idempotency, intent.id, 200, responseBody as Record<string, unknown>);
      return reply.send(responseBody);
    } catch (error) {
      return sendAndRecordPaymentOperationFailure(db, reply, "payment.capture", idempotency, intent.id, error);
    }
  });

  app.post("/payments/:id/fail", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.fail", intent.id);
    if (idempotency.replayed) return;
    try {
      const previousStatus = intent.status;
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
      await auditPaymentAction(db, request, "payment.fail", {
        intent: result.intent,
        previousStatus,
        nextStatus: result.intent.status,
        reason: "payment marked failed",
      });
      await recordPaymentOperationIdempotency(db, "payment.fail", idempotency, intent.id, 200, result as unknown as Record<string, unknown>);
      return reply.send(result);
    } catch (error) {
      return sendAndRecordPaymentOperationFailure(db, reply, "payment.fail", idempotency, intent.id, error);
    }
  });

  app.post("/payments/:id/cancel", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.cancel", intent.id);
    if (idempotency.replayed) return;
    try {
      const previousStatus = intent.status;
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
      await auditPaymentAction(db, request, "payment.cancel", {
        intent: result.intent,
        previousStatus,
        nextStatus: result.intent.status,
        reason: "payment cancellation requested",
      });
      await recordPaymentOperationIdempotency(db, "payment.cancel", idempotency, intent.id, 200, result as unknown as Record<string, unknown>);
      return reply.send(result);
    } catch (error) {
      return sendAndRecordPaymentOperationFailure(db, reply, "payment.cancel", idempotency, intent.id, error);
    }
  });

  app.post("/payments/:id/refund", { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] }, async (request, reply) => {
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
    const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.refund", intent.id);
    if (idempotency.replayed) return;

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

    try {
      const result = await service.refundIntent(intent, refund);
      await createRefundRecord(
        db,
        result.refund,
        typeof result.metadata?.provider_reference === "string" ? result.metadata.provider_reference : null,
      );
      await auditPaymentAction(db, request, "payment.refund", {
        intent,
        previousStatus: intent.status,
        nextStatus: intent.status,
        reason: parsed.data.reason_code,
        metadata: result.metadata,
      });
      await recordPaymentOperationIdempotency(db, "payment.refund", idempotency, intent.id, 200, result as unknown as Record<string, unknown>);
      return reply.send(result);
    } catch (error) {
      return sendAndRecordPaymentOperationFailure(db, reply, "payment.refund", idempotency, intent.id, error);
    }
  });

  app.post("/payments/webhooks/x402", { config: { rawBody: true } }, async (request, reply) => {
    try {
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        return reply.code(500).send({ error: "INTERNAL_ERROR", message: "Raw body not available for signature verification" });
      }
      requireWebhookSignature(request.headers as Record<string, unknown>, rawBody, "x402");
    } catch (error) {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "x402",
        reason: "signature_verification_failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return reply.code(401).send({ error: "INVALID_X402_WEBHOOK", message: error instanceof Error ? error.message : String(error) });
    }

    const body = request.body as { event_type?: string; payment_intent_id?: string; event_id?: string; id?: string; [key: string]: unknown };
    const envMismatch = webhookEnvironmentMismatch("x402", body);
    if (envMismatch) {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "x402",
        providerEventId: typeof body.event_id === "string" ? body.event_id : typeof body.id === "string" ? body.id : undefined,
        paymentIntentId: body.payment_intent_id,
        reason: "environment_mismatch",
        metadata: envMismatch,
      });
      return reply.code(400).send({
        error: "WEBHOOK_ENVIRONMENT_MISMATCH",
        expected: envMismatch.expected,
        received: envMismatch.received,
      });
    }
    const eventType = body.event_type;
    const paymentIntentId = body.payment_intent_id;

    if (!eventType || !paymentIntentId) {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "x402",
        providerEventId: typeof body.event_id === "string" ? body.event_id : typeof body.id === "string" ? body.id : undefined,
        paymentIntentId,
        reason: "missing_required_fields",
        metadata: {
          has_event_type: Boolean(eventType),
          has_payment_intent_id: Boolean(paymentIntentId),
        },
      });
      return reply.code(400).send({ error: "MISSING_WEBHOOK_FIELDS" });
    }

    // Idempotency: derive a stable event ID and skip if already processed
    const webhookEventId = body.event_id ?? body.id ?? `${eventType}:${paymentIntentId}`;
    await auditPaymentWebhookEvent(db, request, "payment.webhook_received", {
      provider: "x402",
      providerEventId: webhookEventId,
      paymentIntentId,
      reason: "validated_webhook_received",
      metadata: {
        event_type: eventType,
      },
    });
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
          if (!["AUTHORIZED", "SETTLEMENT_PENDING", "SETTLED"].includes(intent.status)) {
            return reply.code(409).send({
              accepted: false,
              action: "reconciliation_required",
              reason: "settlement_confirmed_before_authorization",
              payment_intent_id: intent.id,
              local_status: intent.status,
            });
          }
          let settledIntent = intent;
          if (settledIntent.status === "SETTLED") {
            await requireSettlementRecordForPayment(db, settledIntent);
          }
          if (settledIntent.status === "AUTHORIZED") {
            const pending = service.markSettlementPending(settledIntent);
            await updateStoredPaymentIntent(db, pending.intent);
            if (pending.trust_triggers.length > 0) {
              await applyTrustTriggers(db, {
                order_id: pending.intent.order_id,
                buyer_id: pending.intent.buyer_id,
                seller_id: pending.intent.seller_id,
                triggers: pending.trust_triggers,
              });
            }
            settledIntent = pending.intent;
          }

          if (settledIntent.status !== "SETTLED") {
            const result = await service.settleIntent(settledIntent);
            if (result.value) {
              await createPaymentSettlementRecord(db, result.value);
            }
            await updateStoredPaymentIntent(db, result.intent, result.metadata);
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
      console.error("x402 webhook processing error:", safeRedactPaymentLog(error));
      return reply.code(500).send({ accepted: false, action: "error", message: "Webhook processing failed" });
    }
  });

  app.post("/payments/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
    const stripeSig = (request.headers as Record<string, unknown>)["stripe-signature"];
    if (!stripeSig || typeof stripeSig !== "string") {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "stripe",
        reason: "missing_signature_header",
      });
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
        await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
          provider: "stripe",
          reason: "signature_verification_failed",
          metadata: {
            error: err instanceof Error ? err.message : "Webhook signature verification failed",
          },
        });
        return reply.code(401).send({
          error: "INVALID_STRIPE_WEBHOOK",
          message: err instanceof Error ? err.message : "Webhook signature verification failed",
        });
      }
      const envMismatch = webhookEnvironmentMismatch("stripe", {
        livemode: typeof event.livemode === "boolean" ? event.livemode : undefined,
      });
      if (envMismatch) {
        await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
          provider: "stripe",
          providerEventId: event.id,
          reason: "environment_mismatch",
          metadata: envMismatch,
        });
        return reply.code(400).send({
          error: "WEBHOOK_ENVIRONMENT_MISMATCH",
          expected: envMismatch.expected,
          received: envMismatch.received,
        });
      }

      await auditPaymentWebhookEvent(db, request, "payment.webhook_received", {
        provider: "stripe",
        providerEventId: event.id,
        reason: "validated_webhook_received",
        metadata: {
          event_type: event.type,
          livemode: typeof event.livemode === "boolean" ? event.livemode : undefined,
        },
      });

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
            console.error("Stripe deposit fulfillment error:", safeRedactPaymentLog(error));
            return reply.code(500).send({ accepted: false, action: "error", message: "Deposit fulfillment processing failed" });
          }

          const intent = await getPaymentIntentById(db, paymentIntentId);
          if (intent) {
            // Verify event data matches stored intent
            const eventObj = event.data?.object as unknown as { metadata?: Record<string, string> } | undefined;
            const eventOrderId = eventObj?.metadata?.order_id;
            if (eventOrderId && eventOrderId !== intent.order_id) {
              console.error("Stripe webhook order_id mismatch", {
                event_order_id: eventOrderId,
                intent_order_id: intent.order_id,
              });
              return reply.code(400).send({ error: "ORDER_ID_MISMATCH" });
            }
            const eventPolicyHash = eventObj?.metadata?.approval_policy_hash;
            if (eventPolicyHash && intent.approval_policy_hash && eventPolicyHash !== intent.approval_policy_hash) {
              console.error("Stripe webhook approval_policy_hash mismatch", {
                payment_intent_id: intent.id,
              });
              return reply.code(400).send({ error: "APPROVAL_POLICY_HASH_MISMATCH" });
            }

            try {
              let settledIntent = intent;
              if (settledIntent.status === "SETTLED") {
                await requireSettlementRecordForPayment(db, settledIntent);
              }
              // Transition: AUTHORIZED → SETTLEMENT_PENDING → SETTLED
              if (settledIntent.status === "AUTHORIZED") {
                const pending = service.markSettlementPending(settledIntent);
                await updateStoredPaymentIntent(db, pending.intent);
                settledIntent = pending.intent;
              }

              if (settledIntent.status !== "SETTLED") {
                const result = await service.settleIntent(settledIntent);
                if (result.value) {
                  await createPaymentSettlementRecord(db, result.value);
                }
                await updateStoredPaymentIntent(db, result.intent, {
                  ...(result.metadata ?? {}),
                  stripe_event_id: event.id,
                  stripe_event_type: event.type,
                });
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

              await recordWebhookProcessed(db, event.id, "stripe", 200);
              return reply.send({
                accepted: true,
                action: "settled",
                payment_intent_id: paymentIntentId,
                settlement_release: finalization.settlementRelease,
                shipment: finalization.shipment,
              });
            } catch (error) {
              console.error("Stripe webhook settlement error:", safeRedactPaymentLog(error));
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
        await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
          provider: "stripe",
          reason: "signature_verification_failed",
          metadata: {
            mode: "mock",
          },
        });
        return reply.code(401).send({ error: "INVALID_STRIPE_WEBHOOK", message: "Webhook signature verification failed" });
      }
    } else if (process.env.NODE_ENV === "production") {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "stripe",
        reason: "webhook_secret_not_configured",
        metadata: {
          mode: "mock",
        },
      });
      return reply.code(401).send({ error: "INVALID_STRIPE_WEBHOOK", message: "STRIPE_WEBHOOK_SECRET not configured" });
    }

    await auditPaymentWebhookEvent(db, request, "payment.webhook_received", {
      provider: "stripe",
      reason: "validated_webhook_received",
      metadata: {
        mode: "mock",
      },
    });

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
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
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
      const idempotency = await beginPaymentOperationIdempotency(db, request, reply, "payment.stripe_onramp_session", intent.id);
      if (idempotency.replayed) return;

      const amountMinor = intent.amount.amount_minor;
      const buyerPayment = buildPaymentQuoteConfirmation(
        { ...intent, selected_rail: "stripe" },
        {},
      );

      try {
        const session = await createOnrampSession({
          destinationWallet: parsed.data.destination_wallet,
          amountMinor,
          buyerEmail: parsed.data.buyer_email,
          paymentIntentId: id,
          metadata: {
            order_id: intent.order_id,
            grant_id: intent.agent_payment_grant_id ?? "",
            approval_policy_hash: intent.approval_policy_hash ?? "",
            agreement_hash: intent.agreement_hash ?? "",
            listing_hash: intent.listing_hash ?? "",
            preferred_rail: "x402",
            actual_rail: "stripe",
            destination_amount_minor: String(amountMinor),
            buyer_total_minor: String(buyerPayment.buyer_total.amount_minor),
            buyer_fee_minor: String(buyerPayment.fees.buyer_fee_total.amount_minor),
            seller_receives_minor: String(buyerPayment.seller_receives.amount_minor),
            seller_fee_minor: String(buyerPayment.fees.seller_fee_total.amount_minor),
          },
          clientIp: request.ip,
          idempotencyKey: idempotency.key ?? undefined,
        });

        const responseBody = {
          onramp_session_id: session.sessionId,
          client_secret: session.clientSecret,
          hosted_url: session.hostedUrl,
          status: session.status,
          stripe_publishable_key: stripeConfig.publishableKey,
          amount_usd: (buyerPayment.buyer_total.amount_minor / 100).toFixed(2),
          destination_amount_usd: (amountMinor / 100).toFixed(2),
          destination_amount: intent.amount,
          buyer_payable: buyerPayment.buyer_total,
          seller_receives: buyerPayment.seller_receives,
          fee_breakdown: buyerPayment.fees,
          quote_confirmation: buyerPayment,
          destination_network: "base",
          destination_currency: "usdc",
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.stripe_onramp_session",
          idempotency,
          intent.id,
          200,
          responseBody,
        );
        return reply.send(responseBody);
      } catch (err) {
        console.error("Stripe onramp session creation failed:", safeRedactPaymentLog(err));
        const responseBody = {
          error: "ONRAMP_SESSION_FAILED",
          message: "Failed to create onramp session. Please try again.",
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.stripe_onramp_session",
          idempotency,
          intent.id,
          502,
          responseBody,
        );
        return reply.code(502).send(responseBody);
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
