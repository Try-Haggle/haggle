import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPaymentRoutes } from "../routes/payments.js";
import { getDepositById, updateDepositStatus } from "../services/dispute-deposit.service.js";

const stripeEvent = {
  id: "evt_stripe_deposit_1",
  type: "crypto.onramp_session.fulfillment_complete",
  data: {
    object: {
      id: "cos_deposit_1",
      metadata: {
        payment_intent_id: "deposit_dep_1",
      },
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
  createPaymentAuthorizationRecord: vi.fn(),
  createPaymentSettlementRecord: vi.fn(),
  createRefundRecord: vi.fn(),
  createStoredPaymentIntent: vi.fn(),
  ensureCommerceOrderForApproval: vi.fn(),
  getCommerceOrderByOrderId: vi.fn(),
  getPaymentIntentById: vi.fn(),
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

const mockGetDepositById = vi.mocked(getDepositById);
const mockUpdateDepositStatus = vi.mocked(updateDepositStatus);

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
});
