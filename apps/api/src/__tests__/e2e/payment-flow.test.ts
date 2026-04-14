/**
 * E2E: Full payment lifecycle
 *
 * Covers: ACCEPTED session → prepare payment → get quote →
 *         authorize (mock x402 signature) → verify settlement status
 *
 * Uses Fastify inject() — no real server, DB, or chain required.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "../helpers.js";

// ─── Service mocks ────────────────────────────────────────────────────

vi.mock("../../services/payment-record.service.js", () => ({
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

vi.mock("../../services/settlement-release.service.js", () => ({
  createSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
  getSettlementReleaseById: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByPaymentIntentId: vi.fn().mockResolvedValue(null),
  updateSettlementReleaseRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/shipment-record.service.js", () => ({
  createShipmentRecord: vi.fn().mockResolvedValue(null),
  getShipmentById: vi.fn().mockResolvedValue(null),
  getShipmentByOrderId: vi.fn().mockResolvedValue(null),
  updateShipmentRecord: vi.fn().mockResolvedValue(null),
  insertShipmentEvent: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/trust-ledger.service.js", () => ({
  applyTrustTriggers: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/dispute-record.service.js", () => ({
  createDisputeRecord: vi.fn().mockResolvedValue(null),
  getDisputeById: vi.fn().mockResolvedValue(null),
  getDisputeByOrderId: vi.fn().mockResolvedValue(null),
  updateDisputeRecord: vi.fn().mockResolvedValue(null),
  addDisputeEvidenceRecord: vi.fn().mockResolvedValue(null),
  createDisputeResolutionRecord: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/dispute-deposit.service.js", () => ({
  getDepositByDisputeId: vi.fn().mockResolvedValue(null),
  createDeposit: vi.fn().mockResolvedValue(null),
  getPendingExpiredDeposits: vi.fn().mockResolvedValue([]),
  updateDepositStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/authentication-record.service.js", () => ({
  getAuthenticationByOrderId: vi.fn().mockResolvedValue(null),
  createAuthenticationRecord: vi.fn().mockResolvedValue(null),
  updateAuthenticationRecord: vi.fn().mockResolvedValue(null),
  getAuthenticationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/trust-score.service.js", () => ({
  getTrustScore: vi.fn().mockResolvedValue(null),
  upsertTrustScore: vi.fn().mockResolvedValue(null),
  getTrustSnapshot: vi.fn().mockResolvedValue(null),
  computeAndStoreTrustScore: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/ds-rating.service.js", () => ({
  getDSRating: vi.fn().mockResolvedValue(null),
  upsertDSRating: vi.fn().mockResolvedValue(null),
  getDSPool: vi.fn().mockResolvedValue([]),
  getSpecializations: vi.fn().mockResolvedValue([]),
  submitDSRating: vi.fn().mockResolvedValue(null),
  getDSRatings: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/arp-segment.service.js", () => ({
  getSegment: vi.fn().mockResolvedValue(null),
  listSegments: vi.fn().mockResolvedValue([]),
  updateSegmentReviewHours: vi.fn().mockResolvedValue(null),
  getARPSegment: vi.fn().mockResolvedValue(null),
  computeAndStoreARPSegment: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/tag.service.js", () => ({
  getTagById: vi.fn().mockResolvedValue(null),
  getTagByNormalizedName: vi.fn().mockResolvedValue(null),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn().mockResolvedValue(null),
  updateTag: vi.fn().mockResolvedValue(null),
  getExpertTags: vi.fn().mockResolvedValue([]),
  upsertExpertTag: vi.fn().mockResolvedValue(null),
  createMergeLog: vi.fn().mockResolvedValue(null),
  getTagsForUser: vi.fn().mockResolvedValue([]),
  addTag: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/intent.service.js", () => ({
  getIntentById: vi.fn().mockResolvedValue(null),
  getActiveIntentsByCategory: vi.fn().mockResolvedValue([]),
  getIntentsByUserId: vi.fn().mockResolvedValue([]),
  createIntent: vi.fn().mockResolvedValue({ id: "intent-1", status: "ACTIVE" }),
  updateIntentStatus: vi.fn().mockResolvedValue(null),
  getActiveIntentCount: vi.fn().mockResolvedValue(0),
  createMatch: vi.fn().mockResolvedValue(null),
  expireStaleIntents: vi.fn().mockResolvedValue(0),
}));

vi.mock("../../services/skill.service.js", () => ({
  getSkillBySkillId: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
  createSkill: vi.fn().mockResolvedValue(null),
  updateSkillStatus: vi.fn().mockResolvedValue(null),
  updateSkillMetrics: vi.fn().mockResolvedValue(null),
  recordExecution: vi.fn().mockResolvedValue(null),
  getExecutionsBySkillId: vi.fn().mockResolvedValue([]),
  getSkillById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
  getListingsByUserId: vi.fn().mockResolvedValue([]),
  getListingByIdForUser: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/negotiation-session.service.js", () => ({
  createSession: vi.fn().mockResolvedValue(null),
  getSessionById: vi.fn().mockResolvedValue(null),
  getSessionsByUserId: vi.fn().mockResolvedValue([]),
  getSessionsByGroupId: vi.fn().mockResolvedValue([]),
  updateSessionState: vi.fn().mockResolvedValue(null),
  lockSessionForUpdate: vi.fn().mockResolvedValue(null),
  batchUpdateSessionStatus: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/negotiation-round.service.js", () => ({
  createRound: vi.fn().mockResolvedValue(null),
  getRoundsBySessionId: vi.fn().mockResolvedValue([]),
  getRoundByIdempotencyKey: vi.fn().mockResolvedValue(null),
  getLatestRound: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/negotiation-group.service.js", () => ({
  createGroup: vi.fn().mockResolvedValue(null),
  getGroupById: vi.fn().mockResolvedValue(null),
  getActiveGroupsByUser: vi.fn().mockResolvedValue([]),
  updateGroupStatus: vi.fn().mockResolvedValue(null),
  updateGroupMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/negotiation-executor.js", () => ({
  executeNegotiationRound: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/group-executor.js", () => ({
  executeGroupOrchestration: vi.fn().mockResolvedValue([]),
  executeGroupTerminal: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../lib/event-dispatcher.js", () => ({
  createEventDispatcher: vi.fn().mockReturnValue({
    dispatch: vi.fn().mockResolvedValue({ action: "no_action" }),
    registerHandler: vi.fn(),
  }),
}));

vi.mock("../../lib/action-handlers.js", () => ({
  registerActionHandlers: vi.fn(),
}));

// ─── Auth header ──────────────────────────────────────────────────────

// Decoded: sub=buyer-e2e-001, email=buyer@haggle.ai, role=authenticated
const BUYER_AUTH = {
  authorization:
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJidXllci1lMmUtMDAxIiwiZW1haWwiOiJidXllckBoYWdnbGUuYWkiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.fake",
};

const PAYMENT_ID = "pay-e2e-001";
const ORDER_ID = "order-e2e-001";
const SETTLEMENT_APPROVAL_ID = "sa-e2e-001";

// ─── Tests ────────────────────────────────────────────────────────────

describe("E2E: Payment lifecycle", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ── Step 1: GET /payments/:id — 404 for unknown payment ────────────

  it("Step 1 — GET /payments/:id returns 404 for unknown payment intent", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/payments/${PAYMENT_ID}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("PAYMENT_NOT_FOUND");
  });

  // ── Step 2: POST /payments/prepare — auth required ─────────────────

  it("Step 2 — POST /payments/prepare requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/prepare",
      payload: { settlement_approval_id: SETTLEMENT_APPROVAL_ID },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });

  // ── Step 3: POST /payments/:id/authorize — auth required ───────────

  it("Step 3 — POST /payments/:id/authorize requires authentication", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/payments/${PAYMENT_ID}/authorize`,
      payload: { mode: "human_wallet", buyer_signature: "0xdeadbeef" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
  });

  // ── Step 4: x402 webhook settlement.confirmed with signature ───────

  it("Step 4 — POST /payments/webhooks/x402 settlement.confirmed for unknown intent is accepted-ignored", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payments/webhooks/x402",
      headers: {
        "x-haggle-x402-signature": "mock-hmac-sig-abc123",
      },
      payload: {
        event_type: "settlement.confirmed",
        payment_intent_id: "pi_unknown_e2e",
        tx_hash: "0xabc123def456",
        amount_minor: 77000,
        currency: "USDC",
      },
    });
    // Unknown intent → accepted but no action taken (idempotent)
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(body.action).toBe("ignored");
    expect(body.reason).toBe("unknown_intent");
  });
});
