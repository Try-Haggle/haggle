import { PAYMENT_DISCLOSURE_TEXT_HASH, PAYMENT_DISCLOSURE_VERSION } from "@haggle/shared";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { createPublicClient, decodeEventLog } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  completePaymentOperationIdempotencyRecord,
  createAgentPaymentGrantRecord,
  createPaymentDisclosureRecord,
  createPaymentOperationIdempotencyRecord,
  createRefundRecord,
  createStoredPaymentIntent,
  ensureCommerceOrderForApproval,
  getActivePaymentIntentByOrderId,
  getAgentPaymentGrantById,
  getCommerceOrderByOrderId,
  getInProgressPaymentOperationForIntent,
  getPaymentIntentById,
  getPaymentIntentRowById,
  getPaymentOperationIdempotencyRecord,
  getPaymentSettlementByPaymentIntentId,
  getRefundRecordsByPaymentIntentId,
  getSettlementApprovalById,
  updateCommerceOrderStatus,
  updateStoredPaymentIntent,
} from "../services/payment-record.service.js";
import { createSettlementReleaseRecord } from "../services/settlement-release.service.js";
import { createShipmentRecord } from "../services/shipment-record.service.js";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
} from "../services/webhook-event-claim.service.js";
import { ADMIN_HEADERS, AUTH_HEADERS, closeTestApp, getTestApp } from "./helpers.js";

