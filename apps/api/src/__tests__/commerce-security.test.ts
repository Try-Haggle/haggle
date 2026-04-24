import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import authPlugin from "../middleware/auth.js";
import { registerDemoE2ERoutes } from "../routes/demo-e2e.js";
import { registerSettlementApprovalRoutes } from "../routes/settlement-approvals.js";
import { registerSettlementReleaseRoutes } from "../routes/settlement-releases.js";
import { AUTH_HEADERS } from "./helpers.js";
import {
  getCommerceOrderByOrderId,
  getPaymentIntentByOrderId,
} from "../services/payment-record.service.js";
import {
  getDisputeByOrderId,
} from "../services/dispute-record.service.js";
import {
  getShipmentByOrderId,
} from "../services/shipment-record.service.js";
import {
  getSettlementReleaseById,
} from "../services/settlement-release.service.js";

vi.mock("../services/payment-record.service.js", () => ({
  getCommerceOrderByOrderId: vi.fn(),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
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

const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockGetPaymentIntentByOrderId = vi.mocked(getPaymentIntentByOrderId);
const mockGetShipmentByOrderId = vi.mocked(getShipmentByOrderId);
const mockGetDisputeByOrderId = vi.mocked(getDisputeByOrderId);
const mockGetSettlementReleaseById = vi.mocked(getSettlementReleaseById);

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

    app = await buildApp(buildDb({
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
    }));

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
      { sub: "test-user-001", email: "test@haggle.ai", role: "authenticated" },
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
