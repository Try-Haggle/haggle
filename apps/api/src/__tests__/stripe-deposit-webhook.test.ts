import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPaymentRoutes } from "../routes/payments.js";
import { getDepositById, updateDepositStatus } from "../services/dispute-deposit.service.js";
import {
  createPaymentSettlementRecord,
  getCommerceOrderByOrderId,
  getPaymentSettlementByPaymentIntentId,
  getPaymentIntentById,
  getPaymentIntentRowById,
  setPaymentIntentProviderContext,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord, getSettlementReleaseByOrderId } from "../services/settlement-release.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";
import { writeAuditLog } from "../services/admin-action-log.service.js";
import { completeWebhookEvent } from "../services/webhook-event-claim.service.js";

const stripeEvent = {
  id: "evt_stripe_deposit_1",
  type: "crypto.onramp_session.fulfillment_complete",
  data: {
    object: {
      id: "cos_deposit_1",
      metadata: {
        payment_intent_id: "deposit_dep_1",
      } as Record<string, string>,
    },
  },
};

vi.mock("../payments/providers.js", () => ({
  createPaymentServiceFromEnv: vi.fn(() => ({})),
  getX402EnvConfig: vi.fn(() => ({
    mode: "mock",
    network: "eip155:8453",
    assetAddress: "USDC",
  })),
  getRealStripeAdapterOrNull: vi.fn(() => ({
    constructWebhookEvent: vi.fn(() => stripeEvent),
  })),
}));

vi.mock("../payments/real-stripe-adapter.js", () => ({
  RealStripeAdapter: {
    isOnrampFulfillmentComplete: vi.fn((event: { type: string }) =>
      event.type === "crypto.onramp_session.fulfillment_complete",
    ),
    extractPaymentIntentId: vi.fn((event: typeof stripeEvent) =>
      event.data.object.metadata.payment_intent_id,
    ),
  },
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositById: vi.fn(),
  updateDepositStatus: vi.fn(),
}));

vi.mock("../services/payment-record.service.js", () => ({
  createAgentPaymentGrantRecord: vi.fn().mockResolvedValue(null),
  getAgentPaymentGrantById: vi.fn().mockResolvedValue(null),
  createPaymentDisclosureRecord: vi.fn().mockResolvedValue(null),
  createPaymentAuthorizationRecord: vi.fn(),
  completePaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(undefined),
  createPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn(),
  createRefundRecord: vi.fn(),
  createStoredPaymentIntent: vi.fn(),
  ensureCommerceOrderForApproval: vi.fn(),
  getCommerceOrderByOrderId: vi.fn(),
  getPaymentSettlementByPaymentIntentId: vi.fn(),
  getPaymentIntentById: vi.fn(),
  getInProgressPaymentOperationForIntent: vi.fn().mockResolvedValue(null),
  getPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn(),
  getPaymentIntentRowById: vi.fn(),
  getSettlementApprovalById: vi.fn(),
  setPaymentIntentProviderContext: vi.fn().mockResolvedValue(undefined),
  updateCommerceOrderStatus: vi.fn(),
  updateStoredPaymentIntent: vi.fn(),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn(),
  getSettlementReleaseByOrderId: vi.fn(),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn(),
  getShipmentByOrderId: vi.fn(),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn(),
}));

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/webhook-event-claim.service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/webhook-event-claim.service.js")>();
  return {
    ...actual,
    claimWebhookEvent: vi.fn().mockImplementation(async (_db, input) => ({
      outcome: "acquired",
      source: input.source,
      eventId: input.eventId,
      claimId: "22222222-2222-4222-8222-222222222222",
      attemptCount: 1,
    })),
    completeWebhookEvent: vi.fn().mockResolvedValue(true),
    failWebhookEvent: vi.fn().mockResolvedValue(undefined),
    startWebhookClaimHeartbeat: vi.fn(() => vi.fn()),
  };
});

const mockGetDepositById = vi.mocked(getDepositById);
const mockUpdateDepositStatus = vi.mocked(updateDepositStatus);
const mockGetPaymentIntentById = vi.mocked(getPaymentIntentById);
const mockGetPaymentIntentRowById = vi.mocked(getPaymentIntentRowById);
const mockSetPaymentIntentProviderContext = vi.mocked(setPaymentIntentProviderContext);
const mockCreatePaymentSettlementRecord = vi.mocked(createPaymentSettlementRecord);
const mockUpdateStoredPaymentIntent = vi.mocked(updateStoredPaymentIntent);
const mockGetPaymentSettlementByPaymentIntentId = vi.mocked(getPaymentSettlementByPaymentIntentId);
const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockCreateSettlementReleaseRecord = vi.mocked(createSettlementReleaseRecord);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);
const mockWriteAuditLog = vi.mocked(writeAuditLog);
const mockCompleteWebhookEvent = vi.mocked(completeWebhookEvent);

