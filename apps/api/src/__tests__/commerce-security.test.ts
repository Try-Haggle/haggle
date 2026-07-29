import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { createPublicClient, decodeEventLog } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import authPlugin from "../middleware/auth.js";
import { registerDemoE2ERoutes } from "../routes/demo-e2e.js";
import { registerSettlementApprovalRoutes } from "../routes/settlement-approvals.js";
import { registerSettlementReleaseRoutes } from "../routes/settlement-releases.js";
import { getDisputeByOrderId } from "../services/dispute-record.service.js";
import {
  createPaymentSettlementRecord,
  getCommerceOrderByOrderId,
  getPaymentIntentById,
  getPaymentIntentByOrderId,
  getPaymentIntentRowById,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { getSettlementReleaseById } from "../services/settlement-release.service.js";
import { getShipmentByOrderId } from "../services/shipment-record.service.js";
import { ADMIN_HEADERS, AUTH_HEADERS } from "./helpers.js";

vi.mock("../services/payment-record.service.js", () => ({
  createAgentPaymentGrantRecord: vi.fn().mockResolvedValue(null),
  getAgentPaymentGrantById: vi.fn().mockResolvedValue(null),
  createPaymentDisclosureRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn(),
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getPaymentIntentRowById: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
  updateStoredPaymentIntent: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn(),
  getSettlementReleaseById: vi.fn(),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  updateSettlementReleaseRecord: vi.fn(),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/shipment-apv-payout-offset.service.js", () => ({
  reserveShipmentApvPayoutOffset: vi.fn().mockResolvedValue({ outcome: "not_found" }),
  bindShipmentApvPayoutOffsetSignature: vi.fn().mockResolvedValue({ outcome: "bound" }),
  cancelExpiredShipmentApvPayoutOffset: vi.fn().mockResolvedValue({ outcome: "not_found" }),
  completeShipmentApvPayoutOffset: vi.fn().mockResolvedValue({ outcome: "not_found" }),
}));

const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockCreatePaymentSettlementRecord = vi.mocked(createPaymentSettlementRecord);
const mockGetPaymentIntentById = vi.mocked(getPaymentIntentById);
const mockGetPaymentIntentRowById = vi.mocked(getPaymentIntentRowById);
const mockGetPaymentIntentByOrderId = vi.mocked(getPaymentIntentByOrderId);
const mockUpdateStoredPaymentIntent = vi.mocked(updateStoredPaymentIntent);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockGetDisputeByOrderId = vi.mocked(getDisputeByOrderId);
const mockGetSettlementReleaseById = vi.mocked(getSettlementReleaseById);
const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockDecodeEventLog = vi.mocked(decodeEventLog);

function buildDb(overrides: Record<string, unknown> = {}) {
  return {
    query: {
      commerceOrders: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      settlementApprovals: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    ...overrides,
  } as never;
}

async function buildApp(db = buildDb()): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin);
  registerSettlementReleaseRoutes(app, db);
  registerSettlementApprovalRoutes(app, db);
  registerDemoE2ERoutes(app, db);
  await app.ready();
  return app;
}