// --- Mock service layers ---
vi.mock("../services/payment-record.service.js", () => ({
  createAgentPaymentGrantRecord: vi.fn().mockResolvedValue(null),
  getAgentPaymentGrantById: vi.fn().mockResolvedValue(null),
  createPaymentDisclosureRecord: vi.fn().mockResolvedValue(null),
  createPaymentAuthorizationRecord: vi.fn().mockResolvedValue(null),
  completePaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(undefined),
  createPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  createPaymentSettlementRecord: vi.fn().mockResolvedValue(null),
  createRefundRecord: vi.fn().mockResolvedValue(null),
  createStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  ensureCommerceOrderForApproval: vi.fn().mockResolvedValue(null),
  getActivePaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
  getInProgressPaymentOperationForIntent: vi.fn().mockResolvedValue(null),
  getPaymentSettlementByPaymentIntentId: vi.fn().mockResolvedValue(null),
  getPaymentIntentById: vi.fn().mockResolvedValue(null),
  getPaymentOperationIdempotencyRecord: vi.fn().mockResolvedValue(null),
  getPaymentIntentRowById: vi.fn().mockResolvedValue(null),
  getRefundRecordsByPaymentIntentId: vi.fn().mockResolvedValue([]),
  getSettlementApprovalById: vi.fn().mockResolvedValue(null),
  updateCommerceOrderStatus: vi.fn().mockResolvedValue(null),
  updateStoredPaymentIntent: vi.fn().mockResolvedValue(null),
  getCommerceOrderByOrderId: vi.fn().mockResolvedValue(null),
  getPaymentIntentByOrderId: vi.fn().mockResolvedValue(null),
  setPaymentIntentProviderContext: vi.fn().mockResolvedValue(null),
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

vi.mock("../services/admin-action-log.service.js", () => ({
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/webhook-event-claim.service.js", () => ({
  webhookPayloadSha256: vi.fn(() => "a".repeat(64)),
  claimWebhookEvent: vi.fn().mockResolvedValue({
    outcome: "acquired",
    source: "x402",
    eventId: "event",
    claimId: "11111111-1111-4111-8111-111111111111",
    attemptCount: 1,
  }),
  completeWebhookEvent: vi.fn().mockResolvedValue(true),
  failWebhookEvent: vi.fn().mockResolvedValue(undefined),
  startWebhookClaimHeartbeat: vi.fn(() => vi.fn()),
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

const mockCreateAgentPaymentGrantRecord = vi.mocked(createAgentPaymentGrantRecord);
const mockCreatePaymentDisclosureRecord = vi.mocked(createPaymentDisclosureRecord);
const mockCreateStoredPaymentIntent = vi.mocked(createStoredPaymentIntent);
const mockEnsureCommerceOrderForApproval = vi.mocked(ensureCommerceOrderForApproval);
const mockGetAgentPaymentGrantById = vi.mocked(getAgentPaymentGrantById);
const mockGetActivePaymentIntentByOrderId = vi.mocked(getActivePaymentIntentByOrderId);
const mockGetCommerceOrderByOrderId = vi.mocked(getCommerceOrderByOrderId);
const mockGetInProgressPaymentOperationForIntent = vi.mocked(
  getInProgressPaymentOperationForIntent,
);
const mockGetPaymentSettlementByPaymentIntentId = vi.mocked(getPaymentSettlementByPaymentIntentId);
const mockGetPaymentIntentById = vi.mocked(getPaymentIntentById);
const mockGetPaymentOperationIdempotencyRecord = vi.mocked(getPaymentOperationIdempotencyRecord);
const mockGetPaymentIntentRowById = vi.mocked(getPaymentIntentRowById);
const mockGetRefundRecordsByPaymentIntentId = vi.mocked(getRefundRecordsByPaymentIntentId);
const mockGetSettlementApprovalById = vi.mocked(getSettlementApprovalById);
const mockUpdateCommerceOrderStatus = vi.mocked(updateCommerceOrderStatus);
const mockUpdateStoredPaymentIntent = vi.mocked(updateStoredPaymentIntent);
const mockCreateRefundRecord = vi.mocked(createRefundRecord);
const mockCompletePaymentOperationIdempotencyRecord = vi.mocked(
  completePaymentOperationIdempotencyRecord,
);
const mockCreatePaymentOperationIdempotencyRecord = vi.mocked(
  createPaymentOperationIdempotencyRecord,
);
const mockCreateSettlementReleaseRecord = vi.mocked(createSettlementReleaseRecord);
const mockCreateShipmentRecord = vi.mocked(createShipmentRecord);
const mockCreatePublicClient = vi.mocked(createPublicClient);
const mockDecodeEventLog = vi.mocked(decodeEventLog);
const mockClaimWebhookEvent = vi.mocked(claimWebhookEvent);
const mockCompleteWebhookEvent = vi.mocked(completeWebhookEvent);
const mockFailWebhookEvent = vi.mocked(failWebhookEvent);

describe("Payment routes", () => {
  let app: FastifyInstance;
  let originalConditionalSettlementAddress: string | undefined;
  let originalUsdcAssetAddress: string | undefined;
  let originalBaseRpcUrl: string | undefined;

  beforeAll(async () => {
    originalConditionalSettlementAddress = process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    originalUsdcAssetAddress = process.env.HAGGLE_X402_USDC_ASSET_ADDRESS;
    originalBaseRpcUrl = process.env.HAGGLE_BASE_RPC_URL;
    process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS =
      "0xcccccccccccccccccccccccccccccccccccccccc";
    process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = "0x3333333333333333333333333333333333333333";
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
    if (originalConditionalSettlementAddress === undefined)
      delete process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS;
    else process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS = originalConditionalSettlementAddress;
    if (originalUsdcAssetAddress === undefined) delete process.env.HAGGLE_X402_USDC_ASSET_ADDRESS;
    else process.env.HAGGLE_X402_USDC_ASSET_ADDRESS = originalUsdcAssetAddress;
    if (originalBaseRpcUrl === undefined) delete process.env.HAGGLE_BASE_RPC_URL;
    else process.env.HAGGLE_BASE_RPC_URL = originalBaseRpcUrl;
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
              responsiveness: {
                median_response_minutes: 30,
                p95_response_minutes: 120,
                reliable_fast_responder: true,
              },
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

  it("rejects inline settlement approvals for non-admin users before persistence lookup", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval: {
          id: "sa_inline_untrusted",
          approval_state: "APPROVED",
          seller_policy: {
            mode: "AUTO_WITHIN_POLICY",
            fulfillment_sla: { shipment_input_due_days: 3 },
            responsiveness: {
              median_response_minutes: 30,
              p95_response_minutes: 120,
              reliable_fast_responder: true,
            },
          },
          terms: {
            listing_id: "listing_1",
            seller_id: "seller_1",
            buyer_id: "test-user-001",
            final_amount_minor: 1000,
            currency: "USD",
            selected_payment_rail: "x402",
          },
          buyer_approved_at: new Date().toISOString(),
          seller_approved_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INLINE_SETTLEMENT_APPROVAL_DISABLED");
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("rejects inline settlement approvals for admin users before persistence lookup", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const token = jwt.sign(
      { sub: "test-user-001", email: "admin@haggle.ai", role: "admin" },
      process.env.SUPABASE_JWT_SECRET ?? "test-secret",
    );

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        settlement_approval: {
          id: "sa_inline_admin_untrusted",
          approval_state: "APPROVED",
          seller_policy: {
            mode: "AUTO_WITHIN_POLICY",
            fulfillment_sla: { shipment_input_due_days: 3 },
            responsiveness: {
              median_response_minutes: 30,
              p95_response_minutes: 120,
              reliable_fast_responder: true,
            },
          },
          terms: {
            listing_id: "listing_1",
            seller_id: "seller_1",
            buyer_id: "test-user-001",
            final_amount_minor: 1000,
            currency: "USD",
            selected_payment_rail: "x402",
          },
          buyer_approved_at: new Date().toISOString(),
          seller_approved_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("INLINE_SETTLEMENT_APPROVAL_DISABLED");
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("requires a reason for admin direct payment mutations in production", async () => {
    const originalVercelEnv = process.env.VERCEL_ENV;
    const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
    process.env.VERCEL_ENV = "production";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    const token = jwt.sign(
      { sub: "test-admin-001", email: "admin@haggle.ai", role: "admin" },
      "test-secret",
    );
    mockGetPaymentIntentById.mockClear();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_admin_cancel/cancel",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "PAYMENT_ADMIN_REASON_REQUIRED",
        message: "Admin payment mutations in production require a reason",
      });
      expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = originalVercelEnv;
      if (originalJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
    }
  });

  it("accepts an admin reason before production idempotency enforcement", async () => {
    const originalVercelEnv = process.env.VERCEL_ENV;
    const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
    process.env.VERCEL_ENV = "production";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    const token = jwt.sign(
      { sub: "test-admin-001", email: "admin@haggle.ai", role: "admin" },
      "test-secret",
    );
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentById.mockResolvedValueOnce({
      id: "pi_admin_cancel_reason",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "buyer_123",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_admin_cancel_reason/cancel",
        headers: {
          authorization: `Bearer ${token}`,
          "x-haggle-payment-reason": "operator verified provider cancellation",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "IDEMPOTENCY_KEY_REQUIRED" });
      expect(mockGetPaymentIntentById).toHaveBeenCalledOnce();
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = originalVercelEnv;
      if (originalJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
    }
  });

  it("requires payment disclosure acknowledgement for production payment prepare", async () => {
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
          settlement_approval_id: "6f3f3657-8f1d-4c32-91a8-faf5bfc3a111",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("PAYMENT_DISCLOSURE_ACK_REQUIRED");
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = originalVercelEnv;
      if (originalJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
    }
  });

  it("requires idempotency key for production payment prepare before creating order or intent", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateAgentPaymentGrantRecord.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    const originalVercelEnv = process.env.VERCEL_ENV;
    const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
    const originalStripeMode = process.env.STRIPE_MODE;
    process.env.VERCEL_ENV = "production";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    process.env.STRIPE_MODE = "real";
    const token = jwt.sign(
      { sub: "test-user-001", email: "test@haggle.ai", role: "authenticated" },
      "test-secret",
    );
    const now = new Date().toISOString();
    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: "00000000-0000-4000-a000-000000000099",
      approval_state: "APPROVED",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: "00000000-0000-4000-a000-000000000011",
        seller_id: "00000000-0000-4000-a000-000000000033",
        buyer_id: "test-user-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "stripe",
      },
      buyer_approved_at: now,
      seller_approved_at: now,
      created_at: now,
      updated_at: now,
    });

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/prepare",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          settlement_approval_id: "00000000-0000-4000-a000-000000000099",
          payment_disclosure_ack: {
            version: PAYMENT_DISCLOSURE_VERSION,
            text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
            accepted_at: now,
            no_custody: true,
            buyer_approved_rules: true,
            stripe_fallback: true,
            stablecoin_not_investment: true,
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "IDEMPOTENCY_KEY_REQUIRED" });
      expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
      expect(mockCreateAgentPaymentGrantRecord).not.toHaveBeenCalled();
      expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = originalVercelEnv;
      if (originalJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
      if (originalStripeMode === undefined) delete process.env.STRIPE_MODE;
      else process.env.STRIPE_MODE = originalStripeMode;
    }
  });

  it.each([
    [
      "no_custody",
      { no_custody: false, buyer_approved_rules: true, stablecoin_not_investment: true },
    ],
    [
      "buyer_approved_rules",
      { no_custody: true, buyer_approved_rules: false, stablecoin_not_investment: true },
    ],
    [
      "stablecoin_not_investment",
      { no_custody: true, buyer_approved_rules: true, stablecoin_not_investment: false },
    ],
  ])("rejects invalid payment disclosure acknowledgement for %s before persistence lookup", async (field, acknowledgement) => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: "00000000-0000-4000-a000-000000000099",
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: new Date().toISOString(),
          stripe_fallback: false,
          ...acknowledgement,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_DISCLOSURE_ACK_INVALID",
      message: `${field} acknowledgement is required`,
    });
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it.each([
    ["version", "unsupported payment disclosure", PAYMENT_DISCLOSURE_TEXT_HASH],
    ["text_hash", PAYMENT_DISCLOSURE_VERSION, "sha256:untrusted-disclosure"],
  ])("rejects unsupported payment disclosure %s before persistence lookup", async (field, version, textHash) => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: "00000000-0000-4000-a000-000000000099",
        payment_disclosure_ack: {
          version,
          text_hash: textHash,
          accepted_at: new Date().toISOString(),
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: false,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_DISCLOSURE_ACK_INVALID",
      message: `payment disclosure ${field} is not supported`,
    });
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
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

  it.each([
    ["POST", "/payments/pi_buyer_action/quote", undefined],
    ["GET", "/payments/pi_buyer_action/x402/requirements", undefined],
    ["POST", "/payments/pi_buyer_action/x402/conditional-settlement-request", {}],
    [
      "POST",
      "/payments/pi_buyer_action/x402/conditional-settlement-funding",
      {
        tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    ],
    [
      "POST",
      "/payments/pi_buyer_action/x402/conditional-settlement-confirmation",
      {
        tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    ],
    ["POST", "/payments/pi_buyer_action/x402/submit-signature", { payment_payload: {} }],
    ["POST", "/payments/pi_buyer_action/authorize", undefined],
    ["POST", "/payments/pi_buyer_action/settlement-pending", undefined],
    ["POST", "/payments/pi_buyer_action/settle", undefined],
    ["POST", "/payments/pi_buyer_action/fail", undefined],
    ["POST", "/payments/pi_buyer_action/cancel", undefined],
    [
      "POST",
      "/payments/pi_buyer_action/refund",
      {
        amount_minor: 100,
        currency: "USD",
        reason_code: "buyer_requested",
      },
    ],
    [
      "POST",
      "/payments/pi_buyer_action/onramp/session",
      {
        destination_wallet: "0x1111111111111111111111111111111111111111",
      },
    ],
  ])("%s %s rejects sellers before buyer payment mutation logic", async (method, url, payload) => {
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentById.mockResolvedValueOnce({
      id: "pi_buyer_action",
      order_id: "order_123",
      seller_id: "test-user-001",
      buyer_id: "buyer_123",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never);

    const res = await app.inject({
      method: method as "GET" | "POST",
      url,
      headers: AUTH_HEADERS,
      ...(payload === undefined ? {} : { payload }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
    expect(mockGetPaymentIntentById).toHaveBeenCalledOnce();
  });

  it("POST /payments/:id/cancel protects captured payments before state mutation", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_settled_cancel",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_settled_cancel/cancel",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_TERMINAL_STATE_PROTECTED",
      message: "Captured, refunded, or disputed payments cannot be manually canceled.",
      status: "SETTLED",
      production_status: "captured",
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/fail protects captured payments before state mutation", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_settled_fail",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_settled_fail/fail",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_TERMINAL_STATE_PROTECTED",
      message: "Captured, refunded, or disputed payments cannot be manually failed.",
      status: "SETTLED",
      production_status: "captured",
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/cancel records idempotent payment mutations", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockGetPaymentOperationIdempotencyRecord.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    mockCompletePaymentOperationIdempotencyRecord.mockClear();
    mockGetPaymentOperationIdempotencyRecord.mockResolvedValueOnce(null);
    mockCreatePaymentOperationIdempotencyRecord.mockResolvedValueOnce({
      operation: "payment.cancel",
      idempotencyKey: "idem-cancel-1",
      paymentIntentId: "pi_cancel_idem",
      requestHash: "sha256:placeholder",
      responseStatus: 409,
      responseBody: { error: "PAYMENT_OPERATION_IN_PROGRESS" },
    } as never);
    const intent = {
      id: "pi_cancel_idem",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_cancel_idem/cancel",
      headers: {
        ...AUTH_HEADERS,
        "idempotency-key": "idem-cancel-1",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().intent).toMatchObject({ id: "pi_cancel_idem", status: "CANCELED" });
    expect(mockCreatePaymentOperationIdempotencyRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: "payment.cancel",
        idempotencyKey: "idem-cancel-1",
        paymentIntentId: "pi_cancel_idem",
        responseStatus: 409,
        responseBody: expect.objectContaining({
          error: "PAYMENT_OPERATION_IN_PROGRESS",
        }),
      }),
    );
    expect(mockCompletePaymentOperationIdempotencyRecord).toHaveBeenCalledWith(
      expect.anything(),
      "payment.cancel",
      "idem-cancel-1",
      expect.objectContaining({
        responseStatus: 200,
      }),
    );
  });

  it("POST /payments/:id/cancel rejects conflicting idempotency key reuse", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockGetPaymentOperationIdempotencyRecord.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    mockCompletePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_cancel_conflict",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentOperationIdempotencyRecord.mockResolvedValueOnce({
      operation: "payment.cancel",
      idempotencyKey: "idem-conflict",
      requestHash: "sha256:different",
      responseStatus: 200,
      responseBody: { intent: { id: "pi_cancel_conflict", status: "CANCELED" } },
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_cancel_conflict/cancel",
      headers: {
        ...AUTH_HEADERS,
        "idempotency-key": "idem-conflict",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "IDEMPOTENCY_KEY_CONFLICT" });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
    expect(mockCompletePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/cancel rejects a different idempotency key while the same intent operation is in progress", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockGetPaymentOperationIdempotencyRecord.mockClear();
    mockGetInProgressPaymentOperationForIntent.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    mockCompletePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_cancel_lock",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentOperationIdempotencyRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockCreatePaymentOperationIdempotencyRecord.mockResolvedValueOnce(null);
    mockGetInProgressPaymentOperationForIntent.mockResolvedValueOnce({
      operation: "payment.cancel",
      idempotencyKey: "idem-cancel-existing",
      paymentIntentId: "pi_cancel_lock",
      requestHash: "sha256:existing",
      responseStatus: 409,
      responseBody: { error: "PAYMENT_OPERATION_IN_PROGRESS" },
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_cancel_lock/cancel",
      headers: {
        ...AUTH_HEADERS,
        "idempotency-key": "idem-cancel-new",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_OPERATION_IN_PROGRESS",
      payment_intent_id: "pi_cancel_lock",
      operation: "payment.cancel",
      blocking_operation: "payment.cancel",
    });
    expect(mockGetInProgressPaymentOperationForIntent).toHaveBeenCalledWith(
      expect.anything(),
      "pi_cancel_lock",
      "idem-cancel-new",
    );
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCompletePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/cancel rejects while a different operation is in progress for the same intent", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockGetPaymentOperationIdempotencyRecord.mockClear();
    mockGetInProgressPaymentOperationForIntent.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    mockCompletePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_global_lock",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentOperationIdempotencyRecord
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockCreatePaymentOperationIdempotencyRecord.mockResolvedValueOnce(null);
    mockGetInProgressPaymentOperationForIntent.mockResolvedValueOnce({
      operation: "payment.capture",
      idempotencyKey: "idem-capture-existing",
      paymentIntentId: "pi_global_lock",
      requestHash: "sha256:existing",
      responseStatus: 409,
      responseBody: { error: "PAYMENT_OPERATION_IN_PROGRESS" },
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_global_lock/cancel",
      headers: {
        ...AUTH_HEADERS,
        "idempotency-key": "idem-cancel-new",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_OPERATION_IN_PROGRESS",
      payment_intent_id: "pi_global_lock",
      operation: "payment.cancel",
      blocking_operation: "payment.capture",
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCompletePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/settle retries fulfillment finalization for an already settled intent", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetCommerceOrderByOrderId.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockCreateSettlementReleaseRecord.mockClear();
    mockCreateShipmentRecord.mockClear();
    mockUpdateCommerceOrderStatus.mockClear();
    mockGetPaymentSettlementByPaymentIntentId.mockResolvedValueOnce({
      id: "settlement_existing",
      payment_intent_id: "pi_settled_retry",
      rail: "stripe",
      provider_reference: "stripe_settle_existing",
      settled_amount: { currency: "USD", amount_minor: 50_000 },
      settled_at: new Date().toISOString(),
      status: "SETTLED",
    });
    const intent = {
      id: "pi_settled_retry",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_settled_retry/settle",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      intent: expect.objectContaining({ id: "pi_settled_retry", status: "SETTLED" }),
      idempotent: true,
      trust_triggers: [],
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreateSettlementReleaseRecord).toHaveBeenCalledOnce();
    expect(mockCreateShipmentRecord).toHaveBeenCalledWith(
      expect.anything(),
      "order_123",
      "seller_123",
      "test-user-001",
    );
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_123",
      "PAID",
    );
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_123",
      "FULFILLMENT_PENDING",
    );
  });

  it("POST /payments/:id/settle finalizes digital fulfillment without creating a shipment", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetCommerceOrderByOrderId.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockCreateSettlementReleaseRecord.mockClear();
    mockCreateShipmentRecord.mockClear();
    mockUpdateCommerceOrderStatus.mockClear();
    mockGetPaymentSettlementByPaymentIntentId.mockResolvedValueOnce({
      id: "settlement_digital_existing",
      payment_intent_id: "pi_digital_settled_retry",
      rail: "x402",
      provider_reference: "conditional_settlement_existing",
      settled_amount: { currency: "USD", amount_minor: 5_00 },
      settled_at: new Date().toISOString(),
      status: "SETTLED",
    });
    mockGetCommerceOrderByOrderId.mockResolvedValueOnce({
      id: "order_123",
      status: "PAID",
      orderSnapshot: {
        terms: {
          fulfillment_type: "digital_delivery",
        },
      },
    } as never);
    const intent = {
      id: "pi_digital_settled_retry",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 5_00 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_digital_settled_retry/settle",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      intent: expect.objectContaining({ id: "pi_digital_settled_retry", status: "SETTLED" }),
      idempotent: true,
      fulfillment: {
        type: "digital_delivery",
        requires_shipment: false,
      },
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreateSettlementReleaseRecord).toHaveBeenCalledOnce();
    expect(mockCreateShipmentRecord).not.toHaveBeenCalled();
    expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
      expect.anything(),
      "order_123",
      "FULFILLMENT_PENDING",
    );
  });

  it("POST /payments/:id/refund maps non-settled refunds to 409", async () => {
    mockGetPaymentIntentById.mockClear();
    mockCreateRefundRecord.mockClear();
    const intent = {
      id: "pi_refund_authorized",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "AUTHORIZED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_refund_authorized/refund",
      headers: AUTH_HEADERS,
      payload: {
        amount_minor: 10_000,
        currency: "USD",
        reason_code: "buyer_requested",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_REFUND_STATE_INVALID",
      message: "refund requires SETTLED intent, got AUTHORIZED",
    });
    expect(mockCreateRefundRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/refund maps over-payment refunds to 400", async () => {
    mockGetPaymentIntentById.mockClear();
    mockCreateRefundRecord.mockClear();
    mockGetRefundRecordsByPaymentIntentId.mockClear();
    const intent = {
      id: "pi_refund_too_large",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_refund_too_large/refund",
      headers: AUTH_HEADERS,
      payload: {
        amount_minor: 50_001,
        currency: "USD",
        reason_code: "buyer_requested",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_REFUND_AMOUNT_INVALID",
      message: "refund amount 50001 exceeds payment amount 50000",
    });
    expect(mockGetRefundRecordsByPaymentIntentId).not.toHaveBeenCalled();
    expect(mockCreateRefundRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/refund rejects cumulative partial refunds that exceed payment amount", async () => {
    mockGetPaymentIntentById.mockClear();
    mockCreateRefundRecord.mockClear();
    mockGetRefundRecordsByPaymentIntentId.mockClear();
    const intent = {
      id: "pi_refund_cumulative",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      production_status: "partially_refunded",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetRefundRecordsByPaymentIntentId.mockResolvedValueOnce([
      {
        id: "refund_existing_completed",
        paymentIntentId: "pi_refund_cumulative",
        amountMinor: "30000",
        currency: "USD",
        reasonCode: "buyer_requested",
        status: "COMPLETED",
        providerReference: "provider_ref",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "refund_existing_pending",
        paymentIntentId: "pi_refund_cumulative",
        amountMinor: "15000",
        currency: "USD",
        reasonCode: "buyer_requested",
        status: "PENDING",
        providerReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "refund_existing_failed",
        paymentIntentId: "pi_refund_cumulative",
        amountMinor: "10000",
        currency: "USD",
        reasonCode: "buyer_requested",
        status: "FAILED",
        providerReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_refund_cumulative/refund",
      headers: AUTH_HEADERS,
      payload: {
        amount_minor: 10_000,
        currency: "USD",
        reason_code: "buyer_requested",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_REFUND_AMOUNT_EXCEEDS_REMAINING",
      payment_intent_id: "pi_refund_cumulative",
      payment_amount_minor: 50_000,
      existing_refund_amount_minor: 45_000,
      requested_refund_amount_minor: 10_000,
      refundable_remaining_minor: 5_000,
    });
    expect(mockCreateRefundRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/refund rejects already fully refunded payments before provider mutation", async () => {
    mockGetPaymentIntentById.mockClear();
    mockCreateRefundRecord.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_refund_full",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      production_status: "refunded",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_refund_full/refund",
      headers: AUTH_HEADERS,
      payload: {
        amount_minor: 10_000,
        currency: "USD",
        reason_code: "buyer_requested",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_REFUND_ALREADY_COMPLETED",
      production_status: "refunded",
    });
    expect(mockCreateRefundRecord).not.toHaveBeenCalled();
    expect(mockCreatePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/refund rejects disputed payments before provider mutation", async () => {
    mockGetPaymentIntentById.mockClear();
    mockCreateRefundRecord.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    const intent = {
      id: "pi_refund_disputed",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "SETTLED",
      production_status: "disputed",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_refund_disputed/refund",
      headers: AUTH_HEADERS,
      payload: {
        amount_minor: 10_000,
        currency: "USD",
        reason_code: "buyer_requested",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_REFUND_DISPUTED",
      production_status: "disputed",
    });
    expect(mockCreateRefundRecord).not.toHaveBeenCalled();
    expect(mockCreatePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/x402/conditional-settlement-confirmation rejects inactive payments before settlement finalization", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    const intent = {
      id: "pi_canceled_confirmation",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CANCELED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_canceled_confirmation/x402/conditional-settlement-confirmation",
      headers: AUTH_HEADERS,
      payload: {
        tx_hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_NOT_ACTIVE",
      status: "CANCELED",
    });
    expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/x402/conditional-settlement-request blocks Stripe before onramp funding", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentRowById.mockClear();
    mockGetAgentPaymentGrantById.mockClear();
    const intent = {
      id: "pi_stripe_not_funded",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe", "x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      agent_payment_grant_id: "grant_123",
      approval_policy_hash: "sha256:policy",
      agreement_hash: "sha256:agreement",
      listing_hash: "sha256:listing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {},
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_stripe_not_funded/x402/conditional-settlement-request",
      headers: AUTH_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "STRIPE_ONRAMP_NOT_FUNDED",
    });
    expect(mockGetAgentPaymentGrantById).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/x402/conditional-settlement-request keeps x402 direct eligible for conditional funding", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentRowById.mockClear();
    const intent = {
      id: "pi_x402_conditional_eligible",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {},
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_x402_conditional_eligible/x402/conditional-settlement-request",
      headers: AUTH_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_POLICY_BINDING_REQUIRED",
    });
  });

  it("POST /payments/:id/x402/conditional-settlement-request blocks x402 intent after Stripe onramp session is created but not funded", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentRowById.mockClear();
    mockGetAgentPaymentGrantById.mockClear();
    const intent = {
      id: "pi_x402_onramp_not_funded",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      agent_payment_grant_id: "grant_123",
      approval_policy_hash: "sha256:policy",
      agreement_hash: "sha256:agreement",
      listing_hash: "sha256:listing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        stripe_onramp: {
          status: "SESSION_CREATED",
          session_id: "cos_123",
        },
      },
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/pi_x402_onramp_not_funded/x402/conditional-settlement-request",
      headers: AUTH_HEADERS,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: "STRIPE_ONRAMP_NOT_FUNDED",
    });
    expect(mockGetAgentPaymentGrantById).not.toHaveBeenCalled();
  });

  it("POST /payments/:id/x402/conditional-settlement-request rejects Stripe onramp wallet mismatch", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentRowById.mockClear();
    mockGetAgentPaymentGrantById.mockClear();
    const buyerWallet = "0x1111111111111111111111111111111111111111";
    const onrampWallet = "0x2222222222222222222222222222222222222222";
    const intent = {
      id: "pi_stripe_wallet_mismatch",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe", "x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      agent_payment_grant_id: "grant_123",
      approval_policy_hash: "sha256:policy",
      agreement_hash: "sha256:agreement",
      listing_hash: "sha256:listing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        stripe_onramp: {
          status: "ONRAMP_FUNDED",
          session_id: "cos_123",
          destination_wallet: onrampWallet,
          destination_network: "base",
          destination_currency: "usdc",
          destination_amount_minor: "500000000",
        },
      },
    } as never);
    mockGetAgentPaymentGrantById.mockResolvedValueOnce({
      id: "grant_123",
      status: "ACTIVE",
      buyer_id: "test-user-001",
      seller_id: "seller_123",
      order_id: "order_123",
      approval_policy_hash: "sha256:policy",
      nonce: "grant-nonce",
    } as never);
    (
      globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
    ).__HAGGLE_TEST_DB_SELECT_ROWS__ = [[{ walletAddress: buyerWallet }]];

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_stripe_wallet_mismatch/x402/conditional-settlement-request",
        headers: AUTH_HEADERS,
        payload: {
          buyer_wallet_address: buyerWallet,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "STRIPE_ONRAMP_WALLET_MISMATCH",
      });
    } finally {
      delete (globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] })
        .__HAGGLE_TEST_DB_SELECT_ROWS__;
    }
  });

  it("POST /payments/:id/x402/conditional-settlement-request allows Stripe after matching onramp funding", async () => {
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentRowById.mockClear();
    mockGetAgentPaymentGrantById.mockClear();
    const buyerWallet = "0x1111111111111111111111111111111111111111";
    const sellerWallet = "0x2222222222222222222222222222222222222222";
    const intent = {
      id: "pi_stripe_onramp_funded",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe", "x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      agent_payment_grant_id: "grant_123",
      approval_policy_hash: "sha256:policy",
      agreement_hash: "sha256:agreement",
      listing_hash: "sha256:listing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        seller_wallet: sellerWallet,
        stripe_onramp: {
          status: "ONRAMP_FUNDED",
          session_id: "cos_123",
          destination_wallet: buyerWallet,
          destination_network: "base",
          destination_currency: "usdc",
          destination_amount_minor: "500000000",
        },
      },
    } as never);
    mockGetAgentPaymentGrantById.mockResolvedValueOnce({
      id: "grant_123",
      status: "ACTIVE",
      buyer_id: "test-user-001",
      seller_id: "seller_123",
      order_id: "order_123",
      approval_policy_hash: "sha256:policy",
      nonce: "grant-nonce",
    } as never);
    (
      globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
    ).__HAGGLE_TEST_DB_SELECT_ROWS__ = [[{ walletAddress: buyerWallet }]];

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_stripe_onramp_funded/x402/conditional-settlement-request",
        headers: AUTH_HEADERS,
        payload: {
          buyer_wallet_address: buyerWallet,
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        error: "CONDITIONAL_SETTLEMENT_SIGNATURE_UNAVAILABLE",
      });
      expect(mockGetAgentPaymentGrantById).toHaveBeenCalledWith(expect.anything(), "grant_123");
    } finally {
      delete (globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] })
        .__HAGGLE_TEST_DB_SELECT_ROWS__;
    }
  });

  it("POST /payments/:id/x402/conditional-refund-confirmation rejects receipts without a matching refund event", async () => {
    const originalRpc = process.env.HAGGLE_BASE_RPC_URL;
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    const settlementId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const intent = {
      id: "pi_conditional_refund_mismatch",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 10_000 },
      status: "SETTLEMENT_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById.mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        conditional_settlement: {
          status: "REFUND_SUBMITTED",
          settlement_id: settlementId,
          refund_tx_hash: txHash,
          buyer_wallet: "0x1111111111111111111111111111111111111111",
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
      args: {},
    } as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_conditional_refund_mismatch/x402/conditional-refund-confirmation",
        headers: ADMIN_HEADERS,
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "CONDITIONAL_REFUND_EVENT_MISMATCH",
      });
      expect(mockUpdateStoredPaymentIntent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          conditional_settlement: expect.objectContaining({ status: "REFUND_EVENT_MISMATCH" }),
        }),
      );
      expect(mockCreateRefundRecord).not.toHaveBeenCalled();
      expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalledWith(
        expect.anything(),
        "order_123",
        "REFUNDED",
      );
    } finally {
      if (originalRpc === undefined) delete process.env.HAGGLE_BASE_RPC_URL;
      else process.env.HAGGLE_BASE_RPC_URL = originalRpc;
    }
  });

  it("POST /payments/:id/x402/conditional-refund-confirmation records a verified escrow refund", async () => {
    const originalRpc = process.env.HAGGLE_BASE_RPC_URL;
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    const settlementId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const buyerWallet = "0x1111111111111111111111111111111111111111";
    const intent = {
      id: "pi_conditional_refund_ok",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 10_000 },
      status: "SETTLEMENT_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById.mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        conditional_settlement: {
          status: "REFUND_SUBMITTED",
          settlement_id: settlementId,
          refund_tx_hash: txHash,
          buyer_wallet: buyerWallet,
        },
      },
    } as never);
    mockGetRefundRecordsByPaymentIntentId.mockResolvedValueOnce([]);
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
      eventName: "SettlementRefunded",
      args: {
        settlementId,
        buyer: buyerWallet,
        amount: 100_000_000n,
      },
    } as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_conditional_refund_ok/x402/conditional-refund-confirmation",
        headers: ADMIN_HEADERS,
      });

      expect(res.statusCode).toBe(200);
      expect(mockCreateRefundRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          payment_intent_id: "pi_conditional_refund_ok",
          amount: { currency: "USD", amount_minor: 10_000 },
          reason_code: "CONDITIONAL_SETTLEMENT_REFUND",
          status: "COMPLETED",
        }),
        txHash,
      );
      expect(mockUpdateCommerceOrderStatus).toHaveBeenCalledWith(
        expect.anything(),
        "order_123",
        "REFUNDED",
      );
      expect(mockUpdateStoredPaymentIntent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          production_status: "refunded",
        }),
        expect.objectContaining({
          conditional_settlement: expect.objectContaining({
            status: "REFUND_CONFIRMED",
            refund_buyer_wallet: buyerWallet,
            refund_amount_minor: "100000000",
          }),
        }),
      );
    } finally {
      if (originalRpc === undefined) delete process.env.HAGGLE_BASE_RPC_URL;
      else process.env.HAGGLE_BASE_RPC_URL = originalRpc;
    }
  });

  it("POST /payments/:id/x402/conditional-refund-confirmation keeps one-block receipts pending without final mutation", async () => {
    const originalRpc = process.env.HAGGLE_BASE_RPC_URL;
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    const settlementId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const txHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const intent = {
      id: "pi_conditional_refund_one_block",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 10_000 },
      status: "SETTLEMENT_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById.mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        conditional_settlement: { settlement_id: settlementId, refund_tx_hash: txHash },
      },
    } as never);
    mockCreatePublicClient.mockReturnValueOnce({
      getBlockNumber: vi.fn().mockResolvedValue(100n),
      getBlock: vi.fn(),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 100n,
        logs: [
          {
            address: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
            topics: ["0x1"],
            data: "0x",
          },
        ],
      }),
    } as never);
    mockDecodeEventLog.mockClear();
    mockCreateRefundRecord.mockClear();
    mockUpdateCommerceOrderStatus.mockClear();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_conditional_refund_one_block/x402/conditional-refund-confirmation",
        headers: ADMIN_HEADERS,
      });
      expect(res.statusCode).toBe(202);
      expect(res.headers["retry-after"]).toBe("2");
      expect(res.json()).toMatchObject({
        conditional_settlement: {
          status: "REFUND_CONFIRMATIONS_PENDING",
          finality: { observed_confirmations: 1, required_confirmations: 2 },
        },
        retry: { after_seconds: 2, reuse_transaction_hash: true, use_new_idempotency_key: true },
      });
      expect(mockDecodeEventLog).not.toHaveBeenCalled();
      expect(mockCreateRefundRecord).not.toHaveBeenCalled();
      expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
    } finally {
      if (originalRpc === undefined) delete process.env.HAGGLE_BASE_RPC_URL;
      else process.env.HAGGLE_BASE_RPC_URL = originalRpc;
    }
  });

  it("POST /payments/:id/x402/conditional-refund-confirmation blocks orphaned receipt blocks without final mutation", async () => {
    const originalRpc = process.env.HAGGLE_BASE_RPC_URL;
    process.env.HAGGLE_BASE_RPC_URL = "https://base-rpc.test";
    const settlementId = `0x${"aa".repeat(32)}`;
    const txHash = `0x${"bb".repeat(32)}`;
    const receiptBlockHash = `0x${"cc".repeat(32)}`;
    const intent = {
      id: "pi_conditional_refund_orphaned",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 10_000 },
      status: "SETTLEMENT_PENDING",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById.mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        conditional_settlement: { settlement_id: settlementId, refund_tx_hash: txHash },
      },
    } as never);
    mockCreatePublicClient.mockReturnValueOnce({
      getBlockNumber: vi.fn().mockResolvedValue(101n),
      getBlock: vi.fn().mockResolvedValue({ hash: `0x${"dd".repeat(32)}` }),
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 100n,
        blockHash: receiptBlockHash,
        logs: [
          {
            address: process.env.HAGGLE_CONDITIONAL_SETTLEMENT_ADDRESS,
            topics: ["0x1"],
            data: "0x",
          },
        ],
      }),
    } as never);
    mockDecodeEventLog.mockClear();
    mockCreateRefundRecord.mockClear();
    mockUpdateCommerceOrderStatus.mockClear();

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_conditional_refund_orphaned/x402/conditional-refund-confirmation",
        headers: ADMIN_HEADERS,
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        conditional_settlement: {
          status: "REFUND_FINALITY_UNAVAILABLE",
          finality: { reason: "RECEIPT_BLOCK_NOT_CANONICAL" },
        },
      });
      expect(res.json()).not.toHaveProperty("retry");
      expect(mockDecodeEventLog).not.toHaveBeenCalled();
      expect(mockCreateRefundRecord).not.toHaveBeenCalled();
      expect(mockUpdateCommerceOrderStatus).not.toHaveBeenCalled();
    } finally {
      if (originalRpc === undefined) delete process.env.HAGGLE_BASE_RPC_URL;
      else process.env.HAGGLE_BASE_RPC_URL = originalRpc;
    }
  });

  it("POST /payments/:id/quote returns buyer-visible amount and fee confirmation", async () => {
    const originalFeeBps = process.env.HAGGLE_X402_FEE_BPS;
    const originalStripeFeeBps = process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS;
    process.env.HAGGLE_X402_FEE_BPS = "150";
    process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS = "150";
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    const intent = {
      id: "pi_quote_stripe",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe", "x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_quote_stripe/quote",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        intent: {
          id: "pi_quote_stripe",
          status: "QUOTED",
          amount: { currency: "USD", amount_minor: 50_000 },
        },
        value: {
          rail: "stripe",
          amount: { currency: "USD", amount_minor: 50_000 },
        },
        quote_confirmation: {
          rail: "stripe",
          display: {
            rail_label: "Card via Stripe",
            payment_method_label: "Pay by card; Stripe converts to USDC on Base",
            settlement_asset: "USDC",
            settlement_network: "Base",
          },
          amount: { currency: "USD", amount_minor: 50_000 },
          buyer_total: { currency: "USD", amount_minor: 50_750 },
          seller_receives: { currency: "USD", amount_minor: 49_250 },
          amount_confirmation: {
            order_amount: { currency: "USD", amount_minor: 50_000, decimals: 2 },
            buyer_pays: { currency: "USD", amount_minor: 50_750, decimals: 2 },
            settlement_amount: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            seller_receives: { currency: "USDC", amount_minor: 492_500_000, decimals: 6 },
            buyer_fee: { currency: "USD", amount_minor: 750, decimals: 2 },
            seller_fee: { currency: "USDC", amount_minor: 7_500_000, decimals: 6 },
          },
          fees: {
            buyer_fee_total: { currency: "USD", amount_minor: 750 },
            seller_fee_total: { currency: "USD", amount_minor: 750 },
            items: expect.arrayContaining([
              expect.objectContaining({
                code: "haggle_platform_fee",
                payer: "negotiated_total",
                amount: { currency: "USD", amount_minor: 750 },
                included_in_buyer_total: true,
              }),
              expect.objectContaining({
                code: "stripe_onramp_fee",
                payer: "buyer",
                amount: { currency: "USD", amount_minor: 750 },
                included_in_buyer_total: false,
              }),
            ]),
          },
        },
      });
      expect(mockUpdateStoredPaymentIntent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: "pi_quote_stripe", status: "QUOTED" }),
        expect.objectContaining({
          quote_confirmation: expect.objectContaining({
            buyer_total: { currency: "USD", amount_minor: 50_750 },
          }),
        }),
      );
    } finally {
      if (originalFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
      else process.env.HAGGLE_X402_FEE_BPS = originalFeeBps;
      if (originalStripeFeeBps === undefined) delete process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS;
      else process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS = originalStripeFeeBps;
    }
  });

  it("POST /payments/:id/quote requires idempotency key in production before provider quote", async () => {
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    const originalVercelEnv = process.env.VERCEL_ENV;
    const originalJwtSecret = process.env.SUPABASE_JWT_SECRET;
    const originalStripeMode = process.env.STRIPE_MODE;
    process.env.VERCEL_ENV = "production";
    process.env.SUPABASE_JWT_SECRET = "test-secret";
    process.env.STRIPE_MODE = "real";
    const token = jwt.sign(
      { sub: "test-user-001", email: "test@haggle.ai", role: "authenticated" },
      "test-secret",
    );
    const intent = {
      id: "pi_quote_prod_no_idem",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "stripe",
      allowed_rails: ["stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_quote_prod_no_idem/quote",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: "IDEMPOTENCY_KEY_REQUIRED" });
      expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
      expect(mockCreatePaymentOperationIdempotencyRecord).not.toHaveBeenCalled();
    } finally {
      if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = originalVercelEnv;
      if (originalJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
      else process.env.SUPABASE_JWT_SECRET = originalJwtSecret;
      if (originalStripeMode === undefined) delete process.env.STRIPE_MODE;
      else process.env.STRIPE_MODE = originalStripeMode;
    }
  });

  it("POST /payments/:id/quote confirms x402 amount, seller payout, and platform fee", async () => {
    const originalFeeBps = process.env.HAGGLE_X402_FEE_BPS;
    const originalSellerWallet = process.env.HAGGLE_X402_SELLER_WALLET;
    process.env.HAGGLE_X402_FEE_BPS = "150";
    process.env.HAGGLE_X402_SELLER_WALLET = "0x1111111111111111111111111111111111111111";
    mockGetPaymentIntentById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    const intent = {
      id: "pi_quote_x402",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_quote_x402/quote",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        intent: {
          id: "pi_quote_x402",
          status: "QUOTED",
          amount: { currency: "USD", amount_minor: 50_000 },
        },
        value: {
          rail: "x402",
          amount: { currency: "USD", amount_minor: 50_000 },
        },
        metadata: {
          seller_wallet: "0x1111111111111111111111111111111111111111",
          quote_confirmation: expect.objectContaining({
            buyer_total: { currency: "USD", amount_minor: 50_000 },
            seller_receives: { currency: "USD", amount_minor: 49_250 },
          }),
        },
        quote_confirmation: {
          rail: "x402",
          display: {
            rail_label: "USDC Direct",
            payment_method_label: "Pay from wallet with USDC on Base",
            settlement_asset: "USDC",
            settlement_network: "Base",
          },
          amount: { currency: "USD", amount_minor: 50_000 },
          buyer_total: { currency: "USD", amount_minor: 50_000 },
          seller_receives: { currency: "USD", amount_minor: 49_250 },
          amount_confirmation: {
            order_amount: { currency: "USD", amount_minor: 50_000, decimals: 2 },
            buyer_pays: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            settlement_amount: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            seller_receives: { currency: "USDC", amount_minor: 492_500_000, decimals: 6 },
            buyer_fee: { currency: "USDC", amount_minor: 0, decimals: 6 },
            seller_fee: { currency: "USDC", amount_minor: 7_500_000, decimals: 6 },
          },
          fees: {
            buyer_fee_total: { currency: "USD", amount_minor: 0 },
            seller_fee_total: { currency: "USD", amount_minor: 750 },
            items: [
              expect.objectContaining({
                code: "haggle_platform_fee",
                payer: "negotiated_total",
                amount: { currency: "USD", amount_minor: 750 },
                rate_bps: 150,
              }),
            ],
          },
        },
      });
      expect(mockUpdateStoredPaymentIntent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: "pi_quote_x402", status: "QUOTED" }),
        expect.objectContaining({
          seller_wallet: "0x1111111111111111111111111111111111111111",
          quote_confirmation: expect.objectContaining({
            seller_receives: { currency: "USD", amount_minor: 49_250 },
          }),
        }),
      );
    } finally {
      if (originalFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
      else process.env.HAGGLE_X402_FEE_BPS = originalFeeBps;
      if (originalSellerWallet === undefined) delete process.env.HAGGLE_X402_SELLER_WALLET;
      else process.env.HAGGLE_X402_SELLER_WALLET = originalSellerWallet;
    }
  });

  it("POST /payments/:id/quote defaults seller payout to a 1.5% platform fee", async () => {
    const originalFeeBps = process.env.HAGGLE_X402_FEE_BPS;
    const originalSellerWallet = process.env.HAGGLE_X402_SELLER_WALLET;
    delete process.env.HAGGLE_X402_FEE_BPS;
    process.env.HAGGLE_X402_SELLER_WALLET = "0x1111111111111111111111111111111111111111";
    mockGetPaymentIntentById.mockClear();
    const intent = {
      id: "pi_quote_default_fee",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_quote_default_fee/quote",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        quote_confirmation: {
          seller_receives: { currency: "USD", amount_minor: 49_250 },
          fees: {
            seller_fee_total: { currency: "USD", amount_minor: 750 },
            items: [
              expect.objectContaining({
                code: "haggle_platform_fee",
                rate_bps: 150,
              }),
            ],
          },
        },
      });
    } finally {
      if (originalFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
      else process.env.HAGGLE_X402_FEE_BPS = originalFeeBps;
      if (originalSellerWallet === undefined) delete process.env.HAGGLE_X402_SELLER_WALLET;
      else process.env.HAGGLE_X402_SELLER_WALLET = originalSellerWallet;
    }
  });

  it("POST /payments/:id/quote rounds the 1.5% platform fee down to minor units", async () => {
    const originalFeeBps = process.env.HAGGLE_X402_FEE_BPS;
    const originalSellerWallet = process.env.HAGGLE_X402_SELLER_WALLET;
    delete process.env.HAGGLE_X402_FEE_BPS;
    process.env.HAGGLE_X402_SELLER_WALLET = "0x1111111111111111111111111111111111111111";
    mockGetPaymentIntentById.mockClear();
    const intent = {
      id: "pi_quote_fee_rounding",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 333 },
      status: "CREATED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_quote_fee_rounding/quote",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        quote_confirmation: {
          amount: { currency: "USD", amount_minor: 333 },
          seller_receives: { currency: "USD", amount_minor: 329 },
          fees: {
            seller_fee_total: { currency: "USD", amount_minor: 4 },
            items: [
              expect.objectContaining({
                code: "haggle_platform_fee",
                amount: { currency: "USD", amount_minor: 4 },
                rate_bps: 150,
              }),
            ],
          },
        },
      });
    } finally {
      if (originalFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
      else process.env.HAGGLE_X402_FEE_BPS = originalFeeBps;
      if (originalSellerWallet === undefined) delete process.env.HAGGLE_X402_SELLER_WALLET;
      else process.env.HAGGLE_X402_SELLER_WALLET = originalSellerWallet;
    }
  });

  it("POST /payments/:id/quote is idempotent after an intent is already quoted", async () => {
    const originalFeeBps = process.env.HAGGLE_X402_FEE_BPS;
    process.env.HAGGLE_X402_FEE_BPS = "150";
    mockGetPaymentIntentById.mockClear();
    mockGetPaymentIntentRowById.mockClear();
    mockUpdateStoredPaymentIntent.mockClear();
    const intent = {
      id: "pi_already_quoted",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);
    mockGetPaymentIntentRowById.mockResolvedValueOnce({
      providerContext: {
        seller_amount_minor: 49_250,
        haggle_fee_minor: 750,
        quote_confirmation: {
          rail: "x402",
          currency: "USD",
          amount: { currency: "USD", amount_minor: 50_000 },
          buyer_total: { currency: "USD", amount_minor: 50_000 },
          seller_receives: { currency: "USD", amount_minor: 49_250 },
          amount_confirmation: {
            buyer_pays: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            settlement_amount: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            seller_receives: { currency: "USDC", amount_minor: 492_500_000, decimals: 6 },
          },
          fees: {
            buyer_fee_total: { currency: "USD", amount_minor: 0 },
            seller_fee_total: { currency: "USD", amount_minor: 750 },
            items: [],
          },
          expires_at: "2030-01-01T00:00:00.000Z",
          provider_reference: "x402_quote_existing",
        },
      },
    } as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_already_quoted/quote",
        headers: AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        idempotent: true,
        intent: {
          id: "pi_already_quoted",
          status: "QUOTED",
        },
        quote_confirmation: {
          rail: "x402",
          display: {
            rail_label: "USDC Direct",
            payment_method_label: "Pay from wallet with USDC on Base",
            settlement_asset: "USDC",
            settlement_network: "Base",
          },
          amount: { currency: "USD", amount_minor: 50_000 },
          buyer_total: { currency: "USD", amount_minor: 50_000 },
          seller_receives: { currency: "USD", amount_minor: 49_250 },
          amount_confirmation: {
            order_amount: { currency: "USD", amount_minor: 50_000, decimals: 2 },
            buyer_pays: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            settlement_amount: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            seller_receives: { currency: "USDC", amount_minor: 492_500_000, decimals: 6 },
            buyer_fee: { currency: "USDC", amount_minor: 0, decimals: 6 },
            seller_fee: { currency: "USDC", amount_minor: 7_500_000, decimals: 6 },
          },
          fees: {
            buyer_fee_total: { currency: "USD", amount_minor: 0 },
            seller_fee_total: { currency: "USD", amount_minor: 750 },
          },
          expires_at: "2030-01-01T00:00:00.000Z",
          provider_reference: "x402_quote_existing",
        },
      });
      expect(mockUpdateStoredPaymentIntent).not.toHaveBeenCalled();
    } finally {
      if (originalFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
      else process.env.HAGGLE_X402_FEE_BPS = originalFeeBps;
    }
  });

  it("POST /payments/:id/onramp/session returns the buyer payable amount while funding the negotiated amount", async () => {
    const originalStripeSecret = process.env.STRIPE_SECRET_KEY;
    const originalStripePublishable = process.env.STRIPE_PUBLISHABLE_KEY;
    const originalStripeFeeBps = process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS;
    const originalHaggleFeeBps = process.env.HAGGLE_X402_FEE_BPS;
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_123";
    process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS = "150";
    process.env.HAGGLE_X402_FEE_BPS = "150";
    (
      globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
    ).__HAGGLE_TEST_DB_SELECT_ROWS__ = [
      [{ walletAddress: "0x1111111111111111111111111111111111111111" }],
      [{ walletAddress: "0x2222222222222222222222222222222222222222" }],
    ];
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "cos_123",
        client_secret: "cos_secret_123",
        redirect_url: "https://stripe.test/onramp",
        status: "requires_payment",
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    mockGetPaymentIntentById.mockClear();
    const intent = {
      id: "pi_onramp_buyer_total",
      order_id: "order_123",
      seller_id: "seller_123",
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "QUOTED",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockGetPaymentIntentById
      .mockResolvedValueOnce(intent as never)
      .mockResolvedValueOnce(intent as never);

    try {
      const res = await app.inject({
        method: "POST",
        url: "/payments/pi_onramp_buyer_total/onramp/session",
        headers: AUTH_HEADERS,
        payload: {
          destination_wallet: "0x1111111111111111111111111111111111111111",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        onramp_session_id: "cos_123",
        client_secret: "cos_secret_123",
        stripe_publishable_key: "pk_test_123",
        amount_usd: "507.50",
        destination_amount_usd: "500.00",
        destination_amount: { currency: "USD", amount_minor: 50_000 },
        buyer_payable: { currency: "USD", amount_minor: 50_750 },
        seller_receives: { currency: "USD", amount_minor: 49_250 },
        fee_breakdown: {
          buyer_fee_total: { currency: "USD", amount_minor: 750 },
          seller_fee_total: { currency: "USD", amount_minor: 750 },
        },
        quote_confirmation: {
          rail: "stripe",
          buyer_total: { currency: "USD", amount_minor: 50_750 },
          seller_receives: { currency: "USD", amount_minor: 49_250 },
          amount_confirmation: {
            buyer_pays: { currency: "USD", amount_minor: 50_750, decimals: 2 },
            settlement_amount: { currency: "USDC", amount_minor: 500_000_000, decimals: 6 },
            seller_receives: { currency: "USDC", amount_minor: 492_500_000, decimals: 6 },
          },
        },
      });
      const body = new URLSearchParams(String(mockFetch.mock.calls[0]?.[1]?.body));
      expect(body.get("destination_amount")).toBe("500.00");
      expect(body.get("metadata[destination_amount_minor]")).toBe("500000000");
      expect(body.get("metadata[destination_amount_usd_minor]")).toBe("50000");
      expect(body.get("metadata[buyer_total_minor]")).toBe("50750");
      expect(body.get("metadata[buyer_fee_minor]")).toBe("750");
      expect(body.get("metadata[seller_receives_minor]")).toBe("49250");
      expect(body.get("metadata[seller_fee_minor]")).toBe("750");
    } finally {
      vi.unstubAllGlobals();
      delete (globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] })
        .__HAGGLE_TEST_DB_SELECT_ROWS__;
      if (originalStripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = originalStripeSecret;
      if (originalStripePublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
      else process.env.STRIPE_PUBLISHABLE_KEY = originalStripePublishable;
      if (originalStripeFeeBps === undefined) delete process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS;
      else process.env.HAGGLE_STRIPE_ONRAMP_FEE_BPS = originalStripeFeeBps;
      if (originalHaggleFeeBps === undefined) delete process.env.HAGGLE_X402_FEE_BPS;
      else process.env.HAGGLE_X402_FEE_BPS = originalHaggleFeeBps;
    }
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

  it("POST /payments/prepare rejects ambiguous settlement approval sources before persistence lookup", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const now = new Date().toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: "00000000-0000-4000-a000-000000000099",
        settlement_approval: {
          id: "00000000-0000-4000-a000-000000000099",
          approval_state: "APPROVED",
          seller_policy: {
            mode: "AUTO_WITHIN_POLICY",
            fulfillment_sla: { shipment_input_due_days: 3 },
            responsiveness: {
              median_response_minutes: 30,
              p95_response_minutes: 120,
              reliable_fast_responder: true,
            },
          },
          terms: {
            listing_id: "00000000-0000-4000-a000-000000000011",
            seller_id: "00000000-0000-4000-a000-000000000033",
            buyer_id: "test-user-001",
            final_amount_minor: 50_000,
            currency: "USD",
            selected_payment_rail: "x402",
          },
          buyer_approved_at: now,
          seller_approved_at: now,
          created_at: now,
          updated_at: now,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "INVALID_PAYMENT_PREPARE_REQUEST",
    });
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare rejects monetary values outside the safe integer range", async () => {
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    const now = new Date().toISOString();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval: {
          id: "00000000-0000-4000-a000-000000000099",
          approval_state: "APPROVED",
          seller_policy: {
            mode: "AUTO_WITHIN_POLICY",
            fulfillment_sla: { shipment_input_due_days: 3 },
            responsiveness: {
              median_response_minutes: 30,
              p95_response_minutes: 120,
              reliable_fast_responder: true,
            },
          },
          terms: {
            listing_id: "00000000-0000-4000-a000-000000000011",
            seller_id: "00000000-0000-4000-a000-000000000033",
            buyer_id: "test-user-001",
            final_amount_minor: Number.MAX_SAFE_INTEGER + 1,
            currency: "USD",
            selected_payment_rail: "x402",
          },
          buyer_approved_at: now,
          seller_approved_at: now,
          created_at: now,
          updated_at: now,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_PAYMENT_PREPARE_REQUEST");
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare rejects invalid disclosure acknowledgement timestamp before persistence lookup", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: "00000000-0000-4000-a000-000000000099",
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: "not-a-date",
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: false,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "INVALID_PAYMENT_PREPARE_REQUEST",
    });
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare rejects missing disclosure acknowledgement timestamp before persistence lookup", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: "00000000-0000-4000-a000-000000000099",
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: false,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "INVALID_PAYMENT_PREPARE_REQUEST",
    });
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare rejects malformed settlement approval ids before persistence lookup", async () => {
    mockGetSettlementApprovalById.mockClear();
    mockEnsureCommerceOrderForApproval.mockClear();
    mockCreateStoredPaymentIntent.mockClear();

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: "not-a-uuid",
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: new Date().toISOString(),
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: false,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "INVALID_PAYMENT_PREPARE_REQUEST",
    });
    expect(mockGetSettlementApprovalById).not.toHaveBeenCalled();
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare rejects a non-approved settlement approval before creating order or intent", async () => {
    mockEnsureCommerceOrderForApproval.mockClear();
    mockGetActivePaymentIntentByOrderId.mockClear();
    mockCreateAgentPaymentGrantRecord.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    mockCreatePaymentDisclosureRecord.mockClear();

    const sessionId = "00000000-0000-4000-a000-000000000099";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const now = new Date().toISOString();

    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: sessionId,
      approval_state: "RESERVED_PENDING_APPROVAL",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: "test-user-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
      buyer_approved_at: now,
      created_at: now,
      updated_at: now,
    });

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: now,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "PAYMENT_NOT_READY",
      message: "payment execution requires APPROVED settlement, got RESERVED_PENDING_APPROVAL",
    });
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockGetActivePaymentIntentByOrderId).not.toHaveBeenCalled();
    expect(mockCreateAgentPaymentGrantRecord).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentDisclosureRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare hides another buyer's settlement approval before creating order or intent", async () => {
    mockEnsureCommerceOrderForApproval.mockClear();
    mockGetActivePaymentIntentByOrderId.mockClear();
    mockCreateAgentPaymentGrantRecord.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    mockCreatePaymentDisclosureRecord.mockClear();

    const sessionId = "00000000-0000-4000-a000-000000000099";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const now = new Date().toISOString();

    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: sessionId,
      approval_state: "APPROVED",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: "another-buyer-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
      buyer_approved_at: now,
      seller_approved_at: now,
      created_at: now,
      updated_at: now,
    });

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: now,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: "SETTLEMENT_APPROVAL_NOT_FOUND",
    });
    expect(mockEnsureCommerceOrderForApproval).not.toHaveBeenCalled();
    expect(mockGetActivePaymentIntentByOrderId).not.toHaveBeenCalled();
    expect(mockCreateAgentPaymentGrantRecord).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentDisclosureRecord).not.toHaveBeenCalled();
  });

  it("POST /payments/prepare creates an intent from an accepted negotiation settlement approval", async () => {
    mockGetPaymentOperationIdempotencyRecord.mockClear();
    mockCreatePaymentOperationIdempotencyRecord.mockClear();
    mockCompletePaymentOperationIdempotencyRecord.mockClear();
    const sessionId = "00000000-0000-4000-a000-000000000099";
    const orderId = "00000000-0000-4000-a000-000000000088";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const now = new Date().toISOString();

    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: sessionId,
      approval_state: "APPROVED",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: "test-user-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
      buyer_approved_at: now,
      seller_approved_at: now,
      created_at: now,
      updated_at: now,
    });
    mockEnsureCommerceOrderForApproval.mockResolvedValueOnce({
      id: orderId,
      settlementApprovalId: sessionId,
      listingId,
      sellerId,
      buyerId: "test-user-001",
      status: "PAYMENT_PENDING",
      currency: "USD",
      amountMinor: "50000",
      orderSnapshot: {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    } as never);
    mockGetActivePaymentIntentByOrderId.mockResolvedValueOnce(null);
    mockCreateAgentPaymentGrantRecord.mockResolvedValueOnce({
      grant_id: "00000000-0000-4000-a000-000000000077",
      buyer_id: "test-user-001",
      agent_id: "haggle.negotiation_agent",
      listing_id: listingId,
      seller_id: sellerId,
      order_id: orderId,
      settlement_approval_id: sessionId,
      max_amount_minor: 50_000,
      currency: "USD",
      asset: "USDC",
      network: "base",
      allowed_rails: ["x402", "stripe"],
      preferred_rail: "x402",
      terms: [],
      expires_at: now,
      nonce: "nonce",
      human_confirmation_required: true,
      legal_acknowledgements: {
        no_custody: true,
        buyer_approved_rules: true,
        stripe_fallback: true,
        stablecoin_not_investment: true,
      },
      approval_policy_hash: "sha256:policy",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });
    mockCreateStoredPaymentIntent.mockImplementationOnce(async (_db, intent) => intent);
    mockCreatePaymentDisclosureRecord.mockResolvedValueOnce(null as never);
    mockGetPaymentOperationIdempotencyRecord.mockResolvedValueOnce(null);
    mockCreatePaymentOperationIdempotencyRecord.mockResolvedValueOnce({
      operation: "payment.prepare",
      idempotencyKey: "idem-prepare-1",
      paymentIntentId: null,
      requestHash: "sha256:placeholder",
      responseStatus: 409,
      responseBody: { error: "PAYMENT_OPERATION_IN_PROGRESS" },
    } as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: {
        ...AUTH_HEADERS,
        "idempotency-key": "idem-prepare-1",
      },
      payload: {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: now,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mockGetSettlementApprovalById).toHaveBeenCalledWith(expect.anything(), sessionId);
    expect(mockEnsureCommerceOrderForApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: sessionId,
        approval_state: "APPROVED",
      }),
    );
    expect(mockCreateAgentPaymentGrantRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        order_id: orderId,
        settlement_approval_id: sessionId,
        buyer_id: "test-user-001",
        seller_id: sellerId,
        listing_id: listingId,
        max_amount_minor: 50_000,
        preferred_rail: "x402",
        legal_acknowledgements: expect.objectContaining({
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        }),
      }),
      expect.stringMatching(/^sha256:/),
    );
    expect(mockCreateStoredPaymentIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        order_id: orderId,
        buyer_id: "test-user-001",
        seller_id: sellerId,
        selected_rail: "x402",
        amount: { currency: "USD", amount_minor: 50_000 },
      }),
      expect.objectContaining({
        settlement_approval_id: sessionId,
        agent_payment_grant_id: "00000000-0000-4000-a000-000000000077",
      }),
    );
    expect(mockCreatePaymentDisclosureRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agent_payment_grant_id: "00000000-0000-4000-a000-000000000077",
        rail: "x402",
        version: PAYMENT_DISCLOSURE_VERSION,
        text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
      }),
    );
    expect(mockCreatePaymentOperationIdempotencyRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: "payment.prepare",
        idempotencyKey: "idem-prepare-1",
        paymentIntentId: null,
        responseStatus: 409,
        responseBody: expect.objectContaining({
          error: "PAYMENT_OPERATION_IN_PROGRESS",
        }),
      }),
    );
    expect(mockCompletePaymentOperationIdempotencyRecord).toHaveBeenCalledWith(
      expect.anything(),
      "payment.prepare",
      "idem-prepare-1",
      expect.objectContaining({
        responseStatus: 201,
        responseBody: expect.objectContaining({
          intent: expect.objectContaining({
            order_id: orderId,
            status: "CREATED",
          }),
        }),
      }),
    );
    expect(res.json()).toMatchObject({
      intent: {
        order_id: orderId,
        buyer_id: "test-user-001",
        seller_id: sellerId,
        amount: { currency: "USD", amount_minor: 50_000 },
        status: "CREATED",
      },
      participants: {
        buyer_id: "test-user-001",
        seller_id: sellerId,
      },
      settlement_context: {
        settlement_approval_id: sessionId,
        listing_id: listingId,
        amount_minor: 50_000,
      },
    });
  });

  it("POST /payments/prepare returns the existing active intent idempotently for the same accepted negotiation", async () => {
    mockGetActivePaymentIntentByOrderId.mockClear();
    mockCreateAgentPaymentGrantRecord.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    mockCreatePaymentDisclosureRecord.mockClear();

    const sessionId = "00000000-0000-4000-a000-000000000099";
    const orderId = "00000000-0000-4000-a000-000000000088";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const now = new Date().toISOString();
    const existingIntent = {
      id: "00000000-0000-4000-a000-000000000066",
      order_id: orderId,
      seller_id: sellerId,
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: now,
      updated_at: now,
    };

    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: sessionId,
      approval_state: "APPROVED",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: "test-user-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
      buyer_approved_at: now,
      seller_approved_at: now,
      created_at: now,
      updated_at: now,
    });
    mockEnsureCommerceOrderForApproval.mockResolvedValueOnce({
      id: orderId,
      settlementApprovalId: sessionId,
      listingId,
      sellerId,
      buyerId: "test-user-001",
      status: "PAYMENT_PENDING",
      currency: "USD",
      amountMinor: "50000",
      orderSnapshot: {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    } as never);
    mockGetActivePaymentIntentByOrderId.mockResolvedValueOnce(existingIntent as never);

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: now,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetActivePaymentIntentByOrderId).toHaveBeenCalledWith(expect.anything(), orderId);
    expect(mockCreateAgentPaymentGrantRecord).not.toHaveBeenCalled();
    expect(mockCreateStoredPaymentIntent).not.toHaveBeenCalled();
    expect(mockCreatePaymentDisclosureRecord).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      idempotent: true,
      intent: {
        id: existingIntent.id,
        order_id: orderId,
        status: "CREATED",
      },
      settlement_context: {
        settlement_approval_id: sessionId,
        amount_minor: 50_000,
      },
    });
  });

  it("POST /payments/prepare returns the concurrently created active intent when insert hits the active order unique constraint", async () => {
    mockGetActivePaymentIntentByOrderId.mockClear();
    mockCreateAgentPaymentGrantRecord.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    mockCreatePaymentDisclosureRecord.mockClear();

    const sessionId = "00000000-0000-4000-a000-000000000099";
    const orderId = "00000000-0000-4000-a000-000000000088";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const now = new Date().toISOString();
    const concurrentIntent = {
      id: "00000000-0000-4000-a000-000000000066",
      order_id: orderId,
      seller_id: sellerId,
      buyer_id: "test-user-001",
      selected_rail: "x402",
      allowed_rails: ["x402", "stripe"],
      amount: { currency: "USD", amount_minor: 50_000 },
      status: "CREATED",
      created_at: now,
      updated_at: now,
    };

    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: sessionId,
      approval_state: "APPROVED",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: "test-user-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
      buyer_approved_at: now,
      seller_approved_at: now,
      created_at: now,
      updated_at: now,
    });
    mockEnsureCommerceOrderForApproval.mockResolvedValueOnce({
      id: orderId,
      settlementApprovalId: sessionId,
      listingId,
      sellerId,
      buyerId: "test-user-001",
      status: "PAYMENT_PENDING",
      currency: "USD",
      amountMinor: "50000",
      orderSnapshot: {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    } as never);
    mockGetActivePaymentIntentByOrderId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(concurrentIntent as never);
    mockCreateAgentPaymentGrantRecord.mockResolvedValueOnce({
      grant_id: "00000000-0000-4000-a000-000000000077",
      buyer_id: "test-user-001",
      agent_id: "haggle.negotiation_agent",
      listing_id: listingId,
      seller_id: sellerId,
      order_id: orderId,
      settlement_approval_id: sessionId,
      max_amount_minor: 50_000,
      currency: "USD",
      asset: "USDC",
      network: "base",
      allowed_rails: ["x402", "stripe"],
      preferred_rail: "x402",
      terms: [],
      expires_at: now,
      nonce: "nonce",
      human_confirmation_required: true,
      legal_acknowledgements: {
        no_custody: true,
        buyer_approved_rules: true,
        stripe_fallback: true,
        stablecoin_not_investment: true,
      },
      approval_policy_hash: "sha256:policy",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });
    mockCreateStoredPaymentIntent.mockRejectedValueOnce(
      Object.assign(
        new Error(
          'duplicate key value violates unique constraint "uq_active_payment_intents_order_id"',
        ),
        { code: "23505", constraint: "uq_active_payment_intents_order_id" },
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: now,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetActivePaymentIntentByOrderId).toHaveBeenCalledTimes(2);
    expect(mockGetActivePaymentIntentByOrderId).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      orderId,
    );
    expect(mockGetActivePaymentIntentByOrderId).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      orderId,
    );
    expect(mockCreateStoredPaymentIntent).toHaveBeenCalledOnce();
    expect(mockCreatePaymentDisclosureRecord).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      idempotent: true,
      intent: {
        id: concurrentIntent.id,
        order_id: orderId,
        status: "CREATED",
      },
      settlement_context: {
        settlement_approval_id: sessionId,
        amount_minor: 50_000,
      },
    });
  });

  it("POST /payments/prepare does not treat unrelated insert unique errors as idempotent", async () => {
    mockGetActivePaymentIntentByOrderId.mockClear();
    mockCreateAgentPaymentGrantRecord.mockClear();
    mockCreateStoredPaymentIntent.mockClear();
    mockCreatePaymentDisclosureRecord.mockClear();

    const sessionId = "00000000-0000-4000-a000-000000000099";
    const orderId = "00000000-0000-4000-a000-000000000088";
    const listingId = "00000000-0000-4000-a000-000000000011";
    const sellerId = "00000000-0000-4000-a000-000000000033";
    const now = new Date().toISOString();

    mockGetSettlementApprovalById.mockResolvedValueOnce({
      id: sessionId,
      approval_state: "APPROVED",
      seller_policy: {
        mode: "AUTO_WITHIN_POLICY",
        fulfillment_sla: { shipment_input_due_days: 3 },
        responsiveness: {
          median_response_minutes: 30,
          p95_response_minutes: 120,
          reliable_fast_responder: true,
        },
      },
      terms: {
        listing_id: listingId,
        seller_id: sellerId,
        buyer_id: "test-user-001",
        final_amount_minor: 50_000,
        currency: "USD",
        selected_payment_rail: "x402",
      },
      buyer_approved_at: now,
      seller_approved_at: now,
      created_at: now,
      updated_at: now,
    });
    mockEnsureCommerceOrderForApproval.mockResolvedValueOnce({
      id: orderId,
      settlementApprovalId: sessionId,
      listingId,
      sellerId,
      buyerId: "test-user-001",
      status: "PAYMENT_PENDING",
      currency: "USD",
      amountMinor: "50000",
      orderSnapshot: {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    } as never);
    mockGetActivePaymentIntentByOrderId.mockResolvedValueOnce(null);
    mockCreateAgentPaymentGrantRecord.mockResolvedValueOnce({
      grant_id: "00000000-0000-4000-a000-000000000077",
      buyer_id: "test-user-001",
      agent_id: "haggle.negotiation_agent",
      listing_id: listingId,
      seller_id: sellerId,
      order_id: orderId,
      settlement_approval_id: sessionId,
      max_amount_minor: 50_000,
      currency: "USD",
      asset: "USDC",
      network: "base",
      allowed_rails: ["x402", "stripe"],
      preferred_rail: "x402",
      terms: [],
      expires_at: now,
      nonce: "nonce",
      human_confirmation_required: true,
      legal_acknowledgements: {
        no_custody: true,
        buyer_approved_rules: true,
        stripe_fallback: true,
        stablecoin_not_investment: true,
      },
      approval_policy_hash: "sha256:policy",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    });
    mockCreateStoredPaymentIntent.mockRejectedValueOnce(
      Object.assign(
        new Error('duplicate key value violates unique constraint "payment_intents_pkey"'),
        { code: "23505", constraint: "payment_intents_pkey" },
      ),
    );

    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      headers: AUTH_HEADERS,
      payload: {
        settlement_approval_id: sessionId,
        payment_disclosure_ack: {
          version: PAYMENT_DISCLOSURE_VERSION,
          text_hash: PAYMENT_DISCLOSURE_TEXT_HASH,
          accepted_at: now,
          no_custody: true,
          buyer_approved_rules: true,
          stripe_fallback: true,
          stablecoin_not_investment: true,
        },
      },
    });

    expect(res.statusCode).toBe(500);
    expect(mockGetActivePaymentIntentByOrderId).toHaveBeenCalledOnce();
    expect(mockCreatePaymentDisclosureRecord).not.toHaveBeenCalled();
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
    expect(mockCompleteWebhookEvent).toHaveBeenCalled();
  });

  it("POST /payments/webhooks/x402 returns duplicate without applying the event twice", async () => {
    mockClaimWebhookEvent.mockResolvedValueOnce({
      outcome: "duplicate",
      source: "x402",
      eventId: "evt_duplicate",
    });
    mockGetPaymentIntentById.mockClear();
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_duplicate",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: true, action: "duplicate" });
    expect(mockGetPaymentIntentById).not.toHaveBeenCalled();
  });

  it("POST /payments/webhooks/x402 asks the provider to retry while another server owns the claim", async () => {
    mockClaimWebhookEvent.mockResolvedValueOnce({
      outcome: "in_progress",
      source: "x402",
      eventId: "evt_busy",
    });
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_busy",
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_123",
      },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("WEBHOOK_PROCESSING_IN_PROGRESS");
  });

  it("POST /payments/webhooks/x402 rejects a changed payload for the same provider event id", async () => {
    mockClaimWebhookEvent.mockResolvedValueOnce({
      outcome: "payload_conflict",
      source: "x402",
      eventId: "evt_changed",
    });
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      payload: {
        event_id: "evt_changed",
        event_type: "settlement.failed",
        payment_intent_id: "pi_other",
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("WEBHOOK_PAYLOAD_CONFLICT");
    expect(mockFailWebhookEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventId: "evt_changed" }),
    );
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
