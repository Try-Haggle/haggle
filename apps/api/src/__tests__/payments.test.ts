import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { getTestApp, closeTestApp, AUTH_HEADERS } from "./helpers.js";

// --- Mock service layers ---
vi.mock("../services/payment-record.service.js", () => ({
  createPaymentAuthorizationRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  createRefundRecord: vi.fn().mockResolvedValue(null),
  createStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  ensureCommerceOrderForApproval: vi.fn().mockResolvedValue(null),
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getSettlementApprovalById: vi.fn().mockResolvedValue(null),
  updateCommerceOrderStatus: vi.fn().mockResolvedValue(null),
  updateStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  getSettlementReleaseById: vi.fn().mockResolvedValue(null),
  updateSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn().mockResolvedValue(null),
  getShipmentById: vi.fn().mockResolvedValue(null),
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
  updateShipmentRecord: vi.fn().mockResolvedValue(null),
  insertShipmentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-record.service.js", () => ({
  createDisputeRecord: vi.fn().mockResolvedValue(null),
  getDisputeById: vi.fn().mockResolvedValue(null),
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
  addDisputeEvidenceRecord: vi.fn().mockResolvedValue(null),
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  createDeposit: vi.fn().mockResolvedValue(null),
  getPendingExpiredDeposits: vi.fn().mockResolvedValue([]),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
}));

// Mock remaining service modules that may be imported transitively
vi.mock("../services/authentication-record.service.js", () => ({
  getAuthenticationByOrderId: vi.fn().mockResolvedValue(null),
  createAuthenticationRecord: vi.fn().mockResolvedValue(null),
  updateAuthenticationRecord: vi.fn().mockResolvedValue(null),
  getAuthenticationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-score.service.js", () => ({
  computeAndStoreTrustScore: vi.fn().mockResolvedValue(null),
  getTrustScore: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/ds-rating.service.js", () => ({
  submitDSRating: vi.fn().mockResolvedValue(null),
  getDSRatings: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/arp-segment.service.js", () => ({
  getARPSegment: vi.fn().mockResolvedValue(null),
  computeAndStoreARPSegment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/tag.service.js", () => ({
  getTagsForUser: vi.fn().mockResolvedValue([]),
  addTag: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/intent.service.js", () => ({
  getIntentById: vi.fn().mockResolvedValue(null),
  createIntent: vi.fn().mockResolvedValue(null),
  listIntents: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/skill.service.js", () => ({
  getSkillById: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
}));

describe("Payment routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // Health check
  it("GET /health returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("rejects inline settlement approvals for non-admin users in production", async () => {
    const originalVercelEnv = process.env.VERCEL_ENV;
    const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
    process.env.VERCEL_ENV = "production";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    const token = jwt.sign(
      { sub: "test-user-001", email: "test@haggle.ai", role: "authenticated" },
      "test-secret",
    );

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/prepare",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          settlement_approval: {
            id: "sa_inline",
            approval_state: "APPROVED",
            seller_policy: {
              mode: "AUTO_WITHIN_POLICY",
              fulfillment_sla: { shipment_input_due_days: 3 },
              responsiveness: { median_response_minutes: 30, p95_response_minutes: 120, reliable_fast_responder: true },
            },
            terms: {
              listing_id: "listing_1",
              seller_id: "seller_1",
              buyer_id: "test-user-001",
              final_amount_minor: 1000,
              currency: "USD",
              selected_payment_rail: "x402",
            },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("INLINE_SETTLEMENT_APPROVAL_DISABLED");
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = originalVercelEnv;
      if (originalJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
    }
  });

  // GET /payments/:id
  it("GET /payments/:id returns 404 for unknown payment", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/payments/nonexistent-id",
      headers: AUTH_HEADERS,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("PAYMENT_NOT_FOUND");
  });

  // POST /payments/prepare - auth required
  it("POST /payments/prepare returns 401 without auth token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      payload: { settlement_approval_id: "test" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });

  // x402 webhook - in test env HAGGLE_X402_WEBHOOK_SECRET is not set,
  // so requireWebhookSignature is bypassed (dev passthrough).
  // Without signature header the request still proceeds in test mode.
  it("POST /payments/webhooks/x402 without signature is bypassed in test mode (no secret)", async () => {
    // In test env no HAGGLE_X402_WEBHOOK_SECRET, so signature check is skipped.
    // Unknown intent (mocked null) returns accepted+ignored.
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: { event_type: "settlement.confirmed", payment_intent_id: "pi_123" },
    });
    // Dev passthrough: signature not enforced without secret, proceeds to intent lookup
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
  });

  it("POST /payments/webhooks/x402 returns 400 when signature present but no event_type", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: { "x-haggle-x402-signature": "test-sig-123" },
      payload: { payment_intent_id: "pi_123" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MISSING_WEBHOOK_FIELDS");
  });

  it("POST /payments/webhooks/x402 returns 400 when signature present but no payment_intent_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: { "x-haggle-x402-signature": "test-sig-123" },
      payload: { event_type: "settlement.confirmed" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("MISSING_WEBHOOK_FIELDS");
  });

  it("POST /payments/webhooks/x402 accepts unknown intent gracefully", async () => {
    // With mocked getPaymentIntentById returning null, unknown intents are ignored
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: { "x-haggle-x402-signature": "test-sig-123" },
      payload: { event_type: "settlement.confirmed", payment_intent_id: "pi_unknown" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.action).toBe("ignored");
    expect(body.reason).toBe("unknown_intent");
  });

  // Stripe webhook - missing stripe-signature header returns 401
  it("POST /payments/webhooks/stripe returns 401 without signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/stripe",
      payload: { type: "payment_intent.succeeded" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_STRIPE_WEBHOOK");
  });

  it("POST /payments/webhooks/stripe returns 200 with valid signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/stripe",
      headers: { "stripe-signature": "test-stripe-sig" },
      payload: { type: "payment_intent.succeeded" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().accepted).toBe(true);
    expect(res.json().provider).toBe("stripe");
  });

  // POST /payments/:id/authorize - auth required
  it("POST /payments/:id/authorize returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/some-id/authorize",
    });
    expect(res.statusCode).toBe(401);
  });
});