describe("commerce security boundaries", () => {
  let app: FastifyInstance;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalSupabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
  const originalConditionalSettlementAddress = process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
  const originalFeeWallet = process.env.HAGGLE_X402_FEE_WALLET;
  const originalFeeBps = process.env.HAGGLE_X402_FEE_BPS;
  const originalBaseRpcUrl = process.env.HAGGLE_BASE_RPC_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV;
    } else {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
    if (originalSupabaseJwtSecret === undefined) {
      delete process.env.SUPABASE_JWT_SECRET;
    } else {
      process.env.SUPABASE_JWT_SECRET = originalSupabaseJwtSecret;
    }
    if (originalConditionalSettlementAddress === undefined)
      delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    else process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS = originalConditionalSettlementAddress;
    if (originalFeeWallet === undefined) delete process.env.HAGGLE_X402_FEE_WALLET;
    else process.env.HAGGLE_X402_FEE_WALLET = originalFeeWallet;
    if (originalFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
    else process.env.HAGGLE_X402_FEE_BPS = originalFeeBps;
    if (originalBaseRpcUrl === undefined) delete process.env.HAGGLE_BASE_RPC_URL;
    else process.env.HAGGLE_BASE_RPC_URL = originalBaseRpcUrl;
  });

  afterEach(async () => {
    await app?.close();
  });

  it("requires auth before reading settlement releases", async () => {
    app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/settlement-releases/sr_123",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });

  it("rejects conditional release confirmation from an order non-seller", async () => {
    mockGetSettlementReleaseById.mockResolvedValueOnce({
      id: "sr_not_seller",
      order_id: "order_not_seller",
      payment_intent_id: "pi_not_seller",
    } as never);
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({
      id: "order_not_seller",
      buyerId: "test-user-001",
      sellerId: "different-seller",
      status: "DELIVERED",
    } as never);
    app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/sr_not_seller/conditional-release-confirmation",
      headers: AUTH_HEADERS,
      payload: { tx_hash: `0x${"ab".repeat(32)}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
  });

  it("rejects a signed conditional release request from an order non-seller", async () => {
    mockGetSettlementReleaseById.mockResolvedValueOnce({
      id: "sr_request_not_seller",
      order_id: "order_request_not_seller",
      payment_intent_id: "pi_request_not_seller",
    } as never);
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({
      id: "order_request_not_seller",
      buyerId: "test-user-001",
      sellerId: "different-seller",
      status: "DELIVERED",
    } as never);
    app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/sr_request_not_seller/conditional-release-request",
      headers: AUTH_HEADERS,
      payload: { seller_wallet_address: "0x2222222222222222222222222222222222222222" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "FORBIDDEN" });
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
  });

  it("rejects settlement release reads for non-participants", async () => {
    mockGetSettlementReleaseById.mockResolvedValueOnce({
      id: "sr_123",
      order_id: "order_123",
      payment_intent_id: "pi_123",
      product_amount: { currency: "USD", amount_minor: 1000 },
      product_release_status: "PENDING_DELIVERY",
      buffer_amount: { currency: "USD", amount_minor: 0 },
      buffer_release_status: "HELD",
      apv_adjustment_minor: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    app = await buildApp(
      buildDb({
        query: {
          commerceOrders: {
            findFirst: vi.fn().mockResolvedValue({
              id: "order_123",
              buyerId: "someone-else",
              sellerId: "another-user",
            }),
          },
          settlementApprovals: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      }),
    );

    const res = await app.inject({
      method: "GET",
      url: "/settlement-releases/sr_123",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("rejects settlement approval list queries for another user", async () => {
    app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/settlement-approvals?user_id=someone-else",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("rejects conditional release confirmation when the receipt lacks a matching release event", async () => {
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0xcccccccccccccccccccccccccccccccccccccccc";
    process.env.HAGGLE_X402_FEE_WALLET = "0xffffffffffffffffffffffffffffffffffffffff";
    process.env.HAGGLE_X402_FEE_BPS = "150";
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    const settlementId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sellerWallet = "0x2222222222222222222222222222222222222222";
    mockGetSettlementReleaseById.mockResolvedValueOnce({
      id: "sr_conditional",
      payment_intent_id: "pi_conditional",
      order_id: "order_123",
    } as never);
    mockGetPaymentIntentById.mockResolvedValueOnce({
      id: "pi_conditional",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "buyer_123",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 10_000 },
      status: "SETTLEMENT_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        conditional_settlement: {
          status: "FUNDING_CONFIRMED",
          settlement_id: settlementId,
          seller_wallet: sellerWallet,
        },
      },
    } as never);
    mockCreatePublicClient.mockReturnValueOnce({
      getBlockNumber: vi.fn().mockResolvedValue(101n),
      getBlock: vi.fn().mockResolvedValue({ hash: `0x${"cc".repeat(32)}` }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 100n,
        blockHash: `0x${"cc".repeat(32)}`,
        logs: [
          {
            address: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
            topics: ["0x1"],
            data: "0x",
          },
        ],
      }),
    } as never);
    mockDecodeEventLog.mockReturnValueOnce({ eventName: "SettlementRefunded", args: {} } as never);

    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/sr_conditional/conditional-release-confirmation",
      headers: ADMIN_HEADERS,
      payload: { tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "CONDITIONAL_RELEASE_EVENT_MISMATCH",
    });
    expect(mockUpdateStoredPaymentIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        conditional_settlement: expect.objectContaining({ status: "RELEASE_EVENT_MISMATCH" }),
      }),
    );
    expect(mockCreatePaymentSettlementRecord).not.toHaveBeenCalled();
  });

  it("records Stripe-funded conditional release as Stripe even when the stored intent rail is x402", async () => {
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0xcccccccccccccccccccccccccccccccccccccccc";
    process.env.HAGGLE_X402_FEE_WALLET = "0xffffffffffffffffffffffffffffffffffffffff";
    process.env.HAGGLE_X402_FEE_BPS = "500";
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    const settlementId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const sellerWallet = "0x2222222222222222222222222222222222222222";
    const feeWallet = "0xffffffffffffffffffffffffffffffffffffffff";
    mockGetSettlementReleaseById.mockResolvedValueOnce({
      id: "sr_stripe_conditional",
      payment_intent_id: "pi_stripe_conditional",
      order_id: "order_123",
    } as never);
    mockGetPaymentIntentById.mockResolvedValueOnce({
      id: "pi_stripe_conditional",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "buyer_123",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 10_000 },
      status: "SETTLEMENT_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        conditional_settlement: {
          status: "FUNDING_CONFIRMED",
          settlement_id: settlementId,
          seller_wallet: sellerWallet,
          release_seller_wallet: sellerWallet,
          release_fee_wallet: feeWallet,
          release_seller_amount_minor: "98500000",
          release_fee_amount_minor: "1500000",
          release_fee_bps: 150,
        },
        stripe_onramp: {
          status: "ONRAMP_FUNDED",
          session_id: "cos_123",
        },
      },
    } as never);
    mockCreatePublicClient.mockReturnValueOnce({
      getBlockNumber: vi.fn().mockResolvedValue(101n),
      getBlock: vi.fn().mockResolvedValue({ hash: `0x${"cc".repeat(32)}` }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 100n,
        blockHash: `0x${"cc".repeat(32)}`,
        logs: [
          {
            address: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
            topics: ["0x1"],
            data: "0x",
          },
        ],
      }),
    } as never);
    mockDecodeEventLog.mockReturnValueOnce({
      eventName: "SettlementReleased",
      args: {
        settlementId,
        sellerWallet,
        feeWallet,
        sellerAmount: 98_500_000n,
        feeAmount: 1_500_000n,
      },
    } as never);

    app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/settlement-releases/sr_stripe_conditional/conditional-release-confirmation",
      headers: ADMIN_HEADERS,
      payload: { tx_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreatePaymentSettlementRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        rail: "stripe",
        provider_reference: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }),
    );
    expect(res.json()).toMatchObject({
      settlement: expect.objectContaining({ rail: "stripe" }),
      conditional_settlement: expect.objectContaining({
        status: "RELEASE_CONFIRMED",
        release_seller_wallet: sellerWallet,
      }),
    });
  });

  it("rejects demo order aggregation for non-participants", async () => {
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({
      id: "order_123",
      buyerId: "someone-else",
      sellerId: "another-user",
      status: "PAYMENT_PENDING",
      amountMinor: "1000",
      currency: "USD",
      createdAt: new Date(),
      orderSnapshot: {},
    } as never);
    mockGetPaymentIntentByOrderId.mockResolvedValueOnce(null);
    mockGetShipmentByOrderId.mockResolvedValueOnce(null);
    mockGetDisputeByOrderId.mockResolvedValueOnce(null);
    app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/demo/e2e/order/order_123",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("rejects demo order creation for non-admin users in production", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    const productionUserJwt = jwt.sign(
      {
        sub: "00000000-0000-4000-a000-000000000010",
        email: "test@haggle.ai",
        role: "authenticated",
        aud: "authenticated",
      },
      "test-secret",
    );
    app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/demo/e2e/create-order",
      headers: { authorization: `Bearer ${productionUserJwt}` },
      payload: { amount_minor: 1000 },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("DEMO_E2E_DISABLED");
  });
});
