import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPaymentRoutes } from "../routes/payments.js";
import {
  createPaymentSettlementRecord,
  getPaymentIntentById,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord } from "../services/settlement-release.service.js";
import { createShipmentRecord } from "../services/shipment-record.service.js";

vi.mock("../payments/providers.js", () => ({
  createPaymentServiceFromEnv: vi.fn(() => ({
    settleIntent: vi.fn().mockResolvedValue({
      intent: {
        id: "pi_123",
        order_id: "order_123",
        seller_id: "seller_123",
        buyer_id: "buyer_123",
        selected_rail: "x402",
        allowed_rails: ["x402"],
        buyer_authorization_mode: "human_wallet",
        amount: { currency: "USD", amount_minor: 1000 },
        status: "SETTLED",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      value: {
        id: "settlement_123",
        payment_intent_id: "pi_123",
        rail: "x402",
        provider_reference: "provider_ref",
        settled_amount: { currency: "USD", amount_minor: 1000 },
        settled_at: new Date().toISOString(),
        status: "SETTLED",
      },
      metadata: {},
      trust_triggers: [],
    }),
  })),
  getRealStripeAdapterOrNull: vi.fn(() => null),
  getX402EnvConfig: vi.fn(() => ({
    mode: "mock",
    network: "eip155:8453",
    assetAddress: "USDC",
  })),
}));

vi.mock("../services/payment-record.service.js", () => ({
  createPaymentAuthorizationRecord: vi.fn(),
  createPaymentSettlementRecord: vi.fn(),
  createRefundRecord: vi.fn(),
  createStoredPaymentIntent: vi.fn(),
  ensureCommerceOrderForApproval: vi.fn(),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue({ id: "order_123", status: "PAYMENT_PENDING" }),
  getPaymentIntentById: vi.fn(),
  getPaymentIntentByOrderId: vi.fn(),
  getPaymentIntentRowById: vi.fn(),
  getSettlementApprovalById: vi.fn(),
  updateCommerceOrderStatus: vi.fn(),
  updateStoredPaymentIntent: vi.fn(),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn().mockImplementation(async (_db, release) => release),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn().mockResolvedValue({ id: "shipment_123", order_id: "order_123" }),
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn(),
}));

const mockGetPaymentIntentById = vi.mocked(getPaymentIntentById);
const mockUpdateStoredPaymentIntent = vi.mocked(updateStoredPaymentIntent);
const mockCreatePaymentSettlementRecord = vi.mocked(createPaymentSettlementRecord);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockCreateSettlementReleaseRecord = vi.mocked(createSettlementReleaseRecord);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);

function buildDb() {
  const insert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  });

  return {
    insert,
    query: {
      webhookIdempotency: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      paymentIntents: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
}

function paymentIntent() {
  return {
    id: "pi_123",
    order_id: "order_123",
    seller_id: "seller_123",
    buyer_id: "buyer_123",
    selected_rail: "x402",
    allowed_rails: ["x402"],
    buyer_authorization_mode: "human_wallet",
    amount: { currency: "USD", amount_minor: 1000 },
    status: "SETTLEMENT_PENDING",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as never;
}

describe("payment webhook idempotency", () => {
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

  it("does not mark an x402 webhook processed when settlement persistence fails", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent());
    mockUpdateStoredPaymentIntent.mockResolvedValueOnce(null);
    mockCreatePaymentSettlementRecord.mockRejectedValueOnce(new Error("db down"));

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_123",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().accepted).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("marks an x402 webhook processed only after settlement persistence succeeds", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent());
    mockUpdateStoredPaymentIntent.mockResolvedValueOnce(null);
    mockCreatePaymentSettlementRecord.mockResolvedValueOnce(null as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_456",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("settled");
    expect(mockCreateSettlementReleaseRecord).toHaveBeenCalled();
    expect(mockCreateShipmentRecord).toHaveBeenCalledWith(expect.anything(), "order_123", "seller_123", "buyer_123");
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(expect.anything(), "order_123", "PAID");
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(expect.anything(), "order_123", "FULFILLMENT_PENDING");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("does not mark an x402 webhook processed when post-settlement finalization fails", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent());
    mockUpdateStoredPaymentIntent.mockResolvedValueOnce(null);
    mockCreatePaymentSettlementRecord.mockResolvedValueOnce(null as never);
    mockCreateSettlementReleaseRecord.mockRejectedValueOnce(new Error("release down"));

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_789",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().accepted).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
