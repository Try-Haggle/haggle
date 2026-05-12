import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPaymentRoutes } from "../routes/payments.js";
import { getDepositById, updateDepositStatus } from "../services/dispute-deposit.service.js";
import {
  getCommerceOrderByOrderId,
  getPaymentSettlementByPaymentIntentId,
  getPaymentIntentById,
  updateCommerceOrderStatus,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord, getSettlementReleaseByOrderId } from "../services/settlement-release.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";

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
  getPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn(),
  getPaymentIntentRowById: vi.fn(),
  getSettlementApprovalById: vi.fn(),
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

const mockGetDepositById = vi.mocked(getDepositById);
const mockUpdateDepositStatus = vi.mocked(updateDepositStatus);
const mockGetPaymentIntentById = vi.mocked(getPaymentIntentById);
const mockGetPaymentSettlementByPaymentIntentId = vi.mocked(getPaymentSettlementByPaymentIntentId);
const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockCreateSettlementReleaseRecord = vi.mocked(createSettlementReleaseRecord);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);

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
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("runs payment finalization for an already settled Stripe intent before marking the webhook processed", async () => {
    stripeEvent.id = "evt_stripe_payment_retry";
    stripeEvent.data.object.id = "cos_payment_retry";
    stripeEvent.data.object.metadata = {
      payment_intent_id: "pi_stripe_retry",
      order_id: "order_123",
      approval_policy_hash: "sha256:policy",
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
    mockGetPaymentSettlementByPaymentIntentId.mockResolvedValueOnce({
      id: "settlement_existing",
      payment_intent_id: "pi_stripe_retry",
      rail: "stripe",
      provider_reference: "stripe_settle_existing",
      settled_amount: { currency: "USD", amount_minor: 1000 },
      settled_at: new Date().toISOString(),
      status: "SETTLED",
    });
    mockGetSettlementReleaseByOrderId.mockResolvedValueOnce({ id: "sr_existing", order_id: "order_123" } as never);
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({ id: "order_123", status: "PAID" } as never);
    mockGetShipmentByOrderId.mockResolvedValueOnce({ id: "shipment_existing", order_id: "order_123" } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/stripe",
      headers: { "stripe-signature": "sig" },
      payload: { ignored: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      accepted: true,
      action: "settled",
      payment_intent_id: "pi_stripe_retry",
    }));
    expect(mockCreateSettlementReleaseRecord).not.toHaveBeenCalled();
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(expect.anything(), "order_123", "FULFILLMENT_PENDING");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});
