// biome-ignore-all lint/suspicious/noImplicitAnyLet: Guarded assignments retain payment adapter result types.
import {
  type AgentPaymentGrant,
  canonicalizeAgentPaymentPolicy,
  canonicalJson,
  FULFILLMENT_TYPE_VALUES,
  type FulfillmentType,
  isNoShippingFulfillment,
  normalizeFulfillmentType,
  type PaymentLegalAcknowledgement,
  type PaymentTermTag,
  requiresShipmentForFulfillment,
  type SettlementApproval,
} from "@haggle/commerce-core";
import {
  CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
  CONDITIONAL_SETTLEMENT_EIP712_TYPES,
  HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
} from "@haggle/contracts";
import type { Database } from "@haggle/db";
import { and, eq, userWallets } from "@haggle/db";
import {
  assertPaymentReadyForExecution,
  type BuyerAuthorizationMode,
  createSettlementRelease,
  type PaymentIntent,
  type ProductionPaymentState,
  productionStateAfterRefund,
  type Refund,
  redactPaymentSensitiveData,
  type X402PaymentPayloadEnvelope,
} from "@haggle/payment-core";
import {
  type DisplayMoney,
  PAYMENT_DISCLOSURE_TEXT_HASH,
  PAYMENT_DISCLOSURE_VERSION,
  toSettlementAssetMoney,
  withMoneyDecimals,
} from "@haggle/shared";
import { computeWeightBuffer } from "@haggle/shipping-core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type Address,
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  type Hex,
  http,
  isAddress,
  keccak256,
  stringToHex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { z } from "zod";
import { boundedJson, INPUT_LIMITS } from "../lib/input-limits.js";
import { createOwnershipMiddleware } from "../middleware/ownership.js";
import { requireAdmin, requireAuth } from "../middleware/require-auth.js";
import { X402FacilitatorClient } from "../payments/facilitator-client.js";
import {
  calculateSellerFeeSplit,
  calculateStripeOnrampFeeMinor,
  readFeeBpsFromEnv,
  readHaggleFeeBpsFromEnv,
} from "../payments/fee-policy.js";
import {
  emitPaymentMetricSafely,
  normalizePaymentMetricEventType,
  normalizePaymentMetricFailureType,
  type PaymentMetricOperation,
  toPaymentMetricOperation,
} from "../payments/observability.js";
import { requiresRealPaymentProviders } from "../payments/provider-runtime-policy.js";
import {
  createPaymentServiceFromEnv,
  getRealStripeAdapterOrNull,
  getX402EnvConfig,
} from "../payments/providers.js";
import {
  type ConditionalRefundMessage,
  type ConditionalSettlementMessage,
  createConditionalRefundSigner,
  createConditionalSettlementSigner,
} from "../payments/settlement-signer.js";
import {
  createOnrampSession,
  getStripeConfig,
  verifyStripeWebhook,
} from "../payments/stripe-onramp.js";
import { createX402PaymentRequirement } from "../payments/x402-requirements.js";
import { type AdminActionType, writeAuditLog } from "../services/admin-action-log.service.js";
import {
  CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS,
  conditionalSettlementConfirmationRetry,
  evaluateConditionalSettlementFinality,
} from "../services/conditional-settlement-finality.service.js";
import { getDepositById, updateDepositStatus } from "../services/dispute-deposit.service.js";
import {
  ensureFulfillmentRecordForOrder,
  type FulfillmentRecord,
} from "../services/fulfillment-record.service.js";
import {
  assertListingPayableForPrepare,
  beginListingFunding,
  confirmListingFunded,
  LISTING_CLAIM_HTTP,
  ListingClaimError,
  releaseListingFunding,
} from "../services/listing-claim.service.js";
import {
  completePaymentOperationIdempotencyRecord,
  createAgentPaymentGrantRecord,
  createPaymentAuthorizationRecord,
  createPaymentDisclosureRecord,
  createPaymentOperationIdempotencyRecord,
  createPaymentSettlementRecord,
  createRefundRecord,
  createStoredPaymentIntent,
  ensureCommerceOrderForApproval,
  getActivePaymentIntentByOrderId,
  getAgentPaymentGrantById,
  getCommerceOrderByOrderId,
  getInProgressPaymentOperationForIntent,
  getPaymentIntentById,
  getPaymentIntentRowById,
  getPaymentOperationIdempotencyRecord,
  getPaymentSettlementByPaymentIntentId,
  getRefundRecordsByPaymentIntentId,
  getSettlementApprovalById,
  lockPaymentIntentShippingModeIfUnset,
  setPaymentIntentProviderContext,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import {
  createSettlementReleaseRecord,
  getSettlementReleaseByOrderId,
} from "../services/settlement-release.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  startWebhookClaimHeartbeat,
  webhookPayloadSha256,
} from "../services/webhook-event-claim.service.js";
import {
  defaultShippingExecutionMode,
  metadataForShippingExecutionMode,
  physicalShippingReadiness,
  readShippingExecutionMode,
  SHIPPING_EXECUTION_MODES,
  type ShippingExecutionMode,
} from "../shipping/shipping-execution-mode.js";

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
    auto_approval_price_guard_minor: z.number().int().safe().nonnegative().optional(),
  }),
  terms: z.object({
    listing_id: z.string().max(INPUT_LIMITS.shortTextChars),
    seller_id: z.string().max(INPUT_LIMITS.shortTextChars),
    buyer_id: z.string().max(INPUT_LIMITS.shortTextChars),
    final_amount_minor: z.number().int().safe().positive(),
    currency: z.string().max(8),
    selected_payment_rail: z.enum(["x402", "stripe"]),
    shipment_input_due_at: z.string().max(INPUT_LIMITS.mediumTextChars).optional(),
    shipping_cost_minor: z.number().int().safe().nonnegative().optional(),
    shipping_cost_bearer: z.enum(["buyer", "seller", "split"]).optional(),
    shipping_cost_buyer_share_minor: z.number().int().safe().nonnegative().optional(),
    shipping_cost_seller_share_minor: z.number().int().safe().nonnegative().optional(),
    weight_buffer_minor: z.number().int().safe().nonnegative().optional(),
    fulfillment_type: z
      .enum([
        "physical_shipping",
        "shipped",
        "local_pickup",
        "digital_delivery",
        "external_platform_transfer",
        "onchain_transfer",
      ])
      .optional(),
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
    shipping_execution_mode: z.enum(SHIPPING_EXECUTION_MODES).optional(),
    payment_disclosure_ack: z
      .object({
        version: z.string().max(INPUT_LIMITS.shortTextChars),
        text_hash: z.string().max(INPUT_LIMITS.mediumTextChars),
        accepted_at: z.string().datetime().max(INPUT_LIMITS.mediumTextChars),
        no_custody: z.boolean().optional(),
        buyer_approved_rules: z.boolean().optional(),
        stripe_fallback: z.boolean().optional(),
        stablecoin_not_investment: z.boolean().optional(),
      })
      .optional(),
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
  amount_minor: z.number().int().safe().positive(),
  currency: z.string().max(8),
  reason_code: z.string().max(INPUT_LIMITS.shortTextChars),
});

const x402SubmitSchema = z.object({
  payment_payload: boundedJson(
    z.object({
      x402Version: z.literal(1),
      scheme: z.literal("exact"),
      network: z.string().max(INPUT_LIMITS.shortTextChars),
      payload: boundedJson(z.record(z.any()), INPUT_LIMITS.paymentPayloadBytes, "x402 payload"),
      paymentRequirements: boundedJson(
        z.any(),
        INPUT_LIMITS.paymentPayloadBytes,
        "x402 payment requirements",
      ).optional(),
    }),
    INPUT_LIMITS.paymentPayloadBytes,
    "x402 payment payload",
  ),
  verify_only: z.boolean().optional(),
});

