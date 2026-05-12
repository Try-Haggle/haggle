import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPaymentRoutes } from "../routes/payments.js";
import {
  createPaymentSettlementRecord,
  getCommerceOrderByOrderId,
  getPaymentSettlementByPaymentIntentId,
  getPaymentIntentById,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord, getSettlementReleaseByOrderId } from "../services/settlement-release.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";

vi.mock("../payments/providers.js", () => ({
  createPaymentServiceFromEnv: vi.fn(() => ({
    markSettlementPending: vi.fn((intent) => ({
      intent: {
        ...intent,
        status: "SETTLEMENT_PENDING",
        updated_at: new Date().toISOString(),
      },
      trust_triggers: [],
    })),
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
  createAgentPaymentGrantRecord: vi.fn().mockResolvedValue(null),
  getAgentPaymentGrantById: vi.fn().mockResolvedValue(null),
  createPaymentDisclosureRecord: vi.fn().mockResolvedValue(null),
  createPaymentAuthorizationRecord: vi.fn(),
  completePaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(undefined),
  createPaymentSettlementRecord: vi.fn(),
  createRefundRecord: vi.fn(),
  createStoredPaymentIntent: vi.fn(),
  ensureCommerceOrderForApproval: vi.fn(),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue({ id: "order_123", status: "PAYMENT_PENDING" }),
  getPaymentSettlementByPaymentIntentId: vi.fn().mockResolvedValue(null),
  getPaymentIntentById: vi.fn(),
  getPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn(),
  getPaymentIntentRowById: vi.fn(),
  getSettlementApprovalById: vi.fn(),
  updateCommerceOrderStatus: vi.fn(),
  updateStoredPaymentIntent: vi.fn(),
  createPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
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

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

const mockGetPaymentIntentById = vi.mocked(getPaymentIntentById);
const mockUpdateStoredPaymentIntent = vi.mocked(updateStoredPaymentIntent);
const mockCreatePaymentSettlementRecord = vi.mocked(createPaymentSettlementRecord);
const mockGetPaymentSettlementByPaymentIntentId = vi.mocked(getPaymentSettlementByPaymentIntentId);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockCreateSettlementReleaseRecord = vi.mocked(createSettlementReleaseRecord);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);
const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);

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

function paymentIntent(status: "CREATED" | "AUTHORIZED" | "SETTLEMENT_PENDING" | "SETTLED" = "SETTLEMENT_PENDING") {
  return {
    id: "pi_123",
    order_id: "order_123",
    seller_id: "seller_123",
    buyer_id: "buyer_123",
    selected_rail: "x402",
    allowed_rails: ["x402"],
    buyer_authorization_mode: "human_wallet",
    amount: { currency: "USD", amount_minor: 1000 },
    status,
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
    vi.unstubAllEnvs();
    await app.close();
  });

  it("rejects x402 webhooks from the wrong environment before processing", async () => {
    vi.stubEnv("HAGGLE_X402_WEBHOOK_ENV", "live");

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_wrong_env",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
        environment: "test",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "WEBHOOK_ENVIRONMENT_MISMATCH",
      expected: "live",
      received: "test",
    });
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
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
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
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

  it("marks authorized x402 payments settlement pending before processing settlement-confirmed webhooks", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent("AUTHORIZED"));
    mockUpdateStoredPaymentIntent.mockResolvedValue(null);
    mockCreatePaymentSettlementRecord.mockResolvedValueOnce(null as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_authorized_settlement",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("settled");
    expect(mockUpdateStoredPaymentIntent).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ status: "SETTLEMENT_PENDING" }),
    );
    expect(mockUpdateStoredPaymentIntent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ status: "SETTLED" }),
      {},
    );
    expect(mockCreateSettlementReleaseRecord).toHaveBeenCalled();
    expect(mockCreateShipmentRecord).toHaveBeenCalledWith(expect.anything(), "order_123", "seller_123", "buyer_123");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("requires reconciliation for out-of-order settlement-confirmed webhooks before authorization", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent("CREATED"));

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_out_of_order_settlement",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      accepted: false,
      action: "reconciliation_required",
      reason: "settlement_confirmed_before_authorization",
      local_status: "CREATED",
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentSettlementRecord).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not mark an already-settled webhook processed when the settlement record is missing", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent("SETTLED"));
    mockGetPaymentSettlementByPaymentIntentId.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_settled_missing_record",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().accepted).toBe(false);
    expect(mockCreateSettlementReleaseRecord).not.toHaveBeenCalled();
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("advances a paid order to fulfillment pending when a retry finds an existing shipment", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent());
    mockUpdateStoredPaymentIntent.mockResolvedValueOnce(null);
    mockCreatePaymentSettlementRecord.mockResolvedValueOnce(null as never);
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({ id: "order_123", status: "PAID" } as never);
    mockGetShipmentByOrderId.mockResolvedValueOnce({ id: "shipment_existing", order_id: "order_123" } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_retry_existing_shipment",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("settled");
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalledWith(expect.anything(), "order_123", "PAID");
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(expect.anything(), "order_123", "FULFILLMENT_PENDING");
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("does not move an already active fulfillment order back to fulfillment pending", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent());
    mockUpdateStoredPaymentIntent.mockResolvedValueOnce(null);
    mockCreatePaymentSettlementRecord.mockResolvedValueOnce(null as never);
    mockGetSettlementReleaseByOrderId.mockResolvedValueOnce({ id: "sr_existing", order_id: "order_123" } as never);
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({ id: "order_123", status: "FULFILLMENT_ACTIVE" } as never);
    mockGetShipmentByOrderId.mockResolvedValueOnce({ id: "shipment_existing", order_id: "order_123" } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_late_settlement_after_fulfillment",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toBe("settled");
    expect(mockCreateSettlementReleaseRecord).not.toHaveBeenCalled();
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
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
