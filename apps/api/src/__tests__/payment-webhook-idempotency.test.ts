import Fastify, { type FastifyInstance } from "fastify";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPaymentRoutes } from "../routes/payments.js";
import {
  createPaymentSettlementRecord,
  getCommerceOrderByOrderId,
  getPaymentSettlementByPaymentIntentId,
  getPaymentIntentById,
  setPaymentIntentProviderContext,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord, getSettlementReleaseByOrderId } from "../services/settlement-release.service.js";
import { createShipmentRecord, getShipmentByOrderId } from "../services/shipment-record.service.js";
import { writeAuditLog } from "../services/admin-action-log.service.js";

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
    failIntent: vi.fn((intent) => ({
      intent: {
        ...intent,
        status: "FAILED",
        updated_at: new Date().toISOString(),
      },
      trust_triggers: [],
    })),
    cancelIntent: vi.fn((intent) => ({
      intent: {
        ...intent,
        status: "CANCELED",
        updated_at: new Date().toISOString(),
      },
      trust_triggers: [],
    })),
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
  getInProgressPaymentOperationForIntent: vi.fn().mockResolvedValue(null),
  getPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn(),
  getPaymentIntentRowById: vi.fn(),
  getSettlementApprovalById: vi.fn(),
  setPaymentIntentProviderContext: vi.fn().mockResolvedValue(undefined),
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
const mockSetPaymentIntentProviderContext = vi.mocked(setPaymentIntentProviderContext);
const mockUpdateStoredPaymentIntent = vi.mocked(updateStoredPaymentIntent);
const mockCreatePaymentSettlementRecord = vi.mocked(createPaymentSettlementRecord);
const mockGetPaymentSettlementByPaymentIntentId = vi.mocked(getPaymentSettlementByPaymentIntentId);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockCreateSettlementReleaseRecord = vi.mocked(createSettlementReleaseRecord);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);
const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockWriteAuditLog = vi.mocked(writeAuditLog);

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