const conditionalSettlementRequestSchema = z.object({
  buyer_wallet_address: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  expires_at_unix: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalSettlementFundingSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  settlement_id: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  contract_address: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  chain_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalSettlementConfirmationSchema = z.object({
  tx_hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

const conditionalSettlementRefundRequestSchema = z.object({
  deadline_unix: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalSettlementRefundExecutionSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  settlement_id: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  contract_address: z.string().max(INPUT_LIMITS.shortTextChars).optional(),
  chain_id: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).optional(),
});

const conditionalSettlementRefundConfirmationSchema = z.object({
  tx_hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

const conditionalSettlementDisputeConfirmationSchema = z.object({
  tx_hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  evidence_hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
});

type PaymentRail = "x402" | "stripe";

const FULFILLMENT_TYPE_OPTIONS = FULFILLMENT_TYPE_VALUES;

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
      payer: "buyer" | "seller" | "negotiated_total";
      amount: PaymentIntent["amount"];
      rate_bps: number;
      included_in_buyer_total: boolean;
    }>;
  };
  expires_at?: string;
  provider_reference?: string;
};

function minorFromMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStoredQuoteConfirmation(
  metadata: Record<string, unknown>,
): PaymentQuoteConfirmation | null {
  const confirmation = metadata.quote_confirmation;
  if (
    !isRecord(confirmation) ||
    !isRecord(confirmation.amount) ||
    !isRecord(confirmation.buyer_total) ||
    !isRecord(confirmation.seller_receives)
  ) {
    return null;
  }
  if (
    typeof confirmation.rail !== "string" ||
    typeof confirmation.currency !== "string" ||
    !isRecord(confirmation.fees)
  ) {
    return null;
  }
  if (
    !isRecord(confirmation.fees.buyer_fee_total) ||
    !isRecord(confirmation.fees.seller_fee_total)
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
      fee_summary_label: "Haggle fee is included in the negotiated total and split at settlement.",
    };
  }

  return {
    rail_label: "Card via Stripe",
    payment_method_label: "Pay by card; Stripe converts to USDC on Base",
    settlement_asset: "USDC",
    settlement_network: "Base",
    buyer_total_label: "Buyer pays",
    seller_receives_label: "Seller receives",
    fee_summary_label:
      "Stripe onramp fee is added for card funding; Haggle fee remains part of the negotiated total.",
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
    buyer_pays:
      confirmation.rail === "x402" ? settlementAmount : withMoneyDecimals(confirmation.buyer_total),
    settlement_amount: settlementAmount,
    seller_receives: sellerReceives,
    buyer_fee:
      confirmation.rail === "x402"
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
  const stripeFeeBps =
    intent.selected_rail === "stripe" ? readFeeBpsFromEnv("HAGGLE_STRIPE_ONRAMP_FEE_BPS", 150) : 0;
  const defaultSplit = calculateSellerFeeSplit(grossMinor, haggleFeeBps);
  const haggleFeeMinor =
    minorFromMetadata(metadata, "haggle_fee_minor") ?? defaultSplit.feeAmountMinor;
  const stripeFeeMinor =
    stripeFeeBps > 0 ? calculateStripeOnrampFeeMinor(grossMinor, stripeFeeBps) : 0;
  const sellerAmountMinor =
    minorFromMetadata(metadata, "seller_amount_minor") ?? defaultSplit.sellerAmountMinor;
  const feeItems: PaymentQuoteConfirmation["fees"]["items"] = [];

  if (haggleFeeMinor > 0) {
    feeItems.push({
      code: "haggle_platform_fee",
      label: "Haggle platform fee",
      payer: "negotiated_total",
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

function getPaymentAdminMutationReason(
  request: FastifyRequest,
  fallbackReason: string,
): { reason: string } | { error: { error: string; message: string } } {
  if (!requiresRealPaymentProviders() || request.user?.role !== "admin") {
    return { reason: fallbackReason };
  }

  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : {};
  const headerReason = request.headers["x-haggle-payment-reason"];
  const reason = [
    body.admin_reason,
    body.reason,
    body.reason_code,
    typeof headerReason === "string" ? headerReason : undefined,
  ]
    .find(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate.trim().length > 0,
    )
    ?.trim();

  if (!reason) {
    return {
      error: {
        error: "PAYMENT_ADMIN_REASON_REQUIRED",
        message: "Admin payment mutations in production require a reason",
      },
    };
  }

  if (reason.length > INPUT_LIMITS.shortTextChars) {
    return {
      error: {
        error: "PAYMENT_ADMIN_REASON_TOO_LONG",
        message: "Admin payment mutation reason is too long",
      },
    };
  }

  return { reason };
}

function getPaymentOperationFailure(
  error: unknown,
): { statusCode: number; body: { error: string; message: string } } | null {
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
    message.startsWith("unsupported source currency") ||
    message.startsWith("unsupported money currency") ||
    message.startsWith("unsupported settlement asset")
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
  if (ack.version !== PAYMENT_DISCLOSURE_VERSION)
    return "payment disclosure version is not supported";
  if (ack.text_hash !== PAYMENT_DISCLOSURE_TEXT_HASH)
    return "payment disclosure text_hash is not supported";
  if (ack.no_custody !== true) return "no_custody acknowledgement is required";
  if (ack.buyer_approved_rules !== true) return "buyer_approved_rules acknowledgement is required";
  if (ack.stablecoin_not_investment !== true)
    return "stablecoin_not_investment acknowledgement is required";
  return null;
}

function isActivePaymentIntentUniqueViolation(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    detail?: unknown;
  };
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
  return (
    requestHeaderString(request, "x-request-id") ??
    requestHeaderString(request, "x-correlation-id") ??
    request.id
  );
}

function getPaymentIdempotencyKey(request: FastifyRequest): string | null {
  return (
    requestHeaderString(request, "idempotency-key") ??
    requestHeaderString(request, "x-idempotency-key")
  );
}

function paymentOperationRequestHash(
  operation: string,
  paymentIntentId: string | null,
  body: unknown,
  actorId: string | undefined,
): string {
  return sha256Hex(
    canonicalJson({
      operation,
      payment_intent_id: paymentIntentId,
      actor_id: actorId ?? null,
      body: body ?? null,
    }),
  );
}

function safeRedactPaymentLog(value: unknown): unknown {
  try {
    return redactPaymentSensitiveData(value);
  } catch {
    return { redaction_error: true };
  }
}

function getPaymentMetricEnvironment() {
  return requiresRealPaymentProviders() ? "live" : "test";
}

async function emitPaymentIdempotencyMetric(
  operation: string,
  idempotencyResult: "new" | "duplicate" | "conflict" | "in_progress" | "required_missing",
) {
  const metricOperation = toPaymentMetricOperation(operation);
  if (!metricOperation) return;
  await emitPaymentMetricSafely("payment.idempotency.result", {
    operation: metricOperation,
    idempotency_result: idempotencyResult,
    environment: getPaymentMetricEnvironment(),
  });
}

async function emitPaymentAdminOverrideMetric(actionType: AdminActionType) {
  const operation = paymentActionMetricOperation(actionType);
  if (!operation) return;
  await emitPaymentMetricSafely("payment.admin_override", {
    operation,
    environment: getPaymentMetricEnvironment(),
  });
}

async function emitPaymentWebhookDuplicateMetric(provider: "stripe" | "x402", eventType: unknown) {
  await emitPaymentMetricSafely("payment.webhook.duplicate", {
    provider,
    event_type: normalizePaymentMetricEventType(eventType),
    environment: getPaymentMetricEnvironment(),
  });
}

async function emitPaymentWebhookProcessingFailureMetric(
  provider: "stripe" | "x402",
  eventType: unknown,
) {
  await emitPaymentMetricSafely("payment.webhook.processing_failed", {
    provider,
    event_type: normalizePaymentMetricEventType(eventType),
    failure_type: "processing_error",
    environment: getPaymentMetricEnvironment(),
  });
}

function paymentActionMetricOperation(actionType: AdminActionType): PaymentMetricOperation | null {
  switch (actionType) {
    case "payment.authorize":
      return "authorize";
    case "payment.capture":
      return "capture";
    case "payment.cancel":
      return "cancel";
    case "payment.refund":
      return "refund";
    case "payment.fail":
      return "fail";
    case "payment.admin_override":
      return "settlement_pending";
    default:
      return null;
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

type PaymentWebhookProvider = "stripe" | "x402";

function paymentProductionState(intent: PaymentIntent): ProductionPaymentState {
  return intent.production_status ?? mapLegacyPaymentStatusForAudit(intent.status);
}

function isCapturedLikeProductionState(state: ProductionPaymentState): boolean {
  return (
    state === "captured" ||
    state === "partially_refunded" ||
    state === "refunded" ||
    state === "disputed"
  );
}

function settlementWebhookReconciliationReason(intent: PaymentIntent): string | null {
  const productionState = paymentProductionState(intent);
  if (
    intent.status === "SETTLED" &&
    (productionState === "refunded" ||
      productionState === "partially_refunded" ||
      productionState === "disputed")
  ) {
    return "settlement_confirmed_after_reversal_or_dispute";
  }
  if (
    intent.status === "AUTHORIZED" ||
    intent.status === "SETTLEMENT_PENDING" ||
    intent.status === "SETTLED"
  ) {
    return null;
  }
  if (intent.status === "FAILED" || intent.status === "CANCELED") {
    return "settlement_confirmed_after_terminal_state";
  }
  return "settlement_confirmed_before_authorization";
}

function terminalWebhookReconciliationReason(
  intent: PaymentIntent,
  targetAction: "fail" | "expire",
): string | null {
  const productionState = paymentProductionState(intent);
  if (isCapturedLikeProductionState(productionState) || intent.status === "SETTLED") {
    return "terminal_event_after_local_capture";
  }
  if (targetAction === "fail") {
    if (intent.status === "FAILED") {
      return null;
    }
    if (intent.status === "CANCELED") {
      return "failure_event_after_local_cancel";
    }
    return null;
  }
  if (intent.status === "CANCELED") {
    return null;
  }
  if (intent.status === "FAILED") {
    return "expiry_event_after_local_failure";
  }
  if (intent.status === "SETTLEMENT_PENDING") {
    return "expiry_event_after_settlement_started";
  }
  return null;
}

type ManualPaymentMutation =
  | "authorize"
  | "settlement_pending"
  | "capture"
  | "fail"
  | "cancel"
  | "refund";

function getManualPaymentMutationPolicyFailure(
  mutation: ManualPaymentMutation,
  intent: PaymentIntent,
): {
  statusCode: number;
  body: {
    error: string;
    message: string;
    status: PaymentIntent["status"];
    production_status: ProductionPaymentState;
  };
} | null {
  const productionState = paymentProductionState(intent);
  const failure = (error: string, message: string, statusCode = 409) => ({
    statusCode,
    body: {
      error,
      message,
      status: intent.status,
      production_status: productionState,
    },
  });

  switch (mutation) {
    case "authorize":
      return intent.status === "CREATED" || intent.status === "QUOTED"
        ? null
        : failure(
            "PAYMENT_MANUAL_MUTATION_NOT_ALLOWED",
            "Payment authorization is only allowed before authorization starts.",
          );
    case "settlement_pending":
      return intent.status === "AUTHORIZED"
        ? null
        : failure(
            "PAYMENT_MANUAL_MUTATION_NOT_ALLOWED",
            "Payment can only be marked settlement pending after authorization.",
          );
    case "capture":
      if (intent.status === "SETTLED" && productionState === "captured") {
        return null;
      }
      return intent.status === "SETTLEMENT_PENDING"
        ? null
        : failure(
            "PAYMENT_MANUAL_MUTATION_NOT_ALLOWED",
            "Payment capture is only allowed after settlement has started.",
          );
    case "fail":
      if (isCapturedLikeProductionState(productionState) || intent.status === "SETTLED") {
        return failure(
          "PAYMENT_TERMINAL_STATE_PROTECTED",
          "Captured, refunded, or disputed payments cannot be manually failed.",
        );
      }
      return ["CREATED", "QUOTED", "AUTHORIZED", "SETTLEMENT_PENDING"].includes(intent.status)
        ? null
        : failure(
            "PAYMENT_MANUAL_MUTATION_NOT_ALLOWED",
            "Payment failure is only allowed before the payment reaches a terminal state.",
          );
    case "cancel":
      if (isCapturedLikeProductionState(productionState) || intent.status === "SETTLED") {
        return failure(
          "PAYMENT_TERMINAL_STATE_PROTECTED",
          "Captured, refunded, or disputed payments cannot be manually canceled.",
        );
      }
      return ["CREATED", "QUOTED", "AUTHORIZED"].includes(intent.status)
        ? null
        : failure(
            "PAYMENT_MANUAL_MUTATION_NOT_ALLOWED",
            "Payment cancellation is only allowed before settlement starts.",
          );
    case "refund":
      if (intent.status !== "SETTLED") {
        return failure(
          "PAYMENT_REFUND_STATE_INVALID",
          `refund requires SETTLED intent, got ${intent.status}`,
        );
      }
      if (productionState === "refunded") {
        return failure(
          "PAYMENT_REFUND_ALREADY_COMPLETED",
          "Payment has already been fully refunded.",
        );
      }
      if (productionState === "disputed") {
        return failure(
          "PAYMENT_REFUND_DISPUTED",
          "Disputed payments require dispute resolution before manual refund.",
        );
      }
      return productionState === "captured" || productionState === "partially_refunded"
        ? null
        : failure(
            "PAYMENT_REFUND_STATE_INVALID",
            `refund requires captured payment state, got ${productionState}`,
          );
  }
}

function sendManualPaymentMutationPolicyFailure(
  reply: FastifyReply,
  mutation: ManualPaymentMutation,
  intent: PaymentIntent,
): boolean {
  const failure = getManualPaymentMutationPolicyFailure(mutation, intent);
  if (!failure) {
    return false;
  }
  reply.code(failure.statusCode).send(failure.body);
  return true;
}

function isRefundAmountCounted(status: unknown): boolean {
  return status === "REQUESTED" || status === "PENDING" || status === "COMPLETED";
}

async function getRefundAmountPolicyFailure(
  db: Database,
  intent: PaymentIntent,
  refund: Refund,
): Promise<{ statusCode: number; body: Record<string, unknown> } | null> {
  if (refund.amount.currency !== intent.amount.currency) {
    return {
      statusCode: 400,
      body: {
        error: "PAYMENT_REFUND_CURRENCY_MISMATCH",
        message: `refund currency ${refund.amount.currency} does not match payment currency ${intent.amount.currency}`,
      },
    };
  }

  if (refund.amount.amount_minor > intent.amount.amount_minor) {
    return {
      statusCode: 400,
      body: {
        error: "PAYMENT_REFUND_AMOUNT_INVALID",
        message: `refund amount ${refund.amount.amount_minor} exceeds payment amount ${intent.amount.amount_minor}`,
      },
    };
  }

  const existingRefunds = await getRefundRecordsByPaymentIntentId(db, intent.id);
  const existingRefundAmountMinor = existingRefunds.reduce((sum, row) => {
    if (!isRefundAmountCounted(row.status)) {
      return sum;
    }
    if (row.currency !== intent.amount.currency) {
      return sum;
    }
    return sum + Number(row.amountMinor);
  }, 0);
  const refundableRemainingMinor = Math.max(
    intent.amount.amount_minor - existingRefundAmountMinor,
    0,
  );
  const totalAfterRefundMinor = existingRefundAmountMinor + refund.amount.amount_minor;

  if (totalAfterRefundMinor > intent.amount.amount_minor) {
    return {
      statusCode: 409,
      body: {
        error: "PAYMENT_REFUND_AMOUNT_EXCEEDS_REMAINING",
        message: "Refund request exceeds the remaining refundable payment amount.",
        payment_intent_id: intent.id,
        payment_amount_minor: intent.amount.amount_minor,
        existing_refund_amount_minor: existingRefundAmountMinor,
        requested_refund_amount_minor: refund.amount.amount_minor,
        refundable_remaining_minor: refundableRemainingMinor,
      },
    };
  }

  return null;
}

async function markPaymentWebhookReconciliationNeeded(
  db: Database,
  intent: PaymentIntent,
  params: {
    provider: PaymentWebhookProvider;
    providerEventId: string;
    eventType: string;
    reason: string;
  },
): Promise<void> {
  const row = await getPaymentIntentRowById(db, intent.id);
  const existingContext =
    row?.providerContext &&
    typeof row.providerContext === "object" &&
    !Array.isArray(row.providerContext)
      ? row.providerContext
      : {};

  await setPaymentIntentProviderContext(db, intent.id, {
    ...existingContext,
    reconciliation_needed: {
      provider: params.provider,
      provider_event_id: params.providerEventId,
      event_type: params.eventType,
      reason: params.reason,
      local_status: intent.status,
      local_production_status: paymentProductionState(intent),
      recorded_at: new Date().toISOString(),
    },
  });
}

async function sendPaymentWebhookReconciliationRequired(
  db: Database,
  reply: FastifyReply,
  intent: PaymentIntent,
  params: {
    provider: PaymentWebhookProvider;
    providerEventId: string;
    eventType: string;
    reason: string;
  },
) {
  await markPaymentWebhookReconciliationNeeded(db, intent, params);
  return reply.code(409).send({
    accepted: false,
    action: "reconciliation_required",
    reason: params.reason,
    payment_intent_id: intent.id,
    local_status: intent.status,
    local_production_status: paymentProductionState(intent),
    provider: params.provider,
    provider_event_id: params.providerEventId,
    event_type: params.eventType,
  });
}

async function beginPaymentOperationIdempotency(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  operation: string,
  paymentIntentId: string | null,
): Promise<{ key: string | null; requestHash: string; replayed: boolean }> {
  const key = getPaymentIdempotencyKey(request);
  const requestHash = paymentOperationRequestHash(
    operation,
    paymentIntentId,
    request.body,
    request.user?.id,
  );

  if (!key) {
    if (requiresRealPaymentProviders()) {
      await emitPaymentIdempotencyMetric(operation, "required_missing");
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
      await emitPaymentIdempotencyMetric(operation, "new");
      return { key, requestHash, replayed: false };
    }
  }

  const current = existing ?? (await getPaymentOperationIdempotencyRecord(db, operation, key));
  if (!current) {
    const inProgress = paymentIntentId
      ? await getInProgressPaymentOperationForIntent(db, paymentIntentId, key)
      : null;
    if (inProgress) {
      await emitPaymentIdempotencyMetric(operation, "in_progress");
      reply.code(409).send({
        error: "PAYMENT_OPERATION_IN_PROGRESS",
        message: "Another payment operation is already in progress for this payment intent",
        payment_intent_id: paymentIntentId,
        operation,
        blocking_operation: inProgress.operation,
      });
      return { key, requestHash, replayed: true };
    }
    await emitPaymentIdempotencyMetric(operation, "conflict");
    reply.code(409).send({ error: "IDEMPOTENCY_RECORD_CONFLICT" });
    return { key, requestHash, replayed: true };
  }

  if (current.requestHash !== requestHash) {
    await emitPaymentIdempotencyMetric(operation, "conflict");
    reply.code(409).send({
      error: "IDEMPOTENCY_KEY_CONFLICT",
      message: "Idempotency key was already used with a different payment request",
    });
    return { key, requestHash, replayed: true };
  }

  const responseBody = current.responseBody as Record<string, unknown>;
  const inProgress =
    current.responseStatus === 409 && responseBody.error === "PAYMENT_OPERATION_IN_PROGRESS";
  await emitPaymentIdempotencyMetric(operation, inProgress ? "in_progress" : "duplicate");
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
    previousProductionState?: ProductionPaymentState;
    nextProductionState?: ProductionPaymentState;
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
    type:
      actionType === "payment.refund"
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
    previous_state:
      params.previousProductionState ??
      (params.previousStatus ? mapLegacyPaymentStatusForAudit(params.previousStatus) : undefined),
    next_state:
      params.nextProductionState ??
      (params.nextStatus ? mapLegacyPaymentStatusForAudit(params.nextStatus) : undefined),
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
  if (actor.role === "admin" && requiresRealPaymentProviders()) {
    await emitPaymentAdminOverrideMetric(actionType);
  }
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
  if (actionType === "payment.webhook_received") {
    await emitPaymentMetricSafely("payment.webhook.received", {
      provider: params.provider,
      event_type: normalizePaymentMetricEventType(params.metadata?.event_type),
      environment: getPaymentMetricEnvironment(),
    });
  } else {
    await emitPaymentMetricSafely("payment.webhook.rejected", {
      provider: params.provider,
      failure_type: normalizePaymentMetricFailureType(params.reason),
      environment: getPaymentMetricEnvironment(),
    });
  }
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
    {
      key: "settlement_asset",
      label: "Settlement asset",
      type: "text",
      value: "USDC",
      required: true,
    },
    {
      key: "settlement_network",
      label: "Settlement network",
      type: "text",
      value: "base",
      required: true,
    },
    {
      key: "settlement_contract",
      label: "Settlement contract",
      type: "text",
      value: "HaggleConditionalSettlement",
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
      options: [...FULFILLMENT_TYPE_OPTIONS],
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
  return sha256Hex(
    canonicalJson({
      version: "haggle.settlement_agreement.v1",
      approval_id: approval.id,
      terms: approval.terms,
      seller_policy: approval.seller_policy,
      settlement: {
        asset: "USDC",
        network: "base",
        contract: "HaggleConditionalSettlement",
        release_policy: "signed_policy_bound_release_or_refund",
      },
    }),
  );
}

function buildListingHash(listingId: string): string {
  return sha256Hex(canonicalJson({ version: "haggle.listing_ref.v1", listing_id: listingId }));
}

function resolvePaymentReceiver(
  sellerWallet: string,
  config: ReturnType<typeof getX402EnvConfig>,
): {
  paymentReceiver: string;
  receiverRole: "seller_wallet" | "payment_receiver" | "conditional_settlement_receiver";
} {
  if (config.paymentReceiverAddress) {
    if (
      config.conditionalSettlementAddress &&
      config.paymentReceiverAddress.toLowerCase() ===
        config.conditionalSettlementAddress.toLowerCase()
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

function validateX402PolicyBinding(
  payload: X402PaymentPayloadEnvelope,
  intent: PaymentIntent,
): string | null {
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
  const expectedSettlementAmount = String(
    toSettlementAssetMoney(intent.amount, "USDC").amount_minor,
  );
  if (
    extra.settlement_amount_minor !== undefined &&
    String(extra.settlement_amount_minor) !== expectedSettlementAmount
  ) {
    return "settlement_amount_minor mismatch";
  }
  return null;
}

function serializeConditionalSettlementMessage(message: ConditionalSettlementMessage) {
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

function serializeConditionalRefundMessage(message: ConditionalRefundMessage) {
  return {
    settlementId: message.settlementId,
    deadline: message.deadline.toString(),
    signerNonce: message.signerNonce.toString(),
  };
}

function computeConditionalSettlementId(
  message: ConditionalSettlementMessage,
  chainId: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
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
    ),
  );
}

function toOnchainLookupHash(value: string): Hex {
  return keccak256(stringToHex(value));
}

function toOnchainPolicyHash(value: string): Hex {
  const normalized = value.startsWith("sha256:") ? `0x${value.slice("sha256:".length)}` : value;
  if (/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    return normalized.toLowerCase() as Hex;
  }
  return toOnchainLookupHash(value).toLowerCase() as Hex;
}

function normalizeHex(value: unknown): string | null {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function normalizeAddress(value: unknown): string | null {
  return typeof value === "string" && isAddress(value) ? value.toLowerCase() : null;
}

function buildConditionalSettlementChainLookup(
  intent: PaymentIntent,
  settlementId: string | undefined,
  chainId: number,
) {
  return {
    order_id_hash: toOnchainLookupHash(intent.order_id),
    payment_intent_id_hash: toOnchainLookupHash(intent.id),
    settlement_id: settlementId,
    chain_id: chainId,
  };
}

function validateConditionalSettlementFundingReceipt(
  receipt: { logs?: Array<{ address?: string; topics?: readonly Hex[]; data?: Hex }> },
  intent: PaymentIntent,
  providerContext: Record<string, unknown>,
  conditionalContext: Record<string, unknown>,
  x402Config: ReturnType<typeof getX402EnvConfig>,
):
  | { ok: true; settlementId: string; event: Record<string, unknown> }
  | { ok: false; message: string } {
  const contractAddress = normalizeAddress(x402Config.conditionalSettlementAddress);
  if (!contractAddress) {
    return { ok: false, message: "conditional settlement contract address is not configured" };
  }
  if (!isAddress(x402Config.assetAddress)) {
    return { ok: false, message: "USDC asset address is not an ERC-20 contract address" };
  }

  const expectedSettlementId = normalizeHex(conditionalContext.settlement_id);
  const expectedOrderId = toOnchainPolicyHash(intent.order_id);
  const expectedPaymentIntentId = toOnchainPolicyHash(intent.id);
  const expectedApprovalPolicyHash = intent.approval_policy_hash
    ? toOnchainPolicyHash(intent.approval_policy_hash)
    : null;
  const stripeOnramp = getStripeOnrampContext(providerContext);
  const expectedBuyer =
    normalizeAddress(conditionalContext.buyer_wallet) ??
    normalizeAddress(stripeOnramp.destination_wallet);
  const expectedSeller =
    normalizeAddress(conditionalContext.seller_wallet) ??
    normalizeAddress(providerContext.seller_wallet) ??
    normalizeAddress(process.env.HAGGLE_X402_SELLER_WALLET);
  const expectedAsset = normalizeAddress(x402Config.assetAddress);
  const expectedGrossAmount = BigInt(toSettlementAssetMoney(intent.amount, "USDC").amount_minor);

  for (const log of receipt.logs ?? []) {
    if (normalizeAddress(log.address) !== contractAddress) continue;
    if (!log.topics || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
        data: log.data ?? "0x",
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "SettlementFunded") continue;
      const args = decoded.args as Record<string, unknown>;
      const settlementId = normalizeHex(args.settlementId);
      if (!settlementId) continue;
      if (expectedSettlementId && settlementId !== expectedSettlementId) continue;
      if (normalizeHex(args.orderId) !== expectedOrderId) continue;
      if (normalizeHex(args.paymentIntentId) !== expectedPaymentIntentId) continue;
      if (
        expectedApprovalPolicyHash &&
        normalizeHex(args.approvalPolicyHash) !== expectedApprovalPolicyHash
      )
        continue;
      if (expectedBuyer && normalizeAddress(args.buyer) !== expectedBuyer) continue;
      if (expectedSeller && normalizeAddress(args.seller) !== expectedSeller) continue;
      if (normalizeAddress(args.asset) !== expectedAsset) continue;
      if (BigInt(String(args.grossAmount)) !== expectedGrossAmount) continue;

      return {
        ok: true,
        settlementId,
        event: {
          settlement_id: settlementId,
          order_id_hash: normalizeHex(args.orderId),
          payment_intent_id_hash: normalizeHex(args.paymentIntentId),
          approval_policy_hash: normalizeHex(args.approvalPolicyHash),
          buyer_wallet: normalizeAddress(args.buyer),
          seller_wallet: normalizeAddress(args.seller),
          asset: normalizeAddress(args.asset),
          gross_amount_minor: expectedGrossAmount.toString(),
        },
      };
    } catch {}
  }

  return { ok: false, message: "receipt does not contain a matching SettlementFunded event" };
}

function validateConditionalSettlementRefundReceipt(
  receipt: { logs?: Array<{ address?: string; topics?: readonly Hex[]; data?: Hex }> },
  intent: PaymentIntent,
  providerContext: Record<string, unknown>,
  conditionalContext: Record<string, unknown>,
  x402Config: ReturnType<typeof getX402EnvConfig>,
): { ok: true; event: Record<string, unknown> } | { ok: false; message: string } {
  const contractAddress = normalizeAddress(x402Config.conditionalSettlementAddress);
  if (!contractAddress) {
    return { ok: false, message: "conditional settlement contract address is not configured" };
  }

  const expectedSettlementId = normalizeHex(conditionalContext.settlement_id);
  if (!expectedSettlementId) {
    return { ok: false, message: "conditional settlement id is not recorded" };
  }
  const stripeOnramp = getStripeOnrampContext(providerContext);
  const expectedBuyer =
    normalizeAddress(conditionalContext.buyer_wallet) ??
    normalizeAddress(stripeOnramp.destination_wallet);
  const expectedAmount = BigInt(toSettlementAssetMoney(intent.amount, "USDC").amount_minor);

  for (const log of receipt.logs ?? []) {
    if (normalizeAddress(log.address) !== contractAddress) continue;
    if (!log.topics || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
        data: log.data ?? "0x",
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "SettlementRefunded") continue;
      const args = decoded.args as Record<string, unknown>;
      if (normalizeHex(args.settlementId) !== expectedSettlementId) continue;
      if (expectedBuyer && normalizeAddress(args.buyer) !== expectedBuyer) continue;
      if (BigInt(String(args.amount)) !== expectedAmount) continue;

      return {
        ok: true,
        event: {
          settlement_id: expectedSettlementId,
          refund_buyer_wallet: normalizeAddress(args.buyer),
          refund_amount_minor: expectedAmount.toString(),
        },
      };
    } catch {}
  }

  return { ok: false, message: "receipt does not contain a matching SettlementRefunded event" };
}

function validateConditionalSettlementDisputeReceipt(
  receipt: { logs?: Array<{ address?: string; topics?: readonly Hex[]; data?: Hex }> },
  conditionalContext: Record<string, unknown>,
  x402Config: ReturnType<typeof getX402EnvConfig>,
  expectedEvidenceHash?: string,
): { ok: true; event: Record<string, unknown> } | { ok: false; message: string } {
  const contractAddress = normalizeAddress(x402Config.conditionalSettlementAddress);
  if (!contractAddress) {
    return { ok: false, message: "conditional settlement contract address is not configured" };
  }

  const expectedSettlementId = normalizeHex(conditionalContext.settlement_id);
  if (!expectedSettlementId) {
    return { ok: false, message: "conditional settlement id is not recorded" };
  }

  for (const log of receipt.logs ?? []) {
    if (normalizeAddress(log.address) !== contractAddress) continue;
    if (!log.topics || log.topics.length === 0) continue;
    try {
      const decoded = decodeEventLog({
        abi: HAGGLE_CONDITIONAL_SETTLEMENT_ABI,
        data: log.data ?? "0x",
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "SettlementDisputed") continue;
      const args = decoded.args as Record<string, unknown>;
      if (normalizeHex(args.settlementId) !== expectedSettlementId) continue;
      const evidenceHash = normalizeHex(args.evidenceHash);
      if (expectedEvidenceHash && evidenceHash !== expectedEvidenceHash.toLowerCase()) continue;

      return {
        ok: true,
        event: {
          settlement_id: expectedSettlementId,
          dispute_evidence_hash: evidenceHash,
        },
      };
    } catch {}
  }

  return { ok: false, message: "receipt does not contain a matching SettlementDisputed event" };
}

function parseUnixSeconds(value: number | string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  return BigInt(value);
}

function resolveX402ChainId(config: ReturnType<typeof getX402EnvConfig>): number {
  if (
    process.env.HAGGLE_X402_NETWORK === "base-sepolia" ||
    config.network === "base-sepolia" ||
    config.network === "eip155:84532"
  ) {
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
  return providerContext.conditional_settlement &&
    typeof providerContext.conditional_settlement === "object" &&
    !Array.isArray(providerContext.conditional_settlement)
    ? (providerContext.conditional_settlement as Record<string, unknown>)
    : {};
}

function getStripeOnrampContext(providerContext: Record<string, unknown>) {
  return providerContext.stripe_onramp &&
    typeof providerContext.stripe_onramp === "object" &&
    !Array.isArray(providerContext.stripe_onramp)
    ? (providerContext.stripe_onramp as Record<string, unknown>)
    : {};
}

type ConditionalSettlementFundingEligibility =
  | { ok: true; source: "x402" | "stripe_onramp"; stripeOnramp?: Record<string, unknown> }
  | { ok: false; statusCode: number; error: string; message?: string };

function assertConditionalSettlementFundingEligibility(
  intent: PaymentIntent,
  providerContext: Record<string, unknown>,
): ConditionalSettlementFundingEligibility {
  const stripeOnramp = getStripeOnrampContext(providerContext);
  const stripeOnrampStatus = typeof stripeOnramp.status === "string" ? stripeOnramp.status : null;

  if (intent.selected_rail === "x402" && !stripeOnrampStatus) {
    return { ok: true, source: "x402" };
  }
  if (intent.selected_rail !== "x402" && intent.selected_rail !== "stripe") {
    return { ok: false, statusCode: 400, error: "PAYMENT_RAIL_NOT_SUPPORTED" };
  }

  if (stripeOnramp.status === "ONRAMP_FUNDED_RECONCILIATION_REQUIRED") {
    return {
      ok: false,
      statusCode: 409,
      error: "ONRAMP_RECONCILIATION_REQUIRED",
      message:
        "Stripe onramp funding requires manual reconciliation before conditional settlement funding",
    };
  }
  if (stripeOnramp.status !== "ONRAMP_FUNDED") {
    return {
      ok: false,
      statusCode: 409,
      error: "STRIPE_ONRAMP_NOT_FUNDED",
      message: "Stripe onramp must fund the buyer wallet before conditional settlement funding",
    };
  }

  return { ok: true, source: "stripe_onramp", stripeOnramp };
}

function normalizeBaseSettlementNetwork(value: unknown): "base" | "base-sepolia" | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  if (normalized === "base" || normalized === "eip155:8453") return "base";
  if (normalized === "base-sepolia" || normalized === "eip155:84532") return "base-sepolia";
  return null;
}

function validateStripeOnrampContractFundingPreconditions(
  intent: PaymentIntent,
  stripeOnramp: Record<string, unknown>,
  buyerWalletAddress: string,
  x402Config: ReturnType<typeof getX402EnvConfig>,
): ConditionalSettlementFundingEligibility {
  const onrampWallet = normalizeAddress(stripeOnramp.destination_wallet);
  if (!onrampWallet) {
    return {
      ok: false,
      statusCode: 409,
      error: "ONRAMP_RECONCILIATION_REQUIRED",
      message: "Stripe onramp destination wallet is missing",
    };
  }
  if (onrampWallet !== buyerWalletAddress.toLowerCase()) {
    return {
      ok: false,
      statusCode: 409,
      error: "STRIPE_ONRAMP_WALLET_MISMATCH",
      message: "Stripe onramp destination wallet must match the buyer wallet funding the contract",
    };
  }

  const expectedNetwork = normalizeBaseSettlementNetwork(x402Config.network);
  const actualNetwork = normalizeBaseSettlementNetwork(stripeOnramp.destination_network);
  if (!actualNetwork) {
    return {
      ok: false,
      statusCode: 409,
      error: "ONRAMP_RECONCILIATION_REQUIRED",
      message: "Stripe onramp destination network is missing",
    };
  }
  if (expectedNetwork && actualNetwork !== expectedNetwork) {
    return {
      ok: false,
      statusCode: 409,
      error: "STRIPE_ONRAMP_NETWORK_MISMATCH",
      message: "Stripe onramp destination network must match the conditional settlement network",
    };
  }

  const currency =
    typeof stripeOnramp.destination_currency === "string"
      ? stripeOnramp.destination_currency.toLowerCase()
      : null;
  if (currency !== "usdc") {
    return {
      ok: false,
      statusCode: 409,
      error: currency ? "STRIPE_ONRAMP_CURRENCY_MISMATCH" : "ONRAMP_RECONCILIATION_REQUIRED",
      message: "Stripe onramp destination currency must be USDC",
    };
  }

  const rawAmountMinor = stripeOnramp.destination_amount_minor;
  if (typeof rawAmountMinor !== "string" && typeof rawAmountMinor !== "number") {
    return {
      ok: false,
      statusCode: 409,
      error: "ONRAMP_RECONCILIATION_REQUIRED",
      message: "Stripe onramp destination amount is missing",
    };
  }
  const expectedAmountMinor = BigInt(toSettlementAssetMoney(intent.amount, "USDC").amount_minor);
  let actualAmountMinor: bigint;
  try {
    actualAmountMinor = BigInt(String(rawAmountMinor));
  } catch {
    return {
      ok: false,
      statusCode: 409,
      error: "ONRAMP_RECONCILIATION_REQUIRED",
      message: "Stripe onramp destination amount is invalid",
    };
  }
  if (actualAmountMinor < expectedAmountMinor) {
    return {
      ok: false,
      statusCode: 409,
      error: "STRIPE_ONRAMP_AMOUNT_TOO_LOW",
      message: "Stripe onramp funded amount is below the conditional settlement amount",
    };
  }

  return { ok: true, source: "stripe_onramp", stripeOnramp };
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
  _provider: "x402",
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
  const configured =
    provider === "stripe" ? process.env.STRIPE_WEBHOOK_ENV : process.env.HAGGLE_X402_WEBHOOK_ENV;
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

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function resolveOrderFulfillmentType(
  order: Awaited<ReturnType<typeof getCommerceOrderByOrderId>>,
): FulfillmentType {
  const snapshot = getRecord(order?.orderSnapshot);
  const terms = getRecord(snapshot?.terms);
  return normalizeFulfillmentType(terms?.fulfillment_type);
}

function stagingPhysicalShippingReadinessFailure() {
  if (process.env.HAGGLE_ENV?.trim().toLowerCase() !== "staging") return null;
  const readiness = physicalShippingReadiness();
  return readiness.ready ? null : readiness;
}

function paymentIntentProviderContext(row: Awaited<ReturnType<typeof getPaymentIntentRowById>>) {
  return getRecord(row?.providerContext) ?? {};
}

async function inspectExistingIntentShippingMode(
  db: Database,
  intent: PaymentIntent,
  requestedMode: ShippingExecutionMode | undefined,
) {
  const row = await getPaymentIntentRowById(db, intent.id);
  const providerContext = paymentIntentProviderContext(row);
  const persistedMode = providerContext.shipping_execution_mode;
  const hasPersistedMode =
    persistedMode === "integration_manual" || persistedMode === "physical_live";

  if (!hasPersistedMode && requestedMode) {
    const shipment = await getShipmentByOrderId(db, intent.order_id);
    if ((intent.status === "CREATED" || intent.status === "QUOTED") && !shipment) {
      const locked = await lockPaymentIntentShippingModeIfUnset(
        db,
        intent.id,
        metadataForShippingExecutionMode(requestedMode),
      );
      if (locked) {
        return { currentMode: requestedMode, conflict: null };
      }

      const refreshedRow = await getPaymentIntentRowById(db, intent.id);
      const refreshedContext = paymentIntentProviderContext(refreshedRow);
      const refreshedMode = refreshedContext.shipping_execution_mode;
      if (refreshedMode === requestedMode) {
        return { currentMode: requestedMode, conflict: null };
      }
      if (refreshedMode === "integration_manual" || refreshedMode === "physical_live") {
        return {
          currentMode: refreshedMode,
          conflict: {
            error: "PAYMENT_SHIPPING_EXECUTION_MODE_CONFLICT",
            message: "Shipping execution mode was already selected for this payment",
            current_mode: refreshedMode,
            requested_mode: requestedMode,
          },
        };
      }
    }

    return {
      currentMode: readShippingExecutionMode(providerContext),
      conflict: {
        error: "PAYMENT_SHIPPING_EXECUTION_MODE_CONFLICT",
        message:
          "This payment progressed before its shipping mode was recorded. Start a new order to use the selected shipping mode.",
        current_mode: null,
        requested_mode: requestedMode,
      },
    };
  }

  const currentMode = readShippingExecutionMode(providerContext);
  return {
    currentMode,
    conflict:
      requestedMode && currentMode !== requestedMode
        ? {
            error: "PAYMENT_SHIPPING_EXECUTION_MODE_CONFLICT",
            message: "Shipping execution mode cannot change after payment preparation",
            current_mode: currentMode,
            requested_mode: requestedMode,
          }
        : null,
  };
}

/**
 * Auto-create a SettlementRelease when a payment reaches SETTLED.
 * Calculates weight buffer from a default parcel weight (can be overridden
 * when actual shipment weight is known).
 */
async function ensureSettlementReleaseForPayment(
  db: Database,
  intent: PaymentIntent,
  options?: { fulfillmentType?: FulfillmentType; declaredWeightOz?: number },
) {
  const existing = await getSettlementReleaseByOrderId(db, intent.order_id);
  if (existing) {
    return existing;
  }

  const fulfillmentType = normalizeFulfillmentType(options?.fulfillmentType);
  // No-shipping: product = full amount, buffer = 0, buffer RELEASED immediately.
  if (isNoShippingFulfillment(fulfillmentType)) {
    const release = createSettlementRelease({
      payment_intent_id: intent.id,
      order_id: intent.order_id,
      product_amount: {
        currency: intent.amount.currency,
        amount_minor: intent.amount.amount_minor,
      },
      buffer_amount: {
        currency: intent.amount.currency,
        amount_minor: 0,
      },
    });
    return await createSettlementReleaseRecord(db, release);
  }

  const weightOz = options?.declaredWeightOz ?? 16; // default 1lb if unknown
  const buffer = computeWeightBuffer(weightOz);
  const bufferMinor = Math.min(buffer.buffer_amount_minor, intent.amount.amount_minor);

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
  const intentRow = await getPaymentIntentRowById(db, intent.id);
  const executionMode = readShippingExecutionMode(paymentIntentProviderContext(intentRow));
  const shipment = await createShipmentRecord(
    db,
    intent.order_id,
    intent.seller_id,
    intent.buyer_id,
    undefined,
    {
      metadata: metadataForShippingExecutionMode(executionMode, {
        shipping_execution_mode_source: "payment_checkout",
        shipping_execution_mode_payment_locked: true,
      }),
    },
  );
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
  const order = await getCommerceOrderByOrderId(db, intent.order_id);
  const fulfillmentType = resolveOrderFulfillmentType(order);
  const requiresShipment = requiresShipmentForFulfillment(fulfillmentType);
  const settlementRelease = await ensureSettlementReleaseForPayment(db, intent, {
    fulfillmentType,
  });

  if (order?.listingId) {
    await confirmListingFunded(db, {
      listingId: order.listingId,
      buyerId: intent.buyer_id,
      sessionId: order.settlementApprovalId,
      paymentIntentId: intent.id,
    });
  }
  const orderStatus = order?.status;
  const canAdvanceToFulfillment =
    !orderStatus ||
    orderStatus === "APPROVED" ||
    orderStatus === "PAYMENT_PENDING" ||
    orderStatus === "PAID";

  if (!orderStatus || orderStatus === "APPROVED" || orderStatus === "PAYMENT_PENDING") {
    await updateCommerceOrderStatus(db, intent.order_id, "PAID");
  }

  let shipmentResult: {
    shipment: Awaited<ReturnType<typeof ensureShipmentForPayment>>["shipment"] | null;
    created: boolean;
  } = { shipment: null, created: false };
  let fulfillmentRecord: FulfillmentRecord | null = null;
  let fulfillmentRecordCreated = false;

  if (requiresShipment) {
    shipmentResult = await ensureShipmentForPayment(db, intent);
  } else {
    const ensured = await ensureFulfillmentRecordForOrder(db, {
      order_id: intent.order_id,
      payment_intent_id: intent.id,
      fulfillment_type: fulfillmentType,
      metadata: {
        source: "payment_settlement",
        requires_shipment: false,
      },
    });
    fulfillmentRecord = ensured.fulfillment;
    fulfillmentRecordCreated = ensured.created;
  }

  if (canAdvanceToFulfillment) {
    await updateCommerceOrderStatus(db, intent.order_id, "FULFILLMENT_PENDING");
  }

  return {
    settlementRelease,
    fulfillment: {
      type: fulfillmentType,
      requires_shipment: requiresShipment,
      record: fulfillmentRecord,
      record_created: fulfillmentRecordCreated,
    },
    shipment: shipmentResult.shipment,
    shipmentCreated: shipmentResult.created,
  };
}

async function finalizeSettledPayment(db: Database, intent: PaymentIntent) {
  return prepareFulfillmentForSecuredPayment(db, intent);
}

function sendListingClaimError(reply: FastifyReply, error: unknown): boolean {
  if (!(error instanceof ListingClaimError)) return false;
  const mapped = LISTING_CLAIM_HTTP[error.code];
  void reply.code(mapped.status).send({
    error: mapped.error,
    message: error.code,
  });
  return true;
}

async function resolveListingClaimContext(db: Database, intent: PaymentIntent) {
  const order = await getCommerceOrderByOrderId(db, intent.order_id);
  const row = await getPaymentIntentRowById(db, intent.id);
  const providerContext =
    row?.providerContext &&
    typeof row.providerContext === "object" &&
    !Array.isArray(row.providerContext)
      ? row.providerContext
      : {};
  const listingId =
    order?.listingId ??
    (typeof providerContext.listing_id === "string" ? providerContext.listing_id : null);
  const settlementApprovalId =
    order?.settlementApprovalId ??
    (typeof providerContext.settlement_approval_id === "string"
      ? providerContext.settlement_approval_id
      : null);
  return {
    listingId,
    sellerId: intent.seller_id,
    sessionId: settlementApprovalId,
    settlementApprovalId,
  };
}

async function claimListingForFunding(db: Database, intent: PaymentIntent): Promise<void> {
  const claim = await resolveListingClaimContext(db, intent);
  if (!claim.listingId || !claim.settlementApprovalId) {
    throw new ListingClaimError("LISTING_NOT_HELD");
  }
  await beginListingFunding(db, {
    listingId: claim.listingId,
    buyerId: intent.buyer_id,
    sellerId: claim.sellerId,
    sessionId: claim.sessionId ?? claim.settlementApprovalId,
    settlementApprovalId: claim.settlementApprovalId,
    paymentIntentId: intent.id,
    amountMinor: intent.amount.amount_minor,
  });
}

async function releaseListingFundingForIntent(db: Database, intent: PaymentIntent): Promise<void> {
  const claim = await resolveListingClaimContext(db, intent);
  if (!claim.listingId) return;
  await releaseListingFunding(db, {
    listingId: claim.listingId,
    buyerId: intent.buyer_id,
  });
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
    typeof depositMeta.stripe_payment_intent_id === "string" &&
    stripeSessionId &&
    depositMeta.stripe_payment_intent_id !== stripeSessionId
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
      ? new X402FacilitatorClient(
          x402Config.facilitatorUrl,
          x402Config.apiKeyId,
          x402Config.apiKeySecret,
        )
      : null;

  // ─── GET payment by ID ──────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    "/payments/:id",
    { preHandler: [requireAuth, requirePaymentOwner()] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, request.params.id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_NOT_FOUND" });
      }
      return reply.send({ payment: intent });
    },
  );

  app.post("/payments/prepare", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = preparePaymentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_PAYMENT_PREPARE_REQUEST", issues: parsed.error.issues });
    }
    if (parsed.data.settlement_approval && !parsed.data.settlement_approval_id) {
      return reply.code(403).send({
        error: "INLINE_SETTLEMENT_APPROVAL_DISABLED",
        message: "Use a stored settlement_approval_id for payment preparation",
      });
    }
    if (requiresRealPaymentProviders() && !parsed.data.payment_disclosure_ack) {
      return reply.code(400).send({
        error: "PAYMENT_DISCLOSURE_ACK_REQUIRED",
        message:
          "Production payments require an explicit buyer acknowledgement for payment authorization terms",
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

    try {
      await assertListingPayableForPrepare(
        db,
        ready.listing_id,
        ready.buyer_id,
        settlementApproval.terms.final_amount_minor,
      );
    } catch (error) {
      if (sendListingClaimError(reply, error)) return;
      throw error;
    }

    const fulfillmentType = normalizeFulfillmentType(settlementApproval.terms.fulfillment_type);
    const requiresShipment = requiresShipmentForFulfillment(fulfillmentType);
    if (parsed.data.shipping_execution_mode && !requiresShipment) {
      return reply.code(400).send({
        error: "SHIPPING_EXECUTION_MODE_NOT_APPLICABLE",
        message: "Shipping execution mode is only valid for a shipped order",
      });
    }
    const shippingExecutionMode = requiresShipment
      ? (parsed.data.shipping_execution_mode ?? defaultShippingExecutionMode())
      : undefined;
    if (shippingExecutionMode === "physical_live") {
      const readiness = stagingPhysicalShippingReadinessFailure();
      if (readiness) {
        return reply.code(503).send({
          error: "PHYSICAL_SHIPPING_REHEARSAL_NOT_READY",
          readiness,
        });
      }
    }

    const idempotency = await beginPaymentOperationIdempotency(
      db,
      request,
      reply,
      "payment.prepare",
      null,
    );
    if (idempotency.replayed) return;

    const order = await ensureCommerceOrderForApproval(db, settlementApproval);

    const existingIntent = await getActivePaymentIntentByOrderId(db, order.id);
    if (existingIntent) {
      const existingMode = await inspectExistingIntentShippingMode(
        db,
        existingIntent,
        parsed.data.shipping_execution_mode,
      );
      if (existingMode.conflict) {
        await recordPaymentOperationIdempotency(
          db,
          "payment.prepare",
          idempotency,
          existingIntent.id,
          409,
          existingMode.conflict,
        );
        return reply.code(409).send(existingMode.conflict);
      }
      const responseBody = {
        intent: existingIntent,
        order,
        participants: {
          buyer_id: ready.buyer_id,
          seller_id: ready.seller_id,
        },
        settlement_context: ready,
        shipping_execution_mode: requiresShipment ? existingMode.currentMode : undefined,
        idempotent: true,
      };
      await recordPaymentOperationIdempotency(
        db,
        "payment.prepare",
        idempotency,
        existingIntent.id,
        200,
        responseBody as unknown as Record<string, unknown>,
      );
      return reply.send(responseBody);
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
      const responseBody = { error: "AGENT_PAYMENT_GRANT_NOT_CREATED" };
      await recordPaymentOperationIdempotency(
        db,
        "payment.prepare",
        idempotency,
        null,
        500,
        responseBody,
      );
      return reply.code(500).send(responseBody);
    }

    const intent = service.createIntent({
      order_id: order.id,
      seller_id: ready.seller_id,
      buyer_id: ready.buyer_id,
      selected_rail: ready.selected_rail,
      buyer_authorization_mode: parsed.data.buyer_authorization_mode as
        | BuyerAuthorizationMode
        | undefined,
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
        ...(shippingExecutionMode ? metadataForShippingExecutionMode(shippingExecutionMode) : {}),
      });
    } catch (error) {
      if (!isActivePaymentIntentUniqueViolation(error)) throw error;
      const concurrentIntent = await getActivePaymentIntentByOrderId(db, order.id);
      if (!concurrentIntent) throw error;
      const existingMode = await inspectExistingIntentShippingMode(
        db,
        concurrentIntent,
        parsed.data.shipping_execution_mode,
      );
      if (existingMode.conflict) {
        await recordPaymentOperationIdempotency(
          db,
          "payment.prepare",
          idempotency,
          concurrentIntent.id,
          409,
          existingMode.conflict,
        );
        return reply.code(409).send(existingMode.conflict);
      }
      const responseBody = {
        intent: concurrentIntent,
        order,
        participants: {
          buyer_id: ready.buyer_id,
          seller_id: ready.seller_id,
        },
        settlement_context: ready,
        shipping_execution_mode: requiresShipment ? existingMode.currentMode : undefined,
        idempotent: true,
      };
      await recordPaymentOperationIdempotency(
        db,
        "payment.prepare",
        idempotency,
        concurrentIntent.id,
        200,
        responseBody as unknown as Record<string, unknown>,
      );
      return reply.send(responseBody);
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
          stablecoin_not_investment: Boolean(
            parsed.data.payment_disclosure_ack.stablecoin_not_investment,
          ),
        },
      });
    }

    const responseBody = {
      intent: storedIntent,
      order,
      participants: {
        buyer_id: ready.buyer_id,
        seller_id: ready.seller_id,
      },
      settlement_context: ready,
      shipping_execution_mode: shippingExecutionMode,
      agent_payment_grant: storedGrant,
    };
    await recordPaymentOperationIdempotency(
      db,
      "payment.prepare",
      idempotency,
      storedIntent.id,
      201,
      responseBody as unknown as Record<string, unknown>,
    );
    return reply.code(201).send(responseBody);
  });

  app.post(
    "/payments/:id/quote",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
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
        const existingMetadata = isRecord(row?.providerContext) ? row.providerContext : {};
        let quoteConfirmation;
        try {
          quoteConfirmation =
            getStoredQuoteConfirmation(existingMetadata) ??
            buildPaymentQuoteConfirmation(intent, existingMetadata);
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

      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.quote",
        intent.id,
      );
      if (idempotency.replayed) return;

      // Resolve seller wallet: DB first, fall back to ENV
      let sellerWalletAddress: string | null = null;
      if (intent.selected_rail === "x402" || intent.selected_rail === "stripe") {
        const networkName = x402Config.network.startsWith("eip155:")
          ? "base"
          : (x402Config.network as string);
        const dbSellerWallet = await db
          .select({ walletAddress: userWallets.walletAddress })
          .from(userWallets)
          .where(
            and(eq(userWallets.userId, intent.seller_id), eq(userWallets.network, networkName)),
          )
          .limit(1)
          .then((rows) => rows[0]?.walletAddress ?? null);

        sellerWalletAddress = dbSellerWallet ?? process.env.HAGGLE_X402_SELLER_WALLET ?? null;
      }

      try {
        const row = await getPaymentIntentRowById(db, intent.id);
        const existingMetadata = isRecord(row?.providerContext) ? row.providerContext : {};
        const result = await service.quoteIntent(intent);
        // Merge seller_wallet into metadata so x402 requirements can resolve it
        const metadataWithoutConfirmation = {
          ...existingMetadata,
          ...(result.metadata ?? {}),
          ...(sellerWalletAddress ? { seller_wallet: sellerWalletAddress } : {}),
          ...(intent.agent_payment_grant_id
            ? { agent_payment_grant_id: intent.agent_payment_grant_id }
            : {}),
          ...(intent.approval_policy_hash
            ? { approval_policy_hash: intent.approval_policy_hash }
            : {}),
          ...(intent.agreement_hash ? { agreement_hash: intent.agreement_hash } : {}),
          ...(intent.listing_hash ? { listing_hash: intent.listing_hash } : {}),
        };
        const quoteConfirmation = buildPaymentQuoteConfirmation(
          result.intent,
          metadataWithoutConfirmation,
          result.value,
        );
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
        const responseBody = { ...result, metadata, quote_confirmation: quoteConfirmation };
        await recordPaymentOperationIdempotency(
          db,
          "payment.quote",
          idempotency,
          intent.id,
          200,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.send(responseBody);
      } catch (error) {
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.quote",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.get(
    "/payments/:id/x402/requirements",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
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
    },
  );

  app.post(
    "/payments/:id/x402/conditional-settlement-request",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const fundingEligibility = assertConditionalSettlementFundingEligibility(
        intent,
        providerContext,
      );
      if (!fundingEligibility.ok) {
        return reply.code(fundingEligibility.statusCode).send({
          error: fundingEligibility.error,
          message: fundingEligibility.message,
        });
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
          message:
            "HAGGLE_X402_USDC_ASSET_ADDRESS must be an ERC-20 contract address for conditional settlement",
        });
      }
      if (
        !intent.agent_payment_grant_id ||
        !intent.approval_policy_hash ||
        !intent.agreement_hash ||
        !intent.listing_hash
      ) {
        return reply.code(400).send({
          error: "PAYMENT_POLICY_BINDING_REQUIRED",
          message:
            "conditional settlement requires grant_id, approval_policy_hash, agreement_hash, and listing_hash",
        });
      }

      const parsed = conditionalSettlementRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_SETTLEMENT_REQUEST", issues: parsed.error.issues });
      }

      const grant = await getAgentPaymentGrantById(db, intent.agent_payment_grant_id);
      if (!grant) {
        return reply.code(404).send({ error: "AGENT_PAYMENT_GRANT_NOT_FOUND" });
      }
      if (grant.status !== "ACTIVE") {
        return reply
          .code(400)
          .send({ error: "AGENT_PAYMENT_GRANT_NOT_ACTIVE", status: grant.status });
      }
      if (
        grant.buyer_id !== intent.buyer_id ||
        grant.seller_id !== intent.seller_id ||
        grant.order_id !== intent.order_id
      ) {
        return reply.code(400).send({ error: "AGENT_PAYMENT_GRANT_INTENT_MISMATCH" });
      }
      if (grant.approval_policy_hash !== intent.approval_policy_hash) {
        return reply.code(400).send({ error: "AGENT_PAYMENT_GRANT_POLICY_HASH_MISMATCH" });
      }

      const networkName = x402Config.network.startsWith("eip155:")
        ? "base"
        : (x402Config.network as string);
      const buyerWalletAddress =
        parsed.data.buyer_wallet_address ??
        (await db
          .select({ walletAddress: userWallets.walletAddress })
          .from(userWallets)
          .where(and(eq(userWallets.userId, intent.buyer_id), eq(userWallets.network, networkName)))
          .limit(1)
          .then((rows) => rows[0]?.walletAddress ?? null));

      if (!buyerWalletAddress || !isAddress(buyerWalletAddress)) {
        return reply.code(400).send({ error: "BUYER_WALLET_NOT_RESOLVED" });
      }

      if (fundingEligibility.source === "stripe_onramp") {
        const stripePreconditions = validateStripeOnrampContractFundingPreconditions(
          intent,
          fundingEligibility.stripeOnramp ?? {},
          buyerWalletAddress,
          x402Config,
        );
        if (!stripePreconditions.ok) {
          return reply.code(stripePreconditions.statusCode).send({
            error: stripePreconditions.error,
            message: stripePreconditions.message,
          });
        }
      }

      const sellerWalletAddress =
        typeof providerContext.seller_wallet === "string"
          ? providerContext.seller_wallet
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
    },
  );

  app.post(
    "/payments/:id/x402/conditional-settlement-funding",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const fundingEligibility = assertConditionalSettlementFundingEligibility(
        intent,
        providerContext,
      );
      if (!fundingEligibility.ok) {
        return reply.code(fundingEligibility.statusCode).send({
          error: fundingEligibility.error,
          message: fundingEligibility.message,
        });
      }
      if (!x402Config.conditionalSettlementAddress) {
        return reply.code(503).send({
          error: "CONDITIONAL_SETTLEMENT_NOT_CONFIGURED",
          message: "HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS is required",
        });
      }

      const parsed = conditionalSettlementFundingSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_SETTLEMENT_FUNDING", issues: parsed.error.issues });
      }
      if (
        parsed.data.contract_address &&
        parsed.data.contract_address.toLowerCase() !==
          x402Config.conditionalSettlementAddress.toLowerCase()
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

      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.conditional_settlement_funding",
        intent.id,
      );
      if (idempotency.replayed) return;

      try {
        await claimListingForFunding(db, intent);
      } catch (error) {
        if (sendListingClaimError(reply, error)) return;
        throw error;
      }

      const conditionalSettlementContext = {
        ...getConditionalSettlementContext(providerContext),
        contract_address: x402Config.conditionalSettlementAddress,
        chain_id: parsed.data.chain_id
          ? Number(parsed.data.chain_id)
          : resolveX402ChainId(x402Config),
        funding_tx_hash: parsed.data.tx_hash,
        settlement_id: parsed.data.settlement_id,
        chain_lookup: buildConditionalSettlementChainLookup(
          intent,
          parsed.data.settlement_id,
          parsed.data.chain_id ? Number(parsed.data.chain_id) : resolveX402ChainId(x402Config),
        ),
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
        const responseBody = {
          intent: pending.intent,
          conditional_settlement: conditionalSettlementContext,
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_funding",
          idempotency,
          intent.id,
          200,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.send(responseBody);
      }

      if (currentIntent.status === "SETTLEMENT_PENDING") {
        await updateStoredPaymentIntent(db, currentIntent, mergedContext);
        const responseBody = {
          intent: currentIntent,
          conditional_settlement: conditionalSettlementContext,
          idempotent: true,
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_funding",
          idempotency,
          intent.id,
          200,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.send(responseBody);
      }

      return reply
        .code(409)
        .send({ error: "PAYMENT_STATE_NOT_FUNDABLE", status: currentIntent.status });
    },
  );

  app.post(
    "/payments/:id/x402/conditional-settlement-confirmation",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }

      const parsed = conditionalSettlementConfirmationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "INVALID_CONDITIONAL_SETTLEMENT_CONFIRMATION",
          issues: parsed.error.issues,
        });
      }

      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const fundingEligibility = assertConditionalSettlementFundingEligibility(
        intent,
        providerContext,
      );
      if (!fundingEligibility.ok) {
        return reply.code(fundingEligibility.statusCode).send({
          error: fundingEligibility.error,
          message: fundingEligibility.message,
        });
      }
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const txHash =
        parsed.data.tx_hash ??
        (typeof conditionalContext.funding_tx_hash === "string"
          ? conditionalContext.funding_tx_hash
          : undefined);
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

      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.conditional_settlement_confirmation",
        intent.id,
      );
      if (idempotency.replayed) return;

      const receipt = await client.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);

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
        const responseBody = {
          intent,
          conditional_settlement: pendingContext,
          retry: conditionalSettlementConfirmationRetry(),
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_confirmation",
          idempotency,
          intent.id,
          202,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply
          .header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS))
          .code(202)
          .send(responseBody);
      }

      const finality = await evaluateConditionalSettlementFinality({
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        client,
      });
      if (!finality.ready) {
        const pendingContext = {
          ...conditionalContext,
          funding_tx_hash: txHash,
          status:
            finality.status === "pending"
              ? "FUNDING_CONFIRMATIONS_PENDING"
              : "FUNDING_FINALITY_UNAVAILABLE",
          checked_at: new Date().toISOString(),
          finality,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: pendingContext,
        });
        const statusCode = finality.status === "pending" ? 202 : 503;
        const responseBody = {
          intent,
          conditional_settlement: pendingContext,
          ...(statusCode === 202 ? { retry: conditionalSettlementConfirmationRetry() } : {}),
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_confirmation",
          idempotency,
          intent.id,
          statusCode,
          responseBody,
        );
        if (statusCode === 202)
          reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
        return reply.code(statusCode).send(responseBody);
      }

      const fundingEvent =
        receipt.status === "success"
          ? validateConditionalSettlementFundingReceipt(
              receipt,
              intent,
              providerContext,
              conditionalContext,
              x402Config,
            )
          : null;
      if (fundingEvent && !fundingEvent.ok) {
        const rejectedContext = {
          ...conditionalContext,
          funding_tx_hash: txHash,
          status: "FUNDING_EVENT_MISMATCH",
          checked_at: new Date().toISOString(),
          mismatch_reason: fundingEvent.message,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: rejectedContext,
        });
        const responseBody = {
          error: "CONDITIONAL_SETTLEMENT_EVENT_MISMATCH",
          message: fundingEvent.message,
          intent,
          conditional_settlement: rejectedContext,
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_confirmation",
          idempotency,
          intent.id,
          400,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.code(400).send(responseBody);
      }

      const confirmedContext = {
        ...conditionalContext,
        ...(fundingEvent?.ok ? fundingEvent.event : {}),
        settlement_id: fundingEvent?.ok
          ? fundingEvent.settlementId
          : typeof conditionalContext.settlement_id === "string"
            ? conditionalContext.settlement_id
            : undefined,
        funding_tx_hash: txHash,
        status: receipt.status === "success" ? "FUNDING_CONFIRMED" : "FUNDING_FAILED",
        confirmed_at: new Date().toISOString(),
        block_hash: receipt.blockHash,
        block_number: receipt.blockNumber?.toString(),
        transaction_index: receipt.transactionIndex,
        gas_used: receipt.gasUsed?.toString(),
        effective_gas_price: receipt.effectiveGasPrice?.toString(),
        finality,
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
        const responseBody = {
          intent: confirmedIntent,
          conditional_settlement: confirmedContext,
          finalization,
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_confirmation",
          idempotency,
          intent.id,
          200,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.send(responseBody);
      }

      if (
        intent.status === "QUOTED" ||
        intent.status === "AUTHORIZED" ||
        intent.status === "SETTLEMENT_PENDING"
      ) {
        const failed = service.failIntent(intent);
        await updateStoredPaymentIntent(db, failed.intent, {
          ...providerContext,
          conditional_settlement: confirmedContext,
        });
        await applyPaymentTransitionTriggers(db, failed);
        const responseBody = {
          intent: failed.intent,
          conditional_settlement: confirmedContext,
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_settlement_confirmation",
          idempotency,
          intent.id,
          200,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.send(responseBody);
      }

      await updateStoredPaymentIntent(db, intent, {
        ...providerContext,
        conditional_settlement: confirmedContext,
      });
      const responseBody = {
        intent,
        conditional_settlement: confirmedContext,
      };
      await recordPaymentOperationIdempotency(
        db,
        "payment.conditional_settlement_confirmation",
        idempotency,
        intent.id,
        200,
        responseBody as unknown as Record<string, unknown>,
      );
      return reply.send(responseBody);
    },
  );

  app.post(
    "/payments/:id/x402/conditional-refund-request",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (intent.status === "SETTLED") {
        return reply.code(409).send({ error: "CONDITIONAL_SETTLEMENT_ALREADY_RELEASED" });
      }
      if (intent.status !== "SETTLEMENT_PENDING") {
        return reply
          .code(409)
          .send({ error: "CONDITIONAL_REFUND_STATE_INVALID", status: intent.status });
      }

      const parsed = conditionalSettlementRefundRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_REFUND_REQUEST", issues: parsed.error.issues });
      }

      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const settlementId = normalizeHex(conditionalContext.settlement_id);
      if (!settlementId) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }
      if (
        conditionalContext.status !== "FUNDING_CONFIRMED" &&
        conditionalContext.status !== "DISPUTED"
      ) {
        return reply.code(409).send({
          error: "CONDITIONAL_SETTLEMENT_NOT_REFUNDABLE",
          status: conditionalContext.status,
        });
      }

      let signature;
      try {
        const signer = createConditionalRefundSigner();
        signature = await signer({
          settlementId,
          deadline: parseUnixSeconds(parsed.data.deadline_unix),
        });
      } catch (error) {
        return reply.code(503).send({
          error: "CONDITIONAL_REFUND_SIGNATURE_UNAVAILABLE",
          message: error instanceof Error ? error.message : String(error),
        });
      }

      const message = serializeConditionalRefundMessage(signature.message);
      const refundSnapshotContext = {
        ...conditionalContext,
        refund_signature_created_at: new Date().toISOString(),
        refund_deadline_unix: signature.deadline.toString(),
        status: "REFUND_SIGNED",
      };
      await updateStoredPaymentIntent(db, intent, {
        ...providerContext,
        conditional_settlement: refundSnapshotContext,
      });

      return reply.send({
        mode: "contract_call",
        contract_call: {
          function_name: "refund",
          params: message,
          signature: signature.signature,
        },
        typed_data: {
          domain: {
            ...CONDITIONAL_SETTLEMENT_EIP712_DOMAIN,
            chainId: resolveX402ChainId(x402Config),
            verifyingContract: x402Config.conditionalSettlementAddress,
          },
          types: CONDITIONAL_SETTLEMENT_EIP712_TYPES,
          primaryType: "Refund",
          message,
        },
        signature: signature.signature,
        deadline_unix: signature.deadline.toString(),
        signer_nonce: signature.signer_nonce.toString(),
      });
    },
  );

  app.post(
    "/payments/:id/x402/conditional-refund-execution",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (intent.status !== "SETTLEMENT_PENDING") {
        return reply
          .code(409)
          .send({ error: "CONDITIONAL_REFUND_STATE_INVALID", status: intent.status });
      }

      const parsed = conditionalSettlementRefundExecutionSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_REFUND_EXECUTION", issues: parsed.error.issues });
      }
      if (
        parsed.data.contract_address &&
        (!x402Config.conditionalSettlementAddress ||
          normalizeAddress(parsed.data.contract_address) !==
            normalizeAddress(x402Config.conditionalSettlementAddress))
      ) {
        return reply.code(400).send({ error: "CONDITIONAL_REFUND_CONTRACT_MISMATCH" });
      }
      if (parsed.data.chain_id && Number(parsed.data.chain_id) !== resolveX402ChainId(x402Config)) {
        return reply.code(400).send({ error: "CONDITIONAL_REFUND_CHAIN_MISMATCH" });
      }

      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const settlementId =
        parsed.data.settlement_id ?? normalizeHex(conditionalContext.settlement_id);
      if (!settlementId) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }
      if (
        conditionalContext.status !== "FUNDING_CONFIRMED" &&
        conditionalContext.status !== "DISPUTED" &&
        conditionalContext.status !== "REFUND_SIGNED" &&
        conditionalContext.status !== "REFUND_SUBMITTED"
      ) {
        return reply.code(409).send({
          error: "CONDITIONAL_SETTLEMENT_NOT_REFUNDABLE",
          status: conditionalContext.status,
        });
      }

      const submittedContext = {
        ...conditionalContext,
        settlement_id: settlementId,
        refund_tx_hash: parsed.data.tx_hash,
        refund_contract_address:
          parsed.data.contract_address ?? x402Config.conditionalSettlementAddress,
        refund_chain_id: parsed.data.chain_id
          ? String(parsed.data.chain_id)
          : String(resolveX402ChainId(x402Config)),
        status: "REFUND_SUBMITTED",
        refund_submitted_at: new Date().toISOString(),
      };
      await updateStoredPaymentIntent(db, intent, {
        ...providerContext,
        conditional_settlement: submittedContext,
      });

      return reply.send({
        intent,
        conditional_settlement: submittedContext,
      });
    },
  );

  app.post(
    "/payments/:id/x402/conditional-refund-confirmation",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }

      const parsed = conditionalSettlementRefundConfirmationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_REFUND_CONFIRMATION", issues: parsed.error.issues });
      }

      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      const txHash =
        parsed.data.tx_hash ??
        (typeof conditionalContext.refund_tx_hash === "string"
          ? conditionalContext.refund_tx_hash
          : undefined);
      if (!txHash) {
        return reply.code(400).send({ error: "CONDITIONAL_REFUND_TX_REQUIRED" });
      }
      if (!normalizeHex(conditionalContext.settlement_id)) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }
      if (intent.status !== "SETTLEMENT_PENDING") {
        return reply
          .code(409)
          .send({ error: "CONDITIONAL_REFUND_STATE_INVALID", status: intent.status });
      }

      const client = createConditionalSettlementReceiptClient(x402Config);
      if (!client) {
        return reply.code(503).send({
          error: "CONDITIONAL_REFUND_RECEIPT_RPC_NOT_CONFIGURED",
          message: "HAGGLE_BASE_RPC_URL is required to confirm conditional settlement refund",
        });
      }

      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.conditional_refund_confirmation",
        intent.id,
      );
      if (idempotency.replayed) return;

      const receipt = await client.getTransactionReceipt({ hash: txHash as Hex }).catch(() => null);

      if (!receipt) {
        const pendingContext = {
          ...conditionalContext,
          refund_tx_hash: txHash,
          status: "REFUND_PENDING",
          refund_checked_at: new Date().toISOString(),
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: pendingContext,
        });
        const responseBody = {
          intent,
          conditional_settlement: pendingContext,
          retry: conditionalSettlementConfirmationRetry(),
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_refund_confirmation",
          idempotency,
          intent.id,
          202,
          responseBody,
        );
        return reply
          .header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS))
          .code(202)
          .send(responseBody);
      }

      const finality = await evaluateConditionalSettlementFinality({
        receiptBlockNumber: receipt.blockNumber,
        receiptBlockHash: receipt.blockHash,
        client,
      });
      if (!finality.ready) {
        const pendingContext = {
          ...conditionalContext,
          refund_tx_hash: txHash,
          status:
            finality.status === "pending"
              ? "REFUND_CONFIRMATIONS_PENDING"
              : "REFUND_FINALITY_UNAVAILABLE",
          refund_checked_at: new Date().toISOString(),
          finality,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: pendingContext,
        });
        const statusCode = finality.status === "pending" ? 202 : 503;
        const responseBody = {
          intent,
          conditional_settlement: pendingContext,
          ...(statusCode === 202 ? { retry: conditionalSettlementConfirmationRetry() } : {}),
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_refund_confirmation",
          idempotency,
          intent.id,
          statusCode,
          responseBody,
        );
        if (statusCode === 202)
          reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
        return reply.code(statusCode).send(responseBody);
      }

      const refundEvent =
        receipt.status === "success"
          ? validateConditionalSettlementRefundReceipt(
              receipt,
              intent,
              providerContext,
              conditionalContext,
              x402Config,
            )
          : null;
      if (refundEvent && !refundEvent.ok) {
        const rejectedContext = {
          ...conditionalContext,
          refund_tx_hash: txHash,
          status: "REFUND_EVENT_MISMATCH",
          refund_checked_at: new Date().toISOString(),
          refund_mismatch_reason: refundEvent.message,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: rejectedContext,
        });
        const responseBody = {
          error: "CONDITIONAL_REFUND_EVENT_MISMATCH",
          message: refundEvent.message,
          intent,
          conditional_settlement: rejectedContext,
        };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_refund_confirmation",
          idempotency,
          intent.id,
          400,
          responseBody,
        );
        return reply.code(400).send(responseBody);
      }

      const confirmedContext = {
        ...conditionalContext,
        ...(refundEvent?.ok ? refundEvent.event : {}),
        refund_tx_hash: txHash,
        status: receipt.status === "success" ? "REFUND_CONFIRMED" : "REFUND_FAILED",
        refund_confirmed_at: new Date().toISOString(),
        refund_block_hash: receipt.blockHash,
        refund_block_number: receipt.blockNumber?.toString(),
        refund_transaction_index: receipt.transactionIndex,
        refund_gas_used: receipt.gasUsed?.toString(),
        refund_effective_gas_price: receipt.effectiveGasPrice?.toString(),
        finality,
      };

      if (receipt.status !== "success") {
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: confirmedContext,
        });
        const responseBody = { intent, conditional_settlement: confirmedContext };
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_refund_confirmation",
          idempotency,
          intent.id,
          200,
          responseBody,
        );
        return reply.send(responseBody);
      }

      const now = new Date().toISOString();
      const refundedIntent: PaymentIntent = {
        ...intent,
        status: "SETTLED",
        production_status: "refunded",
        updated_at: now,
      };
      const refund: Refund = {
        id: randomUUID(),
        payment_intent_id: intent.id,
        amount: intent.amount,
        reason_code: "CONDITIONAL_SETTLEMENT_REFUND",
        status: "COMPLETED",
        created_at: now,
        updated_at: now,
      };
      const refundAmountFailure = await getRefundAmountPolicyFailure(db, intent, refund);
      if (refundAmountFailure) {
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_refund_confirmation",
          idempotency,
          intent.id,
          refundAmountFailure.statusCode,
          refundAmountFailure.body,
        );
        return reply.code(refundAmountFailure.statusCode).send(refundAmountFailure.body);
      }

      await createRefundRecord(db, refund, txHash);
      await updateStoredPaymentIntent(db, refundedIntent, {
        ...providerContext,
        conditional_settlement: confirmedContext,
      });
      await updateCommerceOrderStatus(db, intent.order_id, "REFUNDED");
      await auditPaymentAction(db, request, "payment.refund", {
        intent: refundedIntent,
        previousStatus: intent.status,
        nextStatus: refundedIntent.status,
        previousProductionState:
          intent.production_status ?? mapLegacyPaymentStatusForAudit(intent.status),
        nextProductionState: "refunded",
        reason: "conditional settlement refund confirmed on-chain",
        providerEventId: txHash,
        metadata: confirmedContext,
      });

      const responseBody = {
        intent: refundedIntent,
        refund,
        conditional_settlement: confirmedContext,
      };
      await recordPaymentOperationIdempotency(
        db,
        "payment.conditional_refund_confirmation",
        idempotency,
        intent.id,
        200,
        responseBody,
      );
      return reply.send(responseBody);
    },
  );

  app.post(
    "/payments/:id/x402/conditional-expire-confirmation",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const parsed = conditionalSettlementRefundExecutionSchema
        .pick({ tx_hash: true })
        .safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_EXPIRE_CONFIRMATION", issues: parsed.error.issues });
      }

      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      if (!normalizeHex(conditionalContext.settlement_id)) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }

      const client = createConditionalSettlementReceiptClient(x402Config);
      if (!client) {
        return reply.code(503).send({
          error: "CONDITIONAL_EXPIRE_RECEIPT_RPC_NOT_CONFIGURED",
          message: "HAGGLE_BASE_RPC_URL is required to confirm conditional settlement expiry",
        });
      }

      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.conditional_expire_confirmation",
        intent.id,
      );
      if (idempotency.replayed) return;

      const receipt = await client
        .getTransactionReceipt({ hash: parsed.data.tx_hash as Hex })
        .catch(() => null);
      let confirmedExpireFinality = null;
      if (receipt) {
        confirmedExpireFinality = await evaluateConditionalSettlementFinality({
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: receipt.blockHash,
          client,
        });
        if (!confirmedExpireFinality.ready) {
          const pendingContext = {
            ...conditionalContext,
            expire_tx_hash: parsed.data.tx_hash,
            status:
              confirmedExpireFinality.status === "pending"
                ? "EXPIRE_CONFIRMATIONS_PENDING"
                : "EXPIRE_FINALITY_UNAVAILABLE",
            expire_checked_at: new Date().toISOString(),
            finality: confirmedExpireFinality,
          };
          await updateStoredPaymentIntent(db, intent, {
            ...providerContext,
            conditional_settlement: pendingContext,
          });
          const statusCode = confirmedExpireFinality.status === "pending" ? 202 : 503;
          const responseBody = {
            intent,
            conditional_settlement: pendingContext,
            ...(statusCode === 202 ? { retry: conditionalSettlementConfirmationRetry() } : {}),
          };
          await recordPaymentOperationIdempotency(
            db,
            "payment.conditional_expire_confirmation",
            idempotency,
            intent.id,
            statusCode,
            responseBody,
          );
          if (statusCode === 202)
            reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
          return reply.code(statusCode).send(responseBody);
        }
      }
      const refundEvent =
        receipt?.status === "success"
          ? validateConditionalSettlementRefundReceipt(
              receipt,
              intent,
              providerContext,
              conditionalContext,
              x402Config,
            )
          : null;
      if (receipt?.status !== "success" || !refundEvent?.ok) {
        const rejectedContext = {
          ...conditionalContext,
          expire_tx_hash: parsed.data.tx_hash,
          status: !receipt ? "EXPIRE_PENDING" : "EXPIRE_EVENT_MISMATCH",
          expire_checked_at: new Date().toISOString(),
          expire_mismatch_reason: refundEvent && !refundEvent.ok ? refundEvent.message : undefined,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: rejectedContext,
        });
        const responseBody = {
          intent,
          conditional_settlement: rejectedContext,
          ...(!receipt ? { retry: conditionalSettlementConfirmationRetry() } : {}),
        };
        const statusCode = !receipt ? 202 : 400;
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_expire_confirmation",
          idempotency,
          intent.id,
          statusCode,
          responseBody,
        );
        if (statusCode === 202)
          reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
        return reply.code(statusCode).send(responseBody);
      }

      const now = new Date().toISOString();
      const confirmedContext = {
        ...conditionalContext,
        ...refundEvent.event,
        expire_tx_hash: parsed.data.tx_hash,
        status: "EXPIRE_REFUND_CONFIRMED",
        expire_confirmed_at: now,
        refund_tx_hash: parsed.data.tx_hash,
        refund_confirmed_at: now,
        finality: confirmedExpireFinality,
      };
      const refundedIntent: PaymentIntent = {
        ...intent,
        status: "SETTLED",
        production_status: "refunded",
        updated_at: now,
      };
      const refund: Refund = {
        id: randomUUID(),
        payment_intent_id: intent.id,
        amount: intent.amount,
        reason_code: "CONDITIONAL_SETTLEMENT_EXPIRED",
        status: "COMPLETED",
        created_at: now,
        updated_at: now,
      };
      const refundAmountFailure = await getRefundAmountPolicyFailure(db, intent, refund);
      if (refundAmountFailure) {
        await recordPaymentOperationIdempotency(
          db,
          "payment.conditional_expire_confirmation",
          idempotency,
          intent.id,
          refundAmountFailure.statusCode,
          refundAmountFailure.body,
        );
        return reply.code(refundAmountFailure.statusCode).send(refundAmountFailure.body);
      }

      await createRefundRecord(db, refund, parsed.data.tx_hash);
      await updateStoredPaymentIntent(db, refundedIntent, {
        ...providerContext,
        conditional_settlement: confirmedContext,
      });
      await updateCommerceOrderStatus(db, intent.order_id, "REFUNDED");

      const responseBody = {
        intent: refundedIntent,
        refund,
        conditional_settlement: confirmedContext,
      };
      await recordPaymentOperationIdempotency(
        db,
        "payment.conditional_expire_confirmation",
        idempotency,
        intent.id,
        200,
        responseBody,
      );
      return reply.send(responseBody);
    },
  );

  app.post(
    "/payments/:id/x402/conditional-dispute-confirmation",
    { preHandler: [requireAdmin] },
    async (request, reply) => {
      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const parsed = conditionalSettlementDisputeConfirmationSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_CONDITIONAL_DISPUTE_CONFIRMATION", issues: parsed.error.issues });
      }

      const row = await getPaymentIntentRowById(db, intent.id);
      const providerContext =
        row?.providerContext &&
        typeof row.providerContext === "object" &&
        !Array.isArray(row.providerContext)
          ? row.providerContext
          : {};
      const conditionalContext = getConditionalSettlementContext(providerContext);
      if (!normalizeHex(conditionalContext.settlement_id)) {
        return reply.code(400).send({ error: "CONDITIONAL_SETTLEMENT_ID_REQUIRED" });
      }

      const client = createConditionalSettlementReceiptClient(x402Config);
      if (!client) {
        return reply.code(503).send({
          error: "CONDITIONAL_DISPUTE_RECEIPT_RPC_NOT_CONFIGURED",
          message: "HAGGLE_BASE_RPC_URL is required to confirm conditional settlement dispute",
        });
      }
      const receipt = await client
        .getTransactionReceipt({ hash: parsed.data.tx_hash as Hex })
        .catch(() => null);
      let confirmedDisputeFinality = null;
      if (receipt) {
        confirmedDisputeFinality = await evaluateConditionalSettlementFinality({
          receiptBlockNumber: receipt.blockNumber,
          receiptBlockHash: receipt.blockHash,
          client,
        });
        if (!confirmedDisputeFinality.ready) {
          const pendingContext = {
            ...conditionalContext,
            dispute_tx_hash: parsed.data.tx_hash,
            status:
              confirmedDisputeFinality.status === "pending"
                ? "DISPUTE_CONFIRMATIONS_PENDING"
                : "DISPUTE_FINALITY_UNAVAILABLE",
            dispute_checked_at: new Date().toISOString(),
            finality: confirmedDisputeFinality,
          };
          await updateStoredPaymentIntent(db, intent, {
            ...providerContext,
            conditional_settlement: pendingContext,
          });
          const statusCode = confirmedDisputeFinality.status === "pending" ? 202 : 503;
          if (statusCode === 202)
            reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
          return reply.code(statusCode).send({
            intent,
            conditional_settlement: pendingContext,
            ...(statusCode === 202 ? { retry: conditionalSettlementConfirmationRetry() } : {}),
          });
        }
      }
      const disputeEvent =
        receipt?.status === "success"
          ? validateConditionalSettlementDisputeReceipt(
              receipt,
              conditionalContext,
              x402Config,
              parsed.data.evidence_hash,
            )
          : null;
      if (receipt?.status !== "success" || !disputeEvent?.ok) {
        const rejectedContext = {
          ...conditionalContext,
          dispute_tx_hash: parsed.data.tx_hash,
          status: !receipt ? "DISPUTE_PENDING" : "DISPUTE_EVENT_MISMATCH",
          dispute_checked_at: new Date().toISOString(),
          dispute_mismatch_reason:
            disputeEvent && !disputeEvent.ok ? disputeEvent.message : undefined,
        };
        await updateStoredPaymentIntent(db, intent, {
          ...providerContext,
          conditional_settlement: rejectedContext,
        });
        if (!receipt)
          reply.header("Retry-After", String(CONDITIONAL_SETTLEMENT_RETRY_AFTER_SECONDS));
        return reply.code(!receipt ? 202 : 400).send({
          intent,
          conditional_settlement: rejectedContext,
          ...(!receipt ? { retry: conditionalSettlementConfirmationRetry() } : {}),
        });
      }

      const disputedIntent: PaymentIntent = {
        ...intent,
        status: "SETTLED",
        production_status: "disputed",
        updated_at: new Date().toISOString(),
      };
      const disputedContext = {
        ...conditionalContext,
        ...disputeEvent.event,
        dispute_tx_hash: parsed.data.tx_hash,
        status: "DISPUTED",
        disputed_at: new Date().toISOString(),
        finality: confirmedDisputeFinality,
      };
      await updateStoredPaymentIntent(db, disputedIntent, {
        ...providerContext,
        conditional_settlement: disputedContext,
      });
      await updateCommerceOrderStatus(db, intent.order_id, "IN_DISPUTE");

      return reply.send({
        intent: disputedIntent,
        conditional_settlement: disputedContext,
      });
    },
  );

  app.post(
    "/payments/:id/x402/submit-signature",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
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
        return reply
          .code(400)
          .send({ error: "INVALID_X402_SUBMIT_REQUEST", issues: parsed.error.issues });
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
            fulfillment: finalization.fulfillment,
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
        return reply
          .code(400)
          .send({ error: "X402_POLICY_BINDING_MISMATCH", message: bindingError });
      }

      if (parsed.data.verify_only) {
        const verify = await x402Facilitator.verify(x402Payload, requirement);
        return reply.send({ verification: verify });
      }

      if (!x402Config.allowExactSettlementFallback) {
        return reply.code(409).send({
          error: "CONDITIONAL_SETTLEMENT_REQUIRED",
          message:
            "direct x402 exact settlement is disabled; use the conditional settlement contract funding flow",
        });
      }

      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.x402_settle",
        intent.id,
      );
      if (idempotency.replayed) return;

      if (intent.status === "AUTHORIZED") {
        const pending = service.markSettlementPending(intent);
        await updateStoredPaymentIntent(db, pending.intent);
        intent.status = pending.intent.status;
        intent.updated_at = pending.intent.updated_at;
      }

      const settle = await x402Facilitator.settle(
        x402Payload,
        requirement,
        idempotency.key ?? undefined,
      );
      if (!settle.success) {
        const responseBody = { error: "X402_SETTLEMENT_FAILED", settlement: settle };
        await recordPaymentOperationIdempotency(
          db,
          "payment.x402_settle",
          idempotency,
          intent.id,
          400,
          responseBody,
        );
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
        fulfillment: finalization.fulfillment,
        shipment: finalization.shipment,
      };
      await auditPaymentAction(db, request, "payment.capture", {
        intent: result.intent,
        previousStatus: intent.status,
        nextStatus: result.intent.status,
        reason: "x402 facilitator settlement",
        metadata: result.metadata,
      });
      await recordPaymentOperationIdempotency(
        db,
        "payment.x402_settle",
        idempotency,
        intent.id,
        200,
        responseBody as Record<string, unknown>,
      );
      return reply.send(responseBody);
    },
  );

  app.post(
    "/payments/:id/authorize",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "DIRECT_PAYMENT_MUTATION_DISABLED",
          message: "Use the rail-specific payment flow in production",
        });
      }
      const adminReason = getPaymentAdminMutationReason(request, "payment authorization requested");
      if ("error" in adminReason) return reply.code(400).send(adminReason.error);

      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const railError = getProductionPaymentRailError(intent.selected_rail);
      if (railError) {
        return reply.code(503).send(railError);
      }
      if (sendManualPaymentMutationPolicyFailure(reply, "authorize", intent)) return;
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.authorize",
        intent.id,
      );
      if (idempotency.replayed) return;
      let claimedListing = false;
      try {
        await claimListingForFunding(db, intent);
        claimedListing = true;
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
          reason: adminReason.reason,
          metadata: result.metadata,
        });
        await recordPaymentOperationIdempotency(
          db,
          "payment.authorize",
          idempotency,
          intent.id,
          200,
          result as unknown as Record<string, unknown>,
        );
        return reply.send(result);
      } catch (error) {
        if (claimedListing && !(error instanceof ListingClaimError)) {
          await releaseListingFundingForIntent(db, intent).catch(() => undefined);
        }
        if (sendListingClaimError(reply, error)) return;
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.authorize",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.post(
    "/payments/:id/settlement-pending",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "DIRECT_PAYMENT_MUTATION_DISABLED",
          message: "Payment settlement state is controlled by provider flow in production",
        });
      }
      const adminReason = getPaymentAdminMutationReason(
        request,
        "payment marked settlement pending",
      );
      if ("error" in adminReason) return reply.code(400).send(adminReason.error);

      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const railError = getProductionPaymentRailError(intent.selected_rail);
      if (railError) {
        return reply.code(503).send(railError);
      }
      if (sendManualPaymentMutationPolicyFailure(reply, "settlement_pending", intent)) return;
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.settlement_pending",
        intent.id,
      );
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
          reason: adminReason.reason,
        });
        await recordPaymentOperationIdempotency(
          db,
          "payment.settlement_pending",
          idempotency,
          intent.id,
          200,
          result as unknown as Record<string, unknown>,
        );
        return reply.send(result);
      } catch (error) {
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.settlement_pending",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.post(
    "/payments/:id/settle",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "DIRECT_PAYMENT_MUTATION_DISABLED",
          message:
            "Payment settlement is controlled by provider webhook or x402 facilitator in production",
        });
      }
      const adminReason = getPaymentAdminMutationReason(request, "payment capture requested");
      if ("error" in adminReason) return reply.code(400).send(adminReason.error);

      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const railError = getProductionPaymentRailError(intent.selected_rail);
      if (railError) {
        return reply.code(503).send(railError);
      }
      if (sendManualPaymentMutationPolicyFailure(reply, "capture", intent)) return;
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.capture",
        intent.id,
      );
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
            fulfillment: finalization.fulfillment,
            shipment: finalization.shipment,
          };
          await recordPaymentOperationIdempotency(
            db,
            "payment.capture",
            idempotency,
            intent.id,
            200,
            responseBody as Record<string, unknown>,
          );
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
          fulfillment: finalization.fulfillment,
          shipment: finalization.shipment,
        };
        await auditPaymentAction(db, request, "payment.capture", {
          intent: result.intent,
          previousStatus,
          nextStatus: result.intent.status,
          reason: adminReason.reason,
          metadata: result.metadata,
        });
        await recordPaymentOperationIdempotency(
          db,
          "payment.capture",
          idempotency,
          intent.id,
          200,
          responseBody as Record<string, unknown>,
        );
        return reply.send(responseBody);
      } catch (error) {
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.capture",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.post(
    "/payments/:id/fail",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "DIRECT_PAYMENT_MUTATION_DISABLED",
          message: "Payment failure state is controlled by provider webhook or admin in production",
        });
      }
      const adminReason = getPaymentAdminMutationReason(request, "payment marked failed");
      if ("error" in adminReason) return reply.code(400).send(adminReason.error);

      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (sendManualPaymentMutationPolicyFailure(reply, "fail", intent)) return;
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.fail",
        intent.id,
      );
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
          reason: adminReason.reason,
        });
        await recordPaymentOperationIdempotency(
          db,
          "payment.fail",
          idempotency,
          intent.id,
          200,
          result as unknown as Record<string, unknown>,
        );
        await releaseListingFundingForIntent(db, intent);
        return reply.send(result);
      } catch (error) {
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.fail",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.post(
    "/payments/:id/cancel",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "DIRECT_PAYMENT_MUTATION_DISABLED",
          message:
            "Direct payment cancellation requires a dedicated cancellation workflow in production",
        });
      }
      const adminReason = getPaymentAdminMutationReason(request, "payment cancellation requested");
      if ("error" in adminReason) return reply.code(400).send(adminReason.error);

      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      if (sendManualPaymentMutationPolicyFailure(reply, "cancel", intent)) return;
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.cancel",
        intent.id,
      );
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
          reason: adminReason.reason,
        });
        await recordPaymentOperationIdempotency(
          db,
          "payment.cancel",
          idempotency,
          intent.id,
          200,
          result as unknown as Record<string, unknown>,
        );
        await releaseListingFundingForIntent(db, intent);
        return reply.send(result);
      } catch (error) {
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.cancel",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.post(
    "/payments/:id/refund",
    { preHandler: [requireAuth, requirePaymentOwner({ role: "buyer" })] },
    async (request, reply) => {
      if (requiresRealPaymentProviders() && request.user?.role !== "admin") {
        return reply.code(403).send({
          error: "DIRECT_REFUND_DISABLED",
          message: "Direct refunds require admin review in production",
        });
      }
      const adminReason = getPaymentAdminMutationReason(request, "payment refund requested");
      if ("error" in adminReason) return reply.code(400).send(adminReason.error);

      const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
      if (!intent) {
        return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
      }
      const railError = getProductionPaymentRailError(intent.selected_rail);
      if (railError) {
        return reply.code(503).send(railError);
      }
      if (sendManualPaymentMutationPolicyFailure(reply, "refund", intent)) return;
      const parsed = refundSchema.safeParse({
        ...(request.body as Record<string, unknown>),
        payment_intent_id: (request.params as { id: string }).id,
      });
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_REFUND_REQUEST", issues: parsed.error.issues });
      }
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.refund",
        intent.id,
      );
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

      const refundAmountFailure = await getRefundAmountPolicyFailure(db, intent, refund);
      if (refundAmountFailure) {
        await recordPaymentOperationIdempotency(
          db,
          "payment.refund",
          idempotency,
          intent.id,
          refundAmountFailure.statusCode,
          refundAmountFailure.body,
        );
        return reply.code(refundAmountFailure.statusCode).send(refundAmountFailure.body);
      }

      try {
        const result = await service.refundIntent(intent, refund);
        const refundedIntent: PaymentIntent = {
          ...intent,
          production_status: productionStateAfterRefund({
            legacyStatus: intent.status,
            paymentAmountMinor: intent.amount.amount_minor,
            refundAmountMinor: result.refund.amount.amount_minor,
          }),
          updated_at: new Date().toISOString(),
        };
        await createRefundRecord(
          db,
          result.refund,
          typeof result.metadata?.provider_reference === "string"
            ? result.metadata.provider_reference
            : null,
        );
        await updateStoredPaymentIntent(db, refundedIntent);
        await auditPaymentAction(db, request, "payment.refund", {
          intent: refundedIntent,
          previousStatus: intent.status,
          nextStatus: intent.status,
          previousProductionState:
            intent.production_status ?? mapLegacyPaymentStatusForAudit(intent.status),
          nextProductionState: refundedIntent.production_status,
          reason: adminReason.reason,
          metadata: result.metadata,
        });
        const responseBody = { ...result, intent: refundedIntent };
        await recordPaymentOperationIdempotency(
          db,
          "payment.refund",
          idempotency,
          intent.id,
          200,
          responseBody as unknown as Record<string, unknown>,
        );
        return reply.send(responseBody);
      } catch (error) {
        return sendAndRecordPaymentOperationFailure(
          db,
          reply,
          "payment.refund",
          idempotency,
          intent.id,
          error,
        );
      }
    },
  );

  app.post("/payments/webhooks/x402", { config: { rawBody: true } }, async (request, reply) => {
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    try {
      if (!rawBody) {
        return reply.code(500).send({
          error: "INTERNAL_ERROR",
          message: "Raw body not available for signature verification",
        });
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
      return reply.code(401).send({
        error: "INVALID_X402_WEBHOOK",
        message: "Webhook signature verification failed",
      });
    }

    const body = request.body as {
      event_type?: string;
      payment_intent_id?: string;
      event_id?: string;
      id?: string;
      [key: string]: unknown;
    };
    const envMismatch = webhookEnvironmentMismatch("x402", body);
    if (envMismatch) {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "x402",
        providerEventId:
          typeof body.event_id === "string"
            ? body.event_id
            : typeof body.id === "string"
              ? body.id
              : undefined,
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
        providerEventId:
          typeof body.event_id === "string"
            ? body.event_id
            : typeof body.id === "string"
              ? body.id
              : undefined,
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
    const webhookClaim = await claimWebhookEvent(db, {
      source: "x402",
      eventId: webhookEventId,
      payloadSha256: webhookPayloadSha256(rawBody!),
    });
    if (webhookClaim.outcome === "duplicate") {
      await emitPaymentWebhookDuplicateMetric("x402", eventType);
      return reply.send({ accepted: true, action: "duplicate", reason: "already_processed" });
    }
    if (webhookClaim.outcome === "payload_conflict") {
      return reply
        .code(409)
        .send({ accepted: false, action: "error", error: "WEBHOOK_PAYLOAD_CONFLICT" });
    }
    if (webhookClaim.outcome !== "acquired") {
      return reply
        .code(503)
        .send({ accepted: false, action: "retry", error: "WEBHOOK_PROCESSING_IN_PROGRESS" });
    }
    const stopX402Heartbeat = startWebhookClaimHeartbeat(db, webhookClaim);
    reply.raw.once("finish", stopX402Heartbeat);

    const intent = await getPaymentIntentById(db, paymentIntentId);
    if (!intent) {
      await completeWebhookEvent(db, webhookClaim, 200);
      return reply.send({ accepted: true, action: "ignored", reason: "unknown_intent" });
    }
    const railError = getProductionPaymentRailError(intent.selected_rail);
    if (railError) {
      await failWebhookEvent(db, webhookClaim);
      return reply.code(503).send({ accepted: false, action: "error", ...railError });
    }

    try {
      switch (eventType) {
        case "settlement.confirmed": {
          const reconciliationReason = settlementWebhookReconciliationReason(intent);
          if (reconciliationReason) {
            const response = await sendPaymentWebhookReconciliationRequired(db, reply, intent, {
              provider: "x402",
              providerEventId: webhookEventId,
              eventType,
              reason: reconciliationReason,
            });
            await completeWebhookEvent(db, webhookClaim, reply.statusCode);
            return response;
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

          await completeWebhookEvent(db, webhookClaim, 200);
          return reply.send({
            accepted: true,
            action: "settled",
            settlement_release: finalization.settlementRelease,
            fulfillment: finalization.fulfillment,
            shipment: finalization.shipment,
          });
        }

        case "settlement.failed": {
          const reconciliationReason = terminalWebhookReconciliationReason(intent, "fail");
          if (reconciliationReason) {
            const response = await sendPaymentWebhookReconciliationRequired(db, reply, intent, {
              provider: "x402",
              providerEventId: webhookEventId,
              eventType,
              reason: reconciliationReason,
            });
            await completeWebhookEvent(db, webhookClaim, reply.statusCode);
            return response;
          }
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

          await completeWebhookEvent(db, webhookClaim, 200);
          return reply.send({ accepted: true, action: "failed" });
        }

        case "payment.expired": {
          const reconciliationReason = terminalWebhookReconciliationReason(intent, "expire");
          if (reconciliationReason) {
            const response = await sendPaymentWebhookReconciliationRequired(db, reply, intent, {
              provider: "x402",
              providerEventId: webhookEventId,
              eventType,
              reason: reconciliationReason,
            });
            await completeWebhookEvent(db, webhookClaim, reply.statusCode);
            return response;
          }
          if (intent.status !== "CANCELED" && intent.status !== "SETTLED") {
            const result = service.cancelIntent(intent);
            await updateStoredPaymentIntent(db, result.intent);
          }

          await completeWebhookEvent(db, webhookClaim, 200);
          return reply.send({ accepted: true, action: "expired" });
        }

        default:
          await completeWebhookEvent(db, webhookClaim, 200);
          return reply.send({ accepted: true, action: "ignored", reason: "unknown_event" });
      }
    } catch (error) {
      await failWebhookEvent(db, webhookClaim);
      await emitPaymentWebhookProcessingFailureMetric("x402", eventType);
      console.error("x402 webhook processing error:", safeRedactPaymentLog(error));
      return reply
        .code(500)
        .send({ accepted: false, action: "error", message: "Webhook processing failed" });
    }
  });

  app.post("/payments/webhooks/stripe", { config: { rawBody: true } }, async (request, reply) => {
    const stripeSig = (request.headers as Record<string, unknown>)["stripe-signature"];
    if (!stripeSig || typeof stripeSig !== "string") {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "stripe",
        reason: "missing_signature_header",
      });
      return reply.code(401).send({
        error: "INVALID_STRIPE_WEBHOOK",
        message: "Webhook signature verification failed",
      });
    }

    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(500).send({
        error: "INTERNAL_ERROR",
        message: "Raw body not available for signature verification",
      });
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
          message: "Webhook signature verification failed",
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

      const stripeClaim = await claimWebhookEvent(db, {
        source: "stripe",
        eventId: event.id,
        payloadSha256: webhookPayloadSha256(rawBody),
      });
      if (stripeClaim.outcome === "duplicate") {
        await emitPaymentWebhookDuplicateMetric("stripe", event.type);
        return reply.send({ accepted: true, action: "duplicate", reason: "already_processed" });
      }
      if (stripeClaim.outcome === "payload_conflict") {
        return reply
          .code(409)
          .send({ accepted: false, action: "error", error: "WEBHOOK_PAYLOAD_CONFLICT" });
      }
      if (stripeClaim.outcome !== "acquired") {
        return reply
          .code(503)
          .send({ accepted: false, action: "retry", error: "WEBHOOK_PROCESSING_IN_PROGRESS" });
      }
      const stopStripeHeartbeat = startWebhookClaimHeartbeat(db, stripeClaim);
      reply.raw.once("finish", stopStripeHeartbeat);

      // Handle crypto onramp fulfillment
      const { RealStripeAdapter } = await import("../payments/real-stripe-adapter.js");
      if (RealStripeAdapter.isOnrampFulfillmentComplete(event)) {
        const paymentIntentId = RealStripeAdapter.extractPaymentIntentId(event);
        if (paymentIntentId) {
          try {
            const depositResult = await finalizeStripeDepositFulfillment(
              db,
              paymentIntentId,
              event,
            );
            if (depositResult) {
              await completeWebhookEvent(db, stripeClaim, 200);
              return reply.send(depositResult);
            }
          } catch (error) {
            await failWebhookEvent(db, stripeClaim);
            await emitPaymentWebhookProcessingFailureMetric("stripe", event.type);
            console.error("Stripe deposit fulfillment error:", safeRedactPaymentLog(error));
            return reply.code(500).send({
              accepted: false,
              action: "error",
              message: "Deposit fulfillment processing failed",
            });
          }

          const intent = await getPaymentIntentById(db, paymentIntentId);
          if (intent) {
            // Verify event data matches stored intent
            const eventObj = event.data?.object as unknown as
              | { metadata?: Record<string, string> }
              | undefined;
            const eventOrderId = eventObj?.metadata?.order_id;
            if (eventOrderId && eventOrderId !== intent.order_id) {
              console.error("Stripe webhook order_id mismatch", {
                event_order_id: eventOrderId,
                intent_order_id: intent.order_id,
              });
              await completeWebhookEvent(db, stripeClaim, 400);
              return reply.code(400).send({ error: "ORDER_ID_MISMATCH" });
            }
            const eventPolicyHash = eventObj?.metadata?.approval_policy_hash;
            if (
              eventPolicyHash &&
              intent.approval_policy_hash &&
              eventPolicyHash !== intent.approval_policy_hash
            ) {
              console.error("Stripe webhook approval_policy_hash mismatch", {
                payment_intent_id: intent.id,
              });
              await completeWebhookEvent(db, stripeClaim, 400);
              return reply.code(400).send({ error: "APPROVAL_POLICY_HASH_MISMATCH" });
            }

            try {
              const intentRow = await getPaymentIntentRowById(db, intent.id);
              const providerContext =
                intentRow?.providerContext &&
                typeof intentRow.providerContext === "object" &&
                !Array.isArray(intentRow.providerContext)
                  ? intentRow.providerContext
                  : {};
              const existingStripeOnramp = getStripeOnrampContext(providerContext);
              const eventObject = event.data.object as unknown as Record<string, unknown>;
              const metadata = eventObject.metadata as Record<string, string> | undefined;
              const terminalNeedsReview =
                intent.status === "FAILED" || intent.status === "CANCELED";
              const stripeOnrampContext = {
                ...existingStripeOnramp,
                status: terminalNeedsReview
                  ? "ONRAMP_FUNDED_RECONCILIATION_REQUIRED"
                  : "ONRAMP_FUNDED",
                session_id: typeof eventObject.id === "string" ? eventObject.id : undefined,
                event_id: event.id,
                event_type: event.type,
                fulfilled_at: new Date().toISOString(),
                destination_wallet:
                  typeof eventObject.destination_wallet === "string"
                    ? eventObject.destination_wallet
                    : typeof eventObject.wallet_address === "string"
                      ? eventObject.wallet_address
                      : existingStripeOnramp.destination_wallet,
                destination_amount:
                  typeof eventObject.destination_amount === "string"
                    ? eventObject.destination_amount
                    : undefined,
                destination_currency:
                  typeof eventObject.destination_currency === "string"
                    ? eventObject.destination_currency
                    : typeof existingStripeOnramp.destination_currency === "string"
                      ? existingStripeOnramp.destination_currency
                      : "usdc",
                destination_network:
                  typeof eventObject.destination_network === "string"
                    ? eventObject.destination_network
                    : typeof existingStripeOnramp.destination_network === "string"
                      ? existingStripeOnramp.destination_network
                      : "base",
                destination_amount_minor:
                  metadata?.destination_amount_minor ??
                  existingStripeOnramp.destination_amount_minor,
                order_id: metadata?.order_id,
                approval_policy_hash: metadata?.approval_policy_hash,
              };

              await setPaymentIntentProviderContext(db, intent.id, {
                ...providerContext,
                stripe_onramp: stripeOnrampContext,
                ...(terminalNeedsReview
                  ? {
                      reconciliation_needed: {
                        provider: "stripe",
                        provider_event_id: event.id,
                        event_type: event.type,
                        reason: "onramp_funded_after_terminal_state",
                        local_status: intent.status,
                        local_production_status: paymentProductionState(intent),
                        recorded_at: new Date().toISOString(),
                      },
                    }
                  : {}),
              });

              await completeWebhookEvent(db, stripeClaim, 200);
              return reply.send({
                accepted: true,
                action: terminalNeedsReview
                  ? "onramp_funded_reconciliation_required"
                  : "onramp_funded",
                payment_intent_id: paymentIntentId,
                next_action: "fund_conditional_settlement",
                stripe_onramp: stripeOnrampContext,
              });
            } catch (error) {
              await failWebhookEvent(db, stripeClaim);
              await emitPaymentWebhookProcessingFailureMetric("stripe", event.type);
              console.error(
                "Stripe webhook onramp fulfillment error:",
                safeRedactPaymentLog(error),
              );
              return reply.code(500).send({
                accepted: false,
                action: "error",
                message: "Onramp fulfillment processing failed",
              });
            }
          }
        }
      }

      await completeWebhookEvent(db, stripeClaim, 200);
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
        return reply.code(401).send({
          error: "INVALID_STRIPE_WEBHOOK",
          message: "Webhook signature verification failed",
        });
      }
    } else if (process.env.NODE_ENV === "production") {
      await auditPaymentWebhookEvent(db, request, "payment.webhook_rejected", {
        provider: "stripe",
        reason: "webhook_secret_not_configured",
        metadata: {
          mode: "mock",
        },
      });
      return reply.code(401).send({
        error: "INVALID_STRIPE_WEBHOOK",
        message: "Webhook signature verification failed",
      });
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
      const sellerNetworkName = x402Config.network.startsWith("eip155:")
        ? "base"
        : (x402Config.network as string);
      const sellerWalletAddress = await db
        .select({ walletAddress: userWallets.walletAddress })
        .from(userWallets)
        .where(
          and(eq(userWallets.userId, intent.seller_id), eq(userWallets.network, sellerNetworkName)),
        )
        .limit(1)
        .then((rows) => rows[0]?.walletAddress ?? process.env.HAGGLE_X402_SELLER_WALLET ?? null);
      if (!sellerWalletAddress || !isAddress(sellerWalletAddress)) {
        return reply.code(400).send({ error: "SELLER_WALLET_NOT_RESOLVED" });
      }
      const idempotency = await beginPaymentOperationIdempotency(
        db,
        request,
        reply,
        "payment.stripe_onramp_session",
        intent.id,
      );
      if (idempotency.replayed) return;

      const amountMinor = intent.amount.amount_minor;
      const buyerPayment = buildPaymentQuoteConfirmation(
        { ...intent, selected_rail: "stripe" },
        {},
      );
      const destinationSettlementAmount = toSettlementAssetMoney(intent.amount, "USDC");

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
            destination_amount_minor: String(destinationSettlementAmount.amount_minor),
            destination_amount_usd_minor: String(amountMinor),
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
        const intentRow = await getPaymentIntentRowById(db, intent.id);
        const providerContext =
          intentRow?.providerContext &&
          typeof intentRow.providerContext === "object" &&
          !Array.isArray(intentRow.providerContext)
            ? intentRow.providerContext
            : {};
        await setPaymentIntentProviderContext(db, intent.id, {
          ...providerContext,
          seller_wallet: sellerWalletAddress,
          stripe_onramp: {
            ...getStripeOnrampContext(providerContext),
            status: "SESSION_CREATED",
            session_id: session.sessionId,
            destination_wallet: parsed.data.destination_wallet,
            destination_network: "base",
            destination_currency: "usdc",
            destination_amount_minor: String(destinationSettlementAmount.amount_minor),
            destination_amount_usd_minor: String(amountMinor),
            buyer_total_minor: String(buyerPayment.buyer_total.amount_minor),
            buyer_fee_minor: String(buyerPayment.fees.buyer_fee_total.amount_minor),
            seller_receives_minor: String(buyerPayment.seller_receives.amount_minor),
            seller_fee_minor: String(buyerPayment.fees.seller_fee_total.amount_minor),
            created_at: new Date().toISOString(),
          },
        });
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
    const stagingMockOptIn =
      process.env.HAGGLE_ENV === "staging" &&
      process.env.HAGGLE_ENABLE_STAGING_MOCK_PAYMENTS === "true";
    const stripeModeReal = config.stripeMode === "real";
    // Onramp session creation hits Stripe Crypto Onramp when STRIPE_SECRET_KEY is set.
    // Test cards (4242…) only work when keys are test-mode; live keys reject them.
    const testCardsExpected = config.enabled && config.keyMode === "test";
    return reply.send({
      available: config.enabled,
      provider: "stripe",
      stripe_mode: config.stripeMode,
      stripe_key_mode: config.keyMode,
      staging_mock_payments_opt_in: stagingMockOptIn,
      // Dogfood hint: true only when sk_test_/pk_test_ are configured.
      test_cards_expected: testCardsExpected,
      stripe_mode_real: stripeModeReal,
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
      notes: [
        "Haggle never accepts or stores card PANs; card entry is Stripe Onramp only.",
        "MCP haggle_create_checkout returns a web checkout_url only.",
        "Staging dogfood: STRIPE_MODE=real + sk_test_/pk_test_ + staging webhook.",
      ],
    });
  });
}
