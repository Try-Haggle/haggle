import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerOrderRoutes } from "../routes/orders.js";
import { confirmBuyerAccess } from "../services/fulfillment-confirm.service.js";
import { getCommerceOrderByOrderId } from "../services/payment-record.service.js";
import { getSettlementReleaseByOrderId } from "../services/settlement-release.service.js";

vi.mock("../services/payment-record.service.js", () => ({
  getCommerceOrderByOrderId: vi.fn(),
  updateCommerceOrderStatus: vi.fn(),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  getSettlementReleaseByOrderId: vi.fn(),
  updateSettlementReleaseRecord: vi.fn(),
}));

vi.mock("../services/fulfillment-confirm.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/fulfillment-confirm.service.js")>(
    "../services/fulfillment-confirm.service.js",
  );
  return {
    ...actual,
    confirmBuyerAccess: vi.fn(),
  };
});

vi.mock("../services/fulfillment-proof.service.js", async () => {
  const actual = await vi.importActual<typeof import("../services/fulfillment-proof.service.js")>(
    "../services/fulfillment-proof.service.js",
  );
  return {
    ...actual,
    submitSellerFulfillmentProof: vi.fn(),
  };
});

const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockGetSettlementReleaseByOrderId = vi.mocked(getSettlementReleaseByOrderId);
const mockConfirmBuyerAccess = vi.mocked(confirmBuyerAccess);

const ORDER_ID = "00000000-0000-4000-a000-000000000201";
const SELLER_ID = "seller_1";
const BUYER_ID = "buyer_1";
const OTHER_ID = "stranger_1";
const NOW = "2026-09-06T01:00:00.000Z";

const pendingRelease = {
  id: "release_1",
  payment_intent_id: "payment_1",
  order_id: ORDER_ID,
  product_amount: { currency: "USDC", amount_minor: 10_000_000 },
  product_release_status: "PENDING_DELIVERY" as const,
  buffer_amount: { currency: "USDC", amount_minor: 0 },
  buffer_release_status: "RELEASED" as const,
  apv_adjustment_minor: 0,
  created_at: NOW,
  updated_at: NOW,
};

const reviewRelease = {
  ...pendingRelease,
  product_release_status: "BUYER_REVIEW" as const,
  delivery_confirmed_at: NOW,
  buyer_review_deadline: "2026-09-07T01:00:00.000Z",
  updated_at: NOW,
};

function makeApp(user = { id: BUYER_ID, role: "authenticated" }) {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.user = user;
  });
  const db = {} as Database;
  registerOrderRoutes(app, db);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCommerceOrderByOrderId.mockResolvedValue({
    id: ORDER_ID,
    status: "FULFILLMENT_PENDING",
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
  } as never);
  mockGetSettlementReleaseByOrderId.mockResolvedValue(pendingRelease as never);
  mockConfirmBuyerAccess.mockResolvedValue({
    fulfillment: {
      id: "ful_001",
      order_id: ORDER_ID,
      fulfillment_type: "digital_delivery",
      status: "FULFILLED",
      proof_required: true,
      proof_status: "SUBMITTED",
      fulfilled_at: NOW,
      review_window_hours: 24,
      metadata: {},
      created_at: NOW,
      updated_at: NOW,
    },
    settlement_release: reviewRelease as never,
    buyer_review_started: true,
    already_confirmed: false,
    auto_released: false,
  });
});

describe("POST /orders/:orderId/fulfillment/confirm", () => {
  it("buyer confirm from PROOF_SUBMITTED starts review without releasing funds", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/confirm`,
      payload: { confirmation: "access_received" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fulfillment.status).toBe("FULFILLED");
    expect(body.fulfillment.fulfilled_at).toBe(NOW);
    expect(body.buyer_review_started).toBe(true);
    expect(body.auto_released).toBe(false);
    expect(body.release_not_auto_released).toBe(true);
    expect(body.settlement_release.product_release_status).toBe("BUYER_REVIEW");
    expect(body.settlement_release.product_released_at).toBeNull();
    expect(mockConfirmBuyerAccess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        order_id: ORDER_ID,
        confirmation: "access_received",
      }),
    );
    await app.close();
  });

  it("rejects seller callers (buyer only)", async () => {
    const app = makeApp({ id: SELLER_ID, role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/confirm`,
      payload: { confirmation: "access_received" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockConfirmBuyerAccess).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects non-party callers", async () => {
    const app = makeApp({ id: OTHER_ID, role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/confirm`,
      payload: { confirmation: "access_received" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockConfirmBuyerAccess).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects empty/invalid confirmation body", async () => {
    const app = makeApp();
    const empty = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/confirm`,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);

    const invalid = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/confirm`,
      payload: { confirmation: "yes" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(mockConfirmBuyerAccess).not.toHaveBeenCalled();
    await app.close();
  });

  it("maps wrong-status service errors to 409", async () => {
    const { FulfillmentConfirmError } = await import("../services/fulfillment-confirm.service.js");
    mockConfirmBuyerAccess.mockRejectedValue(
      new FulfillmentConfirmError(
        "INVALID_FULFILLMENT_STATUS",
        'Cannot confirm access while fulfillment status is "AWAITING_SELLER_ACTION"',
      ),
    );
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/confirm`,
      payload: { confirmation: "access_received" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("INVALID_FULFILLMENT_STATUS");
    await app.close();
  });
});