function paymentIntent(
  status: "CREATED" | "QUOTED" | "AUTHORIZED" | "SETTLEMENT_PENDING" | "SETTLED" | "FAILED" | "CANCELED" = "SETTLEMENT_PENDING",
) {
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

function signedX402Webhook(
  payload: Record<string, unknown>,
  secret = "x402_webhook_secret",
  timestamp = new Date().toISOString(),
) {
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return {
    payload: rawBody,
    headers: {
      "content-type": "application/json",
      "x-haggle-x402-signature": `sha256=${signature}`,
      "x-haggle-x402-timestamp": timestamp,
    },
  };
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
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: "payment.webhook_rejected",
        targetType: "payment_webhook",
        targetId: "evt_wrong_env",
        payload: expect.objectContaining({
          type: "webhook_rejected",
          provider_event_id: "evt_wrong_env",
          payment_intent_id: "pi_123",
          reason: "environment_mismatch",
          metadata: expect.objectContaining({ provider: "x402" }),
        }),
      }),
    );
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects signed x402 webhooks without timestamp before processing", async () => {
    vi.stubEnv("HAGGLE_X402_WEBHOOK_SECRET", "x402_webhook_secret");
    const payload = JSON.stringify({
      event_id: "evt_missing_timestamp",
      event_type: "settlement.confirmed",
      payment_intent_id: "pi_123",
    });
    const signature = createHmac("sha256", "x402_webhook_secret")
      .update(payload)
      .digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: {
        "content-type": "application/json",
        "x-haggle-x402-signature": `sha256=${signature}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "INVALID_X402_WEBHOOK" });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: "payment.webhook_rejected",
        targetType: "payment_webhook",
        payload: expect.objectContaining({
          type: "webhook_rejected",
          reason: "signature_verification_failed",
          metadata: expect.objectContaining({ provider: "x402" }),
        }),
      }),
    );
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects stale signed x402 webhooks before processing", async () => {
    vi.stubEnv("HAGGLE_X402_WEBHOOK_SECRET", "x402_webhook_secret");
    const signed = signedX402Webhook(
      {
        event_id: "evt_stale",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
      "x402_webhook_secret",
      new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    );

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: signed.headers,
      payload: signed.payload,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "INVALID_X402_WEBHOOK" });
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("accepts fresh timestamp-bound x402 webhook signatures", async () => {
    vi.stubEnv("HAGGLE_X402_WEBHOOK_SECRET", "x402_webhook_secret");
    const signed = signedX402Webhook({
      event_id: "evt_fresh_signed",
      event_type: "settlement.confirmed",
      payment_intent_id: "pi_unknown",
    });

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: signed.headers,
      payload: signed.payload,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, action: "ignored", reason: "unknown_intent" });
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actionType: "payment.webhook_received",
        targetType: "payment_webhook",
        targetId: "evt_fresh_signed",
        payload: expect.objectContaining({
          type: "webhook_received",
          provider_event_id: "evt_fresh_signed",
          payment_intent_id: "pi_unknown",
          reason: "validated_webhook_received",
          metadata: expect.objectContaining({
            provider: "x402",
            event_type: "settlement.confirmed",
          }),
        }),
      }),
    );
    expect(mockGetPaymentIntentById).toHaveBeenCalledWith(expect.anything(), "pi_unknown");
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
      local_production_status: "pending",
    });
    expect(mockSetPaymentIntentProviderContext).toHaveBeenCalledWith(
      expect.anything(),
      "pi_123",
      expect.objectContaining({
        reconciliation_needed: expect.objectContaining({
          provider: "x402",
          provider_event_id: "evt_out_of_order_settlement",
          event_type: "settlement.confirmed",
          reason: "settlement_confirmed_before_authorization",
          local_status: "CREATED",
          local_production_status: "pending",
        }),
      }),
    );
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentSettlementRecord).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("requires reconciliation instead of failing a locally settled x402 intent from a late provider failure", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent("SETTLED"));

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_late_failed_after_settled",
        event_type: "settlement.failed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      accepted: false,
      action: "reconciliation_required",
      reason: "terminal_event_after_local_capture",
      local_status: "SETTLED",
      local_production_status: "captured",
    });
    expect(mockSetPaymentIntentProviderContext).toHaveBeenCalledWith(
      expect.anything(),
      "pi_123",
      expect.objectContaining({
        reconciliation_needed: expect.objectContaining({
          provider: "x402",
          provider_event_id: "evt_late_failed_after_settled",
          event_type: "settlement.failed",
          reason: "terminal_event_after_local_capture",
          local_status: "SETTLED",
          local_production_status: "captured",
        }),
      }),
    );
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("requires reconciliation instead of expiring a locally settled x402 intent", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent("SETTLED"));

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_late_expired_after_settled",
        event_type: "payment.expired",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      accepted: false,
      action: "reconciliation_required",
      reason: "terminal_event_after_local_capture",
      local_status: "SETTLED",
      local_production_status: "captured",
    });
    expect(mockSetPaymentIntentProviderContext).toHaveBeenCalledWith(
      expect.anything(),
      "pi_123",
      expect.objectContaining({
        reconciliation_needed: expect.objectContaining({
          provider: "x402",
          provider_event_id: "evt_late_expired_after_settled",
          event_type: "payment.expired",
          reason: "terminal_event_after_local_capture",
        }),
      }),
    );
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("does not run fulfillment from a late x402 settlement confirmation after refund", async () => {
    const refundedIntent = paymentIntent("SETTLED") as unknown as Record<string, unknown>;
    mockGetPaymentIntentById.mockResolvedValueOnce({
      ...refundedIntent,
      production_status: "refunded",
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_late_confirmed_after_refund",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      accepted: false,
      action: "reconciliation_required",
      reason: "settlement_confirmed_after_reversal_or_dispute",
      local_status: "SETTLED",
      local_production_status: "refunded",
    });
    expect(mockCreateSettlementReleaseRecord).not.toHaveBeenCalled();
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("requires reconciliation instead of expiring an x402 intent after settlement started", async () => {
    mockGetPaymentIntentById.mockResolvedValueOnce(paymentIntent("SETTLEMENT_PENDING"));

    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_expired_while_settlement_pending",
        event_type: "payment.expired",
        payment_intent_id: "pi_123",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      accepted: false,
      action: "reconciliation_required",
      reason: "expiry_event_after_settlement_started",
      local_status: "SETTLEMENT_PENDING",
      local_production_status: "authorized",
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
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
