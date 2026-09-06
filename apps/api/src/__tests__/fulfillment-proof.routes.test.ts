import type { Database } from "@haggle/db";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerOrderRoutes } from "../routes/orders.js";
import { submitSellerFulfillmentProof } from "../services/fulfillment-proof.service.js";
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
const mockSubmitSellerFulfillmentProof = vi.mocked(submitSellerFulfillmentProof);

const ORDER_ID = "00000000-0000-4000-a000-000000000201";
const SELLER_ID = "seller_1";
const BUYER_ID = "buyer_1";

const pendingRelease = {
  id: "release_1",
  payment_intent_id: "payment_1",
  order_id: ORDER_ID,
  product_amount: { currency: "USDC", amount_minor: 10_000_000 },
  product_release_status: "PENDING_DELIVERY" as const,
  buffer_amount: { currency: "USDC", amount_minor: 0 },
  buffer_release_status: "RELEASED" as const,
  apv_adjustment_minor: 0,
  created_at: "2026-09-06T00:00:00.000Z",
  updated_at: "2026-09-06T00:00:00.000Z",
};

function makeApp(user = { id: SELLER_ID, role: "authenticated" }) {
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
  mockSubmitSellerFulfillmentProof.mockResolvedValue({
    proof: {
      id: "fp_001",
      fulfillment_id: "ful_001",
      proof_kind: "access_grant",
      uri: "supabase://private/proofs/demo",
      submitted_by: SELLER_ID,
      verification_status: "PENDING",
      metadata: {},
      created_at: "2026-09-06T00:00:00.000Z",
      updated_at: "2026-09-06T00:00:00.000Z",
    },
    fulfillment: {
      id: "ful_001",
      order_id: ORDER_ID,
      fulfillment_type: "digital_delivery",
      status: "PROOF_SUBMITTED",
      proof_required: true,
      proof_status: "SUBMITTED",
      review_window_hours: 24,
      metadata: {},
      created_at: "2026-09-06T00:00:00.000Z",
      updated_at: "2026-09-06T00:00:00.000Z",
    },
  });
});

describe("POST /orders/:orderId/fulfillment/proofs", () => {
  it("stores seller proof as SUBMITTED without releasing funds or starting buyer review", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/proofs`,
      payload: {
        kind: "access_grant",
        uri: "supabase://private/proofs/demo",
        sha256: "sha256:abc",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.proof.verification_status).toBe("PENDING");
    expect(body.fulfillment.status).toBe("PROOF_SUBMITTED");
    expect(body.fulfillment.proof_status).toBe("SUBMITTED");
    expect(body.fulfillment.fulfilled_at).toBeNull();
    expect(body.buyer_review_started).toBe(false);
    expect(body.auto_released).toBe(false);
    expect(body.release_unchanged).toBe(true);
    expect(body.settlement_release.product_release_status).toBe("PENDING_DELIVERY");
    expect(mockSubmitSellerFulfillmentProof).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        order_id: ORDER_ID,
        submitted_by: SELLER_ID,
        kind: "access_grant",
      }),
    );
    await app.close();
  });

  it("rejects buyer callers (seller only)", async () => {
    const app = makeApp({ id: BUYER_ID, role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/proofs`,
      payload: { kind: "access_grant", uri: "supabase://private/proofs/demo" },
    });
    expect(res.statusCode).toBe(403);
    expect(mockSubmitSellerFulfillmentProof).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects empty evidence payload", async () => {
    const app = makeApp();
    const res = await app.inject({
      method: "POST",
      url: `/orders/${ORDER_ID}/fulfillment/proofs`,
      payload: { kind: "access_grant" },
    });
    expect(res.statusCode).toBe(400);
    expect(mockSubmitSellerFulfillmentProof).not.toHaveBeenCalled();
    await app.close();
  });
});