function buildDb() {
  return {
    query: {
      webhookIdempotency: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      paymentIntents: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
}

describe("stripe deposit webhook", () => {
  let app: FastifyInstance;
  let db: ReturnType<typeof buildDb>;

  beforeEach(async () => {
    vi.clearAllMocks();
    stripeEvent.id = "evt_stripe_deposit_1";
    stripeEvent.data.object.id = "cos_deposit_1";
    stripeEvent.data.object.metadata = {
      payment_intent_id: "deposit_dep_1",
    };
    db = buildDb();
    app = Fastify();
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (request, body, done) => {
        (request as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
        done(null, JSON.parse((body as Buffer).toString()));
      },
    );
    registerPaymentRoutes(app, db as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("marks a pending Stripe dispute deposit as deposited after onramp fulfillment", async () => {
    mockGetDepositById.mockResolvedValueOnce({
      id: "dep_1",
      status: "PENDING",
      metadata: {
        rail: "stripe",
        stripe_payment_intent_id: "cos_deposit_1",
      },
    } as unknown as Awaited<ReturnType<typeof getDepositById>>);
    mockUpdateDepositStatus.mockResolvedValueOnce({
      id: "dep_1",
      status: "DEPOSITED",
    } as Awaited<ReturnType<typeof updateDepositStatus>>);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/stripe",
      headers: { "stripe-signature": "sig" },
      payload: { ignored: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      accepted: true,
      action: "deposit_confirmed",
      deposit_id: "dep_1",
    }));
    expect(mockUpdateDepositStatus).toHaveBeenCalledWith(
      expect.anything(),
      "dep_1",
      "DEPOSITED",
      expect.objectContaining({
        depositedAt: expect.any(Date),
        metadata: expect.objectContaining({
          rail: "stripe",
          stripe_event_id: "evt_stripe_deposit_1",
          stripe_session_id: "cos_deposit_1",
        }),
      }),
    );
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: "payment.webhook_received",
        targetType: "payment_webhook",
        targetId: "evt_stripe_deposit_1",
        payload: expect.objectContaining({
          type: "webhook_received",
          provider_event_id: "evt_stripe_deposit_1",
          reason: "validated_webhook_received",
          metadata: expect.objectContaining({
            provider: "stripe",
            event_type: "crypto.onramp_session.fulfillment_complete",
          }),
        }),
      }),
    );
    expect(mockCompleteWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("records Stripe onramp fulfillment without treating it as contract settlement", async () => {
    stripeEvent.id = "evt_stripe_payment_retry";
    stripeEvent.data.object.id = "cos_payment_retry";
    stripeEvent.data.object.metadata = {
      payment_intent_id: "pi_stripe_retry",
      order_id: "order_123",
      approval_policy_hash: "sha256:policy",
      destination_amount_minor: "1000",
    };
    mockGetPaymentIntentById.mockResolvedValueOnce({
      id: "pi_stripe_retry",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "buyer_123",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      buyer_authorization_mode: "human_wallet",
      amount: { currency: "USD", amount_minor: 1000 },
      approval_policy_hash: "sha256:policy",
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: { existing: true },
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/stripe",
      headers: { "stripe-signature": "sig" },
      payload: { ignored: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      accepted: true,
      action: "onramp_funded",
      payment_intent_id: "pi_stripe_retry",
      next_action: "fund_conditional_settlement",
    }));
    expect(mockSetPaymentIntentProviderContext).toHaveBeenCalledWith(
      expect.anything(),
      "pi_stripe_retry",
      expect.objectContaining({
        existing: true,
        stripe_onramp: expect.objectContaining({
          status: "ONRAMP_FUNDED",
          session_id: "cos_payment_retry",
          event_id: "evt_stripe_payment_retry",
          destination_amount_minor: "1000",
        }),
      }),
    );
    expect(mockGetPaymentSettlementByPaymentIntentId).not.toHaveBeenCalled();
    expect(mockCreateSettlementReleaseRecord).not.toHaveBeenCalled();
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(mockCompleteWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("accepts Stripe onramp fulfillment before contract funding and records wallet-funded context", async () => {
    stripeEvent.id = "evt_stripe_before_auth";
    stripeEvent.data.object.id = "cos_payment_before_auth";
    stripeEvent.data.object.metadata = {
      payment_intent_id: "pi_stripe_before_auth",
      order_id: "order_123",
      approval_policy_hash: "sha256:policy",
    };
    mockGetPaymentIntentById.mockResolvedValueOnce({
      id: "pi_stripe_before_auth",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "buyer_123",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      buyer_authorization_mode: "human_wallet",
      amount: { currency: "USD", amount_minor: 1000 },
      approval_policy_hash: "sha256:policy",
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {},
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/stripe",
      headers: { "stripe-signature": "sig" },
      payload: { ignored: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      accepted: true,
      action: "onramp_funded",
      payment_intent_id: "pi_stripe_before_auth",
      next_action: "fund_conditional_settlement",
    });
    expect(mockSetPaymentIntentProviderContext).toHaveBeenCalledWith(
      expect.anything(),
      "pi_stripe_before_auth",
      expect.objectContaining({
        stripe_onramp: expect.objectContaining({
          status: "ONRAMP_FUNDED",
          session_id: "cos_payment_before_auth",
          event_id: "evt_stripe_before_auth",
        }),
      }),
    );
    expect(mockCreatePaymentSettlementRecord).not.toHaveBeenCalled();
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCompleteWebhookEvent).toHaveBeenCalledTimes(1);
  });
});
