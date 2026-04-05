import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SettlementApproval } from "@haggle/commerce-core";
import type { Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";

// ---------------------------------------------------------------------------
// Webhook idempotency cache (MVP: in-memory Set with TTL cleanup)
// Prevents duplicate processing when x402 facilitator retries webhooks.
// ---------------------------------------------------------------------------
const WEBHOOK_TTL_MS = 60 * 60 * 1000; // 1 hour
const processedWebhookEvents = new Set<string>();

function markWebhookProcessed(eventId: string): void {
  processedWebhookEvents.add(eventId);
  setTimeout(() => {
    processedWebhookEvents.delete(eventId);
  }, WEBHOOK_TTL_MS);
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
} from "../services/settlement-release.service.js";
import { createPaymentServiceFromEnv, getX402EnvConfig } from "../payments/providers.js";
import {
  createPaymentAuthorizationRecord,
  createPaymentSettlementRecord,
  createRefundRecord,
  createStoredPaymentIntent,
  ensureCommerceOrderForApproval,
  getPaymentIntentById,
  getSettlementApprovalById,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createShipmentRecord } from "../services/shipment-record.service.js";
import { createX402PaymentRequirement } from "../payments/x402-requirements.js";
import { X402FacilitatorClient } from "../payments/facilitator-client.js";
import { applyTrustTriggers } from "../services/trust-ledger.service.js";

const settlementApprovalSchema = z.object({
  id: z.string(),
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
    listing_id: z.string(),
    seller_id: z.string(),
    buyer_id: z.string(),
    final_amount_minor: z.number(),
    currency: z.string(),
    selected_payment_rail: z.enum(["x402", "stripe"]),
    shipment_input_due_at: z.string().optional(),
  }),
  hold_snapshot: z.any().optional(),
  buyer_approved_at: z.string().optional(),
  seller_approved_at: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

const preparePaymentSchema = z
  .object({
    settlement_approval_id: z.string().optional(),
    settlement_approval: settlementApprovalSchema.optional(),
    buyer_authorization_mode: z.enum(["human_wallet", "agent_wallet"]).optional(),
  })
  .refine((value) => Boolean(value.settlement_approval_id || value.settlement_approval), {
    message: "settlement_approval_id or settlement_approval is required",
    path: ["settlement_approval_id"],
  });

const refundSchema = z.object({
  payment_intent_id: z.string(),
  amount_minor: z.number().int().positive(),
  currency: z.string(),
  reason_code: z.string(),
});

const x402SubmitSchema = z.object({
  payment_payload: z.object({
    x402Version: z.literal(1),
    scheme: z.literal("exact"),
    network: z.string(),
    payload: z.record(z.any()),
    paymentRequirements: z.any().optional(),
  }),
  verify_only: z.boolean().optional(),
});

function requireWebhookSignature(headers: Record<string, unknown>, provider: "x402" | "stripe") {
  const key =
    provider === "x402"
      ? (headers["x-haggle-x402-signature"] as string | undefined)
      : (headers["stripe-signature"] as string | undefined);

  if (!key || typeof key !== "string") {
    throw new Error(`missing ${provider} webhook signature`);
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
async function autoCreateSettlementRelease(
  db: Database,
  intent: PaymentIntent,
  declaredWeightOz?: number,
) {
  try {
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

    await createSettlementReleaseRecord(db, release);
    return release;
  } catch {
    // Non-critical: log but don't fail the settlement
    return null;
  }
}

/**
 * Auto-create a shipment record after payment settles.
 * Non-critical — failures are swallowed so the settlement response is not affected.
 */
async function autoCreateShipment(db: Database, intent: PaymentIntent) {
  try {
    return await createShipmentRecord(db, intent.order_id, intent.seller_id, intent.buyer_id);
  } catch {
    // Non-critical: log but don't fail the settlement
    return null;
  }
}

export function registerPaymentRoutes(app: FastifyInstance, db: Database) {
  const service = createPaymentServiceFromEnv();
  const x402Config = getX402EnvConfig();
  const x402Facilitator =
    x402Config.facilitatorUrl && x402Config.mode === "real"
      ? new X402FacilitatorClient(x402Config.facilitatorUrl, x402Config.apiKeyId, x402Config.apiKeySecret)
      : null;

  // ─── GET payment by ID ──────────────────────────────────────
  app.get<{ Params: { id: string } }>("/payments/:id", async (request, reply) => {
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

    const order = await ensureCommerceOrderForApproval(db, settlementApproval);

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

  app.post("/payments/:id/quote", { preHandler: [requireAuth] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
    }
    const result = await service.quoteIntent(intent);
    await updateStoredPaymentIntent(db, result.intent, result.metadata);
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

  app.get("/payments/:id/x402/requirements", async (request, reply) => {
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

  app.post("/payments/:id/x402/submit-signature", { preHandler: [requireAuth] }, async (request, reply) => {
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
    // Auto-create Settlement Release (Payment Protection)
    const settlementRelease = await autoCreateSettlementRelease(db, result.intent);

    // Auto-transition order status and create shipment
    await updateCommerceOrderStatus(db, result.intent.order_id, "PAID");
    const shipment = await autoCreateShipment(db, result.intent);
    if (shipment) {
      await updateCommerceOrderStatus(db, result.intent.order_id, "FULFILLMENT_PENDING");
    }

    return reply.send({
      settlement: settle,
      payment: result,
      settlement_release: settlementRelease,
      shipment,
    });
  });

  app.post("/payments/:id/authorize", { preHandler: [requireAuth] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
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

  app.post("/payments/:id/settlement-pending", { preHandler: [requireAuth] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
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

  app.post("/payments/:id/settle", { preHandler: [requireAuth] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
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

    // Auto-create Settlement Release (Payment Protection)
    const settlementRelease = await autoCreateSettlementRelease(db, result.intent);

    // Auto-transition order status and create shipment
    await updateCommerceOrderStatus(db, result.intent.order_id, "PAID");
    const shipment = await autoCreateShipment(db, result.intent);
    if (shipment) {
      await updateCommerceOrderStatus(db, result.intent.order_id, "FULFILLMENT_PENDING");
    }

    return reply.send({ ...result, settlement_release: settlementRelease, shipment });
  });

  app.post("/payments/:id/fail", { preHandler: [requireAuth] }, async (request, reply) => {
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

  app.post("/payments/:id/cancel", { preHandler: [requireAuth] }, async (request, reply) => {
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

  app.post("/payments/:id/refund", { preHandler: [requireAuth] }, async (request, reply) => {
    const intent = await getPaymentIntentById(db, (request.params as { id: string }).id);
    if (!intent) {
      return reply.code(404).send({ error: "PAYMENT_INTENT_NOT_FOUND" });
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

  app.post("/payments/webhooks/x402", async (request, reply) => {
    try {
      requireWebhookSignature(request.headers as Record<string, unknown>, "x402");
    } catch (error) {
      return reply.code(400).send({ error: "INVALID_X402_WEBHOOK", message: error instanceof Error ? error.message : String(error) });
    }

    const body = request.body as { event_type?: string; payment_intent_id?: string; event_id?: string; id?: string; [key: string]: unknown };
    const eventType = body.event_type;
    const paymentIntentId = body.payment_intent_id;

    if (!eventType || !paymentIntentId) {
      return reply.code(400).send({ error: "MISSING_WEBHOOK_FIELDS" });
    }

    // Idempotency: derive a stable event ID and skip if already processed
    const webhookEventId = body.event_id ?? body.id ?? `${eventType}:${paymentIntentId}`;
    if (processedWebhookEvents.has(webhookEventId)) {
      return reply.send({ accepted: true, action: "duplicate", reason: "already_processed" });
    }

    const intent = await getPaymentIntentById(db, paymentIntentId);
    if (!intent) {
      // Ignore events for unknown intents (idempotent)
      return reply.send({ accepted: true, action: "ignored", reason: "unknown_intent" });
    }

    try {
      switch (eventType) {
        case "settlement.confirmed": {
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
          }
          markWebhookProcessed(webhookEventId);
          return reply.send({ accepted: true, action: "settled" });
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
          markWebhookProcessed(webhookEventId);
          return reply.send({ accepted: true, action: "failed" });
        }

        case "payment.expired": {
          if (intent.status !== "CANCELED" && intent.status !== "SETTLED") {
            const result = service.cancelIntent(intent);
            await updateStoredPaymentIntent(db, result.intent);
          }
          markWebhookProcessed(webhookEventId);
          return reply.send({ accepted: true, action: "expired" });
        }

        default:
          return reply.send({ accepted: true, action: "ignored", reason: "unknown_event" });
      }
    } catch (error) {
      // Log but don't fail — webhooks must return 200 to avoid retries
      console.error("x402 webhook processing error:", error);
      return reply.send({ accepted: true, action: "error", message: String(error) });
    }
  });

  app.post("/payments/webhooks/stripe", async (request, reply) => {
    try {
      requireWebhookSignature(request.headers as Record<string, unknown>, "stripe");
    } catch (error) {
      return reply.code(400).send({ error: "INVALID_STRIPE_WEBHOOK", message: error instanceof Error ? error.message : String(error) });
    }

    return reply.send({
      accepted: true,
      provider: "stripe",
      received_at: new Date().toISOString(),
      payload: request.body,
    });
  });
}
