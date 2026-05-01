import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "./helpers.js";

// ─── Hoisted mocks (vi.mock factories run before module-level const) ─

const {
  mockCreateSession, mockGetSessionById, mockGetSessionsByUserId,
  mockGetSessionsByGroupId, mockUpdateSessionState, mockBatchUpdateSessionStatus,
  mockCreateRound, mockGetRoundsBySessionId, mockGetRoundByIdempotencyKey,
  mockCreateGroup, mockGetGroupById, mockUpdateGroupStatus,
  mockExecuteNegotiationRound,
  mockExecuteGroupOrchestration, mockExecuteGroupTerminal,
  mockLoadUserMemoryBrief,
  mockEventDispatch,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockGetSessionById: vi.fn(),
  mockGetSessionsByUserId: vi.fn(),
  mockGetSessionsByGroupId: vi.fn(),
  mockUpdateSessionState: vi.fn(),
  mockBatchUpdateSessionStatus: vi.fn(),
  mockCreateRound: vi.fn(),
  mockGetRoundsBySessionId: vi.fn(),
  mockGetRoundByIdempotencyKey: vi.fn(),
  mockCreateGroup: vi.fn(),
  mockGetGroupById: vi.fn(),
  mockUpdateGroupStatus: vi.fn(),
  mockExecuteNegotiationRound: vi.fn(),
  mockExecuteGroupOrchestration: vi.fn(),
  mockExecuteGroupTerminal: vi.fn(),
  mockLoadUserMemoryBrief: vi.fn(),
  mockEventDispatch: vi.fn(),
}));

// ─── Mock data ──────────────────────────────────────────────────────

const mockSession = {
  id: "sess-001",
  groupId: null,
  intentId: null,
  listingId: "listing-001",
  strategyId: "default",
  role: "BUYER" as const,
  status: "ACTIVE",
  buyerId: "buyer-001",
  sellerId: "seller-001",
  counterpartyId: "seller-001",
  currentRound: 1,
  roundsNoConcession: 0,
  lastOfferPriceMinor: "10000",
  lastUtility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
  strategySnapshot: { alpha: { price: 0.4, time: 0.2, reputation: 0.2, satisfaction: 0.2 } },
  version: 1,
  expiresAt: null,
  createdAt: new Date("2026-04-01"),
  updatedAt: new Date("2026-04-01"),
};

const mockGroup = {
  id: "group-001",
  topology: "1_BUYER_N_SELLERS",
  anchorUserId: "buyer-001",
  intentId: null,
  maxSessions: 10,
  status: "ACTIVE",
  version: 1,
  batna: null,
  bestSessionId: null,
  metadata: null,
  createdAt: new Date("2026-04-01"),
  updatedAt: new Date("2026-04-01"),
};

const mockRound = {
  id: "round-001",
  sessionId: "sess-001",
  roundNo: 1,
  senderRole: "BUYER",
  messageType: "OFFER",
  priceminor: "10000",
  counterPriceMinor: "9500",
  utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
  decision: "COUNTER",
  metadata: null,
  idempotencyKey: "idem-001",
  createdAt: new Date("2026-04-01"),
};

// ─── Service mocks ──────────────────────────────────────────────────

vi.mock("../services/negotiation-session.service.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  getSessionsByUserId: (...args: unknown[]) => mockGetSessionsByUserId(...args),
  getSessionsByGroupId: (...args: unknown[]) => mockGetSessionsByGroupId(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
  lockSessionForUpdate: vi.fn().mockResolvedValue(null),
  batchUpdateSessionStatus: (...args: unknown[]) => mockBatchUpdateSessionStatus(...args),
}));

vi.mock("../services/negotiation-round.service.js", () => ({
  createRound: (...args: unknown[]) => mockCreateRound(...args),
  getRoundsBySessionId: (...args: unknown[]) => mockGetRoundsBySessionId(...args),
  getRoundByIdempotencyKey: (...args: unknown[]) => mockGetRoundByIdempotencyKey(...args),
  getLatestRound: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/user-memory-card.service.js", () => ({
  loadUserMemoryBrief: (...args: unknown[]) => mockLoadUserMemoryBrief(...args),
  formatUserMemoryBriefSignals: vi.fn().mockReturnValue([]),
  listUserMemoryCards: vi.fn().mockResolvedValue([]),
  recordUserMemoryCards: vi.fn().mockResolvedValue({ observed: 0 }),
  resetUserMemoryCards: vi.fn().mockResolvedValue({ affected: 0 }),
  suppressUserMemoryCard: vi.fn().mockResolvedValue({ affected: 0 }),
}));

vi.mock("../services/negotiation-group.service.js", () => ({
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  getGroupById: (...args: unknown[]) => mockGetGroupById(...args),
  getActiveGroupsByUser: vi.fn().mockResolvedValue([]),
  updateGroupStatus: (...args: unknown[]) => mockUpdateGroupStatus(...args),
  updateGroupMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/negotiation-executor.js", () => ({
  executeNegotiationRound: (...args: unknown[]) => mockExecuteNegotiationRound(...args),
}));

vi.mock("../lib/group-executor.js", () => ({
  executeGroupOrchestration: (...args: unknown[]) => mockExecuteGroupOrchestration(...args),
  executeGroupTerminal: (...args: unknown[]) => mockExecuteGroupTerminal(...args),
}));

vi.mock("../lib/event-dispatcher.js", () => ({
  createEventDispatcher: vi.fn().mockReturnValue({
    dispatch: (...args: unknown[]) => mockEventDispatch(...args),
    registerHandler: vi.fn(),
  }),
}));

// --- Other service mocks (required by server.ts) ---
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
  getSettlementReleaseById: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByOrderId: vi.fn().mockResolvedValue(null),
  getSettlementReleaseByPaymentIntentId: vi.fn().mockResolvedValue(null),
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

vi.mock("../services/authentication-record.service.js", () => ({
  getAuthenticationByOrderId: vi.fn().mockResolvedValue(null),
  createAuthenticationRecord: vi.fn().mockResolvedValue(null),
  updateAuthenticationRecord: vi.fn().mockResolvedValue(null),
  getAuthenticationById: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/trust-score.service.js", () => ({
  getTrustScore: vi.fn().mockResolvedValue(null),
  upsertTrustScore: vi.fn().mockResolvedValue(null),
  getTrustSnapshot: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/ds-rating.service.js", () => ({
  getDSRating: vi.fn().mockResolvedValue(null),
  upsertDSRating: vi.fn().mockResolvedValue(null),
  getDSPool: vi.fn().mockResolvedValue([]),
  getSpecializations: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/arp-segment.service.js", () => ({
  getSegment: vi.fn().mockResolvedValue(null),
  listSegments: vi.fn().mockResolvedValue([]),
  updateSegmentReviewHours: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/tag.service.js", () => ({
  getTagById: vi.fn().mockResolvedValue(null),
  getTagByNormalizedName: vi.fn().mockResolvedValue(null),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn().mockResolvedValue(null),
  updateTag: vi.fn().mockResolvedValue(null),
  getExpertTags: vi.fn().mockResolvedValue([]),
  upsertExpertTag: vi.fn().mockResolvedValue(null),
  createMergeLog: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/intent.service.js", () => ({
  getIntentById: vi.fn().mockResolvedValue(null),
  getActiveIntentsByCategory: vi.fn().mockResolvedValue([]),
  getIntentsByUserId: vi.fn().mockResolvedValue([]),
  createIntent: vi.fn().mockResolvedValue({ id: "intent-1", status: "ACTIVE" }),
  updateIntentStatus: vi.fn().mockResolvedValue(null),
  getActiveIntentCount: vi.fn().mockResolvedValue(0),
  createMatch: vi.fn().mockResolvedValue(null),
  expireStaleIntents: vi.fn().mockResolvedValue(0),
}));

vi.mock("../services/skill.service.js", () => ({
  getSkillBySkillId: vi.fn().mockResolvedValue(null),
  listSkills: vi.fn().mockResolvedValue([]),
  createSkill: vi.fn().mockResolvedValue(null),
  updateSkillStatus: vi.fn().mockResolvedValue(null),
  updateSkillMetrics: vi.fn().mockResolvedValue(null),
  recordExecution: vi.fn().mockResolvedValue(null),
  getExecutionsBySkillId: vi.fn().mockResolvedValue([]),
}));

vi.mock("../services/draft.service.js", () => ({
  getDraftById: vi.fn().mockResolvedValue(null),
  listDrafts: vi.fn().mockResolvedValue([]),
  createDraft: vi.fn().mockResolvedValue(null),
  updateDraft: vi.fn().mockResolvedValue(null),
  deleteDraft: vi.fn().mockResolvedValue(null),
  publishDraft: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/action-handlers.js", () => ({
  registerActionHandlers: vi.fn(),
}));

// ─── Auth helper ────────────────────────────────────────────────────

const AUTH_HEADERS = {
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJidXllci0wMDEiLCJlbWFpbCI6InRlc3RAaGFnZ2xlLmFpIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.fake",
};

const SESSION_BUYER_AUTH_HEADERS = {
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtYTAwMC0wMDAwMDAwMDAwMTAiLCJlbWFpbCI6InRlc3RAaGFnZ2xlLmFpIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.fake",
};

const SELLER_AUTH_HEADERS = {
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzZWxsZXItMDAxIiwiZW1haWwiOiJzZWxsZXJAaGFnZ2xlLmFpIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.fake",
};

const INTRUDER_AUTH_HEADERS = {
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJpbnRydWRlci0wMDEiLCJlbWFpbCI6ImludHJ1ZGVyQGhhZ2dsZS5haSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.fake",
};

// ─── Valid payloads ─────────────────────────────────────────────────

const VALID_SESSION_PAYLOAD = {
  listing_id: "00000000-0000-4000-a000-000000000001",
  strategy_id: "default",
  role: "BUYER",
  buyer_id: "00000000-0000-4000-a000-000000000010",
  seller_id: "00000000-0000-4000-a000-000000000020",
  counterparty_id: "00000000-0000-4000-a000-000000000020",
  strategy_snapshot: {
    alpha: { price: 0.4, time: 0.2, reputation: 0.2, satisfaction: 0.2 },
    item: { title: "iPhone 15 Pro", category: "electronics" },
    buyer_budget: { max_budget_minor: 95000, target_price_minor: 90000 },
    must_have: ["battery >= 90%"],
  },
};

const VALID_OFFER_PAYLOAD = {
  price_minor: 10000,
  sender_role: "BUYER",
  idempotency_key: "offer-key-001",
};

const VALID_GROUP_PAYLOAD = {
  topology: "1_BUYER_N_SELLERS",
  anchor_user_id: "00000000-0000-4000-a000-000000000010",
};

// =====================================================================
// TESTS
// =====================================================================

describe("Negotiation API", () => {
  let app: FastifyInstance;
  const originalHnpTrustedJwks = process.env.HNP_TRUSTED_JWKS;
  const originalHnpRequireSignature = process.env.HNP_REQUIRE_SIGNATURE;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    if (originalHnpTrustedJwks === undefined) delete process.env.HNP_TRUSTED_JWKS;
    else process.env.HNP_TRUSTED_JWKS = originalHnpTrustedJwks;
    if (originalHnpRequireSignature === undefined) delete process.env.HNP_REQUIRE_SIGNATURE;
    else process.env.HNP_REQUIRE_SIGNATURE = originalHnpRequireSignature;
    await closeTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.HNP_TRUSTED_JWKS;
    delete process.env.HNP_REQUIRE_SIGNATURE;
    // Reset to sensible defaults
    mockCreateSession.mockResolvedValue(mockSession);
    mockGetSessionById.mockResolvedValue(null);
    mockGetSessionsByUserId.mockResolvedValue([]);
    mockGetSessionsByGroupId.mockResolvedValue([]);
    mockUpdateSessionState.mockResolvedValue(null);
    mockCreateRound.mockResolvedValue(null);
    mockCreateGroup.mockResolvedValue(mockGroup);
    mockGetGroupById.mockResolvedValue(null);
    mockUpdateGroupStatus.mockResolvedValue(null);
    mockGetRoundsBySessionId.mockResolvedValue([]);
    mockGetRoundByIdempotencyKey.mockResolvedValue(null);
    mockExecuteNegotiationRound.mockReset();
    mockExecuteGroupOrchestration.mockResolvedValue([]);
    mockExecuteGroupTerminal.mockResolvedValue([]);
    mockLoadUserMemoryBrief.mockResolvedValue(null);
    mockEventDispatch.mockResolvedValue({ action: "no_action" });
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /negotiations/sessions — 세션 생성
  // ═══════════════════════════════════════════════════════════════════

  describe("POST /negotiations/sessions", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("AUTH_REQUIRED");
    });

    it("returns 400 with missing required fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: AUTH_HEADERS,
        payload: { listing_id: "not-a-uuid" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("INVALID_SESSION_REQUEST");
    });

    it("returns 400 with invalid UUID", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: AUTH_HEADERS,
        payload: { ...VALID_SESSION_PAYLOAD, listing_id: "bad-uuid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 201 with valid data", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: SESSION_BUYER_AUTH_HEADERS,
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().session).toBeDefined();
      expect(res.json().session.id).toBe("sess-001");
      expect(mockCreateSession).toHaveBeenCalledOnce();
    });

    it("returns 409 and a follow-up question when buyer readiness is incomplete", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: SESSION_BUYER_AUTH_HEADERS,
        payload: {
          ...VALID_SESSION_PAYLOAD,
          strategy_snapshot: { alpha: { price: 0.4, time: 0.2 } },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "NEGOTIATION_READINESS_INCOMPLETE",
        readiness: {
          ready: false,
          missing_slots: ["product_intent", "budget_boundary", "buyer_priority"],
          question: "What product or category should I negotiate for?",
        },
      });
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("allows buyer session start when HIL memory fills missing readiness slots", async () => {
      mockLoadUserMemoryBrief.mockResolvedValueOnce({
        userId: VALID_SESSION_PAYLOAD.buyer_id,
        items: [
          {
            cardType: "interest",
            memoryKey: "demand_intent:item:iphone",
            summary: "buyer shopping intent: iphone",
            strength: 0.7,
            memory: { normalizedValue: "iphone" },
            evidenceRefs: [],
          },
          {
            cardType: "pricing",
            memoryKey: "price_resistance:ceiling:ceiling_95000",
            summary: "buyer pricing boundary: ceiling_95000",
            strength: 0.7,
            memory: { normalizedValue: "ceiling_95000" },
            evidenceRefs: [],
          },
          {
            cardType: "preference",
            memoryKey: "term_preference:battery:battery_90_plus",
            summary: "buyer term preference: battery >= 90%",
            strength: 0.7,
            memory: { normalizedValue: "battery >= 90%" },
            evidenceRefs: [],
          },
        ],
      });

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: SESSION_BUYER_AUTH_HEADERS,
        payload: {
          ...VALID_SESSION_PAYLOAD,
          strategy_snapshot: { alpha: { price: 0.4, time: 0.2 } },
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockCreateSession).toHaveBeenCalledOnce();
    });

    it("passes optional expires_at to service", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: SESSION_BUYER_AUTH_HEADERS,
        payload: { ...VALID_SESSION_PAYLOAD, expires_at: "2026-04-10T00:00:00Z" },
      });
      expect(res.statusCode).toBe(201);
      const call = mockCreateSession.mock.calls[0];
      expect(call[1].expiresAt).toBeInstanceOf(Date);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /negotiations/sessions — 유저별 세션 목록
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /negotiations/sessions", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/negotiations/sessions?user_id=x" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 without user_id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("MISSING_USER_ID");
    });

    it("returns 403 when querying another user's sessions", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions?user_id=someone-else",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("SESSION_ACTOR_MISMATCH");
    });

    it("returns 200 with empty sessions", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions?user_id=buyer-001",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sessions).toEqual([]);
    });

    it("returns sessions with role and status filters", async () => {
      mockGetSessionsByUserId.mockResolvedValue([mockSession]);
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions?user_id=buyer-001&role=BUYER&status=ACTIVE",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().sessions).toHaveLength(1);
      expect(res.json().sessions[0].id).toBe("sess-001");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /negotiations/sessions/:id — 세션 상세
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /negotiations/sessions/:id", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/negotiations/sessions/sess-001" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions/unknown-id",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("SESSION_NOT_FOUND");
    });

    it("returns 200 with session + rounds", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockGetRoundsBySessionId.mockResolvedValue([mockRound]);

      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions/sess-001",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.session.id).toBe("sess-001");
      expect(body.session.status).toBe("ACTIVE");
      expect(body.rounds).toHaveLength(1);
      expect(body.rounds[0].round_no).toBe(1);
      expect(body.rounds[0].decision).toBe("COUNTER");
    });

    it("returns 403 when actor is not a participant", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions/sess-001",
        headers: INTRUDER_AUTH_HEADERS,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("SESSION_ACTOR_MISMATCH");
      expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
    });

    it("does not expose strategy_snapshot (공정함)", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions/sess-001",
        headers: AUTH_HEADERS,
      });
      expect(res.json().session.strategy_snapshot).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /negotiations/sessions/:id/offers — 오퍼 제출
  // ═══════════════════════════════════════════════════════════════════

  describe("POST /negotiations/sessions/:id/offers", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 with missing idempotency_key", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: { price_minor: 10000, sender_role: "BUYER" },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("INVALID_OFFER_REQUEST");
    });

    it("returns 400 with negative price_minor", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: { ...VALID_OFFER_PAYLOAD, price_minor: -100 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with invalid sender_role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: { ...VALID_OFFER_PAYLOAD, sender_role: "ADMIN" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 when authenticated actor does not match sender_role", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: { ...VALID_OFFER_PAYLOAD, sender_role: "SELLER" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("SESSION_ACTOR_MISMATCH");
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("returns 403 when HNP sender_agent_id does not match authenticated actor", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-1",
            idempotency_key: "hnp-idem-1",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "someone-else",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-1",
              issues: [],
              total_price: { currency: "USD", units_minor: 10000 },
            },
          },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("HNP_SENDER_AGENT_MISMATCH");
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("allows an HNP offer from a delegated agent for the authenticated principal", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false,
        roundId: "round-agent",
        roundNo: 2,
        decision: "COUNTER",
        outgoingPrice: 9500,
        utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
        sessionStatus: "ACTIVE",
      });

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          agent_delegation: {
            principal_user_id: "buyer-001",
            agent_id: "agent-123",
            scopes: ["hnp:negotiate"],
            expires_at_ms: Date.now() + 60_000,
          },
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-agent",
            idempotency_key: "hnp-idem-agent",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "agent-123",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-agent",
              issues: [],
              total_price: { currency: "USD", units_minor: 10000 },
            },
          },
        },
      });

      expect(res.statusCode).toBe(201);
      expect(mockExecuteNegotiationRound).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          protocol: expect.objectContaining({ senderAgentId: "agent-123" }),
        }),
        expect.anything(),
      );
    });

    it("returns 401 when an HNP offer has an invalid detached signature", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-bad-sig",
            idempotency_key: "hnp-idem-bad-sig",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-1",
              issues: [],
              total_price: { currency: "USD", units_minor: 10000 },
            },
            detached_signature: "bad..signature",
          },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        error: "INVALID_SIGNATURE",
        retryable: false,
        related_message_id: "hnp-msg-bad-sig",
      });
      expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("rejects an HNP offer with an unsupported capability before the engine", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "com.other.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-bad-capability",
            idempotency_key: "hnp-idem-bad-capability",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-bad-capability",
              issues: [],
              total_price: { currency: "USD", units_minor: 10000 },
            },
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "INVALID_HNP_ENVELOPE",
        retryable: false,
        related_message_id: "hnp-msg-bad-capability",
      });
      expect(res.json().issues).toEqual([
        expect.objectContaining({ code: "UNSUPPORTED_EXTENSION", field: "capability" }),
      ]);
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("rejects an HNP offer with an unsupported issue namespace before the engine", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-bad-issue",
            idempotency_key: "hnp-idem-bad-issue",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-bad-issue",
              issues: [{ issue_id: "evil.issue.price", value: 10000 }],
              total_price: { currency: "USD", units_minor: 10000 },
            },
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "INVALID_HNP_ENVELOPE",
        related_message_id: "hnp-msg-bad-issue",
      });
      expect(res.json().issues).toEqual([
        expect.objectContaining({ code: "UNSUPPORTED_ISSUE", field: "payload.issues.0.issue_id" }),
      ]);
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("computes and returns a canonical proposal hash when an HNP offer omits one", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false,
        roundId: "round-hnp-hash",
        roundNo: 2,
        decision: "COUNTER",
        outgoingPrice: 48000,
        utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
        sessionStatus: "ACTIVE",
      });

      const payload = {
        hnp: {
          spec_version: "2026-03-09",
          capability: "hnp.core.negotiation",
          session_id: "00000000-0000-4000-a000-000000000099",
          message_id: "hnp-msg-auto-hash",
          idempotency_key: "hnp-idem-auto-hash",
          sequence: 1,
          sent_at_ms: Date.now(),
          expires_at_ms: Date.now() + 60_000,
          sender_agent_id: "buyer-001",
          sender_role: "BUYER",
          type: "OFFER",
          payload: {
            proposal_id: "proposal-auto-hash",
            issues: [
              { issue_id: "hnp.issue.price.total", value: 48000, unit: "USD", kind: "NEGOTIABLE" },
              { issue_id: "vendor.apple.storage_gb", value: 128, unit: "GB", kind: "INFORMATIONAL" },
            ],
            total_price: { currency: "USD", units_minor: 48000 },
            valid_until: "2026-04-29T00:00:00.000Z",
            settlement_preconditions: ["escrow_authorized", "tracked_shipping_required"],
          },
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload,
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        hnp: {
          message_id: "hnp-msg-auto-hash",
          proposal_id: "proposal-auto-hash",
        },
      });
      expect(res.json().hnp.proposal_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(mockExecuteNegotiationRound).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          protocol: expect.objectContaining({
            proposalId: "proposal-auto-hash",
            proposalHash: res.json().hnp.proposal_hash,
            currency: "USD",
            settlementPreconditions: ["escrow_authorized", "tracked_shipping_required"],
          }),
        }),
        expect.anything(),
      );

      const reorderedPayload = {
        hnp: {
          ...payload.hnp,
          message_id: "hnp-msg-auto-hash-reordered",
          idempotency_key: "hnp-idem-auto-hash-reordered",
          payload: {
            ...payload.hnp.payload,
            issues: [...payload.hnp.payload.issues].reverse(),
            settlement_preconditions: ["tracked_shipping_required", "escrow_authorized", "escrow_authorized"],
          },
        },
      };

      const reorderedRes = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: reorderedPayload,
      });

      expect(reorderedRes.statusCode).toBe(201);
      expect(reorderedRes.json().hnp.proposal_hash).toBe(res.json().hnp.proposal_hash);
    });

    it("rejects an HNP offer when the provided proposal hash does not match the terms", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-bad-hash",
            idempotency_key: "hnp-idem-bad-hash",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-bad-hash",
              issues: [
                { issue_id: "hnp.issue.price.total", value: 48000, unit: "USD", kind: "NEGOTIABLE" },
              ],
              total_price: { currency: "USD", units_minor: 48000 },
              proposal_hash: "sha256:not-the-real-hash",
              settlement_preconditions: ["escrow_authorized"],
            },
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "HNP_PROPOSAL_HASH_MISMATCH",
        retryable: false,
        related_message_id: "hnp-msg-bad-hash",
      });
      expect(res.json().expected_proposal_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(mockGetSessionById).not.toHaveBeenCalled();
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("returns 409 before the engine for an out-of-order HNP offer", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          metadata: {
            protocol: {
              hnp: {
                messageId: "hnp-msg-prior",
                sequence: 3,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/offers",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "hnp-msg-late",
            idempotency_key: "hnp-idem-late",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "OFFER",
            payload: {
              proposal_id: "proposal-late",
              issues: [],
              total_price: { currency: "USD", units_minor: 10000 },
            },
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "OUT_OF_ORDER",
        retryable: false,
      });
      expect(mockExecuteNegotiationRound).not.toHaveBeenCalled();
    });

    it("returns 201 with valid offer (new round)", async () => {
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false,
        roundId: "round-new",
        roundNo: 2,
        decision: "COUNTER",
        outgoingPrice: 9500,
        utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
        sessionStatus: "ACTIVE",
      });
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.round_id).toBe("round-new");
      expect(body.decision).toBe("COUNTER");
      expect(body.outgoing_price).toBe(9500);
      expect(body.utility.u_total).toBe(0.6);
      expect(body.session_status).toBe("ACTIVE");
      expect(body.idempotent).toBe(false);
    });

    it("returns 200 for idempotent offer (cached)", async () => {
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: true,
        roundId: "round-001",
        roundNo: 1,
        decision: "COUNTER",
        outgoingPrice: 9500,
        utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
        sessionStatus: "ACTIVE",
      });
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().idempotent).toBe(true);
    });

    it("returns 404 for SESSION_NOT_FOUND", async () => {
      mockExecuteNegotiationRound.mockRejectedValue(new Error("SESSION_NOT_FOUND: xxx"));

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/unknown/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("SESSION_NOT_FOUND");
    });

    it("returns 409 for SESSION_TERMINAL", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockExecuteNegotiationRound.mockRejectedValue(new Error("SESSION_TERMINAL: ACCEPTED"));

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("SESSION_TERMINAL");
    });

    it("returns 410 for SESSION_EXPIRED", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockExecuteNegotiationRound.mockRejectedValue(new Error("SESSION_EXPIRED"));

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().error).toBe("SESSION_EXPIRED");
    });

    it("returns 409 for CONCURRENT_MODIFICATION", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      mockExecuteNegotiationRound.mockRejectedValue(new Error("CONCURRENT_MODIFICATION: version conflict"));

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONCURRENT_MODIFICATION");
    });

    it("triggers group orchestration when session has groupId", async () => {
      const sessionWithGroup = { ...mockSession, groupId: "group-001" };
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false,
        roundId: "round-new",
        roundNo: 2,
        decision: "COUNTER",
        outgoingPrice: 9500,
        utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
        sessionStatus: "ACTIVE",
      });
      mockGetSessionById.mockResolvedValue(sessionWithGroup);

      await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });

      expect(mockExecuteGroupOrchestration).toHaveBeenCalledOnce();
    });

    it("triggers group terminal when session reaches ACCEPTED", async () => {
      const sessionWithGroup = { ...mockSession, groupId: "group-001" };
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false,
        roundId: "round-accept",
        roundNo: 3,
        decision: "ACCEPT",
        outgoingPrice: 9000,
        utility: { u_total: 0.85, v_p: 0.7, v_t: 0.05, v_r: 0.05, v_s: 0.05 },
        sessionStatus: "ACCEPTED",
      });
      mockGetSessionById.mockResolvedValue(sessionWithGroup);

      await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });

      expect(mockExecuteGroupTerminal).toHaveBeenCalledOnce();
    });

    it("includes escalation when engine returns one", async () => {
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false,
        roundId: "round-esc",
        roundNo: 5,
        decision: "ESCALATE",
        outgoingPrice: 9000,
        utility: { u_total: 0.4, v_p: 0.3, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
        sessionStatus: "ACTIVE",
        escalation: { type: "LLM_ASSIST", context: { reason: "stalled" } },
      });
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: VALID_OFFER_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().escalation).toEqual({ type: "LLM_ASSIST", context: { reason: "stalled" } });
    });

    it("accepts optional round_data", async () => {
      mockExecuteNegotiationRound.mockResolvedValue({
        idempotent: false, roundId: "r1", roundNo: 1, decision: "COUNTER",
        outgoingPrice: 9000, utility: { u_total: 0.5, v_p: 0.5, v_t: 0, v_r: 0, v_s: 0 },
        sessionStatus: "ACTIVE",
      });
      mockGetSessionById.mockResolvedValue(mockSession);

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/sess-001/offers",
        headers: AUTH_HEADERS,
        payload: {
          ...VALID_OFFER_PAYLOAD,
          round_data: { r_score: 0.8, i_completeness: 0.9, t_elapsed: 5000 },
        },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /negotiations/sessions/:id/accept — 수락
  // ═══════════════════════════════════════════════════════════════════

  describe("PATCH /negotiations/sessions/:id/accept", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "PATCH", url: "/negotiations/sessions/sess-001/accept" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/unknown/accept",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("SESSION_NOT_FOUND");
    });

    it("returns 409 from non-acceptable status", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "REJECTED" });
      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/accept",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("INVALID_STATUS");
    });

    it("returns stored HNP accept artifacts for an idempotent retry after acceptance", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          id: "accept-round-001",
          roundNo: 2,
          messageType: "ACCEPT",
          decision: "ACCEPT",
          idempotencyKey: "accept-idem-retry",
          metadata: {
            protocol: {
              hnp: {
                messageId: "accept-retry",
                idempotencyKey: "accept-idem-retry",
                sequence: 2,
                senderAgentId: "buyer-001",
                type: "ACCEPT",
                acceptedMessageId: "prior",
                acceptedProposalId: "proposal-retry",
                acceptedProposalHash: "sha256:retry",
              },
            },
            agreement: {
              agreement_id: "agr_retry",
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-retry",
              accepted_proposal_hash: "sha256:retry",
            },
            transaction_handoff: {
              handoff_id: "handoff_retry",
              status: "ready_for_settlement",
            },
            transaction_handoff_summary: {
              handoff_count: 1,
              current_status: "ready_for_settlement",
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-retry",
            idempotency_key: "accept-idem-retry",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-retry",
              accepted_proposal_hash: "sha256:retry",
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        updated: false,
        idempotent: true,
        session_status: "ACCEPTED",
        agreement: {
          agreement_id: "agr_retry",
          accepted_proposal_hash: "sha256:retry",
        },
        transaction_handoff: {
          handoff_id: "handoff_retry",
          status: "ready_for_settlement",
        },
        transaction_handoff_summary: {
          handoff_count: 1,
          current_status: "ready_for_settlement",
        },
      });
      expect(mockUpdateSessionState).not.toHaveBeenCalled();
      expect(mockCreateRound).not.toHaveBeenCalled();
      expect(mockEventDispatch).not.toHaveBeenCalled();
    });

    it("returns 200 from ACTIVE status", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/accept",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().session_status).toBe("ACCEPTED");
    });

    it("returns 200 from NEAR_DEAL status", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "NEAR_DEAL" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/accept",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().updated).toBe(true);
    });

    it("returns 409 on concurrent modification", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue(null); // version mismatch

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/accept",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONCURRENT_MODIFICATION");
    });

    it("does not persist HNP accept agreement/handoff when session update loses the version race", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue(null);
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          counterPriceMinor: "50000",
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-race",
                proposalHash: "sha256:race",
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-race",
            idempotency_key: "accept-idem-race",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-race",
              accepted_proposal_hash: "sha256:race",
            },
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONCURRENT_MODIFICATION");
      expect(mockCreateRound).not.toHaveBeenCalled();
    });

    it("checks participant access before HNP accept ordering", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockGetRoundsBySessionId.mockResolvedValue([{ ...mockRound, metadata: { protocol: { hnp: { messageId: "prior" } } } }]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: INTRUDER_AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "prior",
            idempotency_key: "accept-idem-1",
            sequence: 1,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "intruder-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-1",
            },
          },
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("SESSION_ACTOR_MISMATCH");
      expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
    });

    it("returns 401 when an HNP accept has an invalid detached signature", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-bad-sig",
            idempotency_key: "accept-idem-bad-sig",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-1",
            },
            detached_signature: "bad..signature",
          },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({
        error: "INVALID_SIGNATURE",
        retryable: false,
        related_message_id: "accept-bad-sig",
      });
      expect(mockGetRoundsBySessionId).not.toHaveBeenCalled();
      expect(mockUpdateSessionState).not.toHaveBeenCalled();
    });

    it("returns an agreement object for a hash-bound HNP accept", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          counterPriceMinor: "50000",
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-1",
                proposalHash: "sha256:expected",
                settlementPreconditions: ["escrow_authorized", "tracked_shipping_required"],
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-good-hash",
            idempotency_key: "accept-idem-good-hash",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-1",
              accepted_proposal_hash: "sha256:expected",
              accepted_issues: [
                { issue_id: "hnp.issue.price.total", value: 50000, unit: "USD", kind: "NEGOTIABLE" },
              ],
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        updated: true,
        session_status: "ACCEPTED",
        agreement: {
          session_id: "sess-001",
          accepted_message_id: "prior",
          accepted_proposal_id: "proposal-1",
          accepted_proposal_hash: "sha256:expected",
          agreed_price: { currency: "USD", units_minor: 50000 },
          settlement_preconditions: ["escrow_authorized", "tracked_shipping_required"],
        },
        transaction_handoff: {
          status: "ready_for_settlement",
          next_action: "prepare_settlement",
        },
        transaction_handoff_summary: {
          handoff_count: 1,
          first_status: "ready_for_settlement",
          current_status: "ready_for_settlement",
          current_next_action: "prepare_settlement",
          terminal: false,
        },
      });
      expect(res.json().agreement.agreement_id).toMatch(/^agr_/);
      expect(res.json().agreement.agreement_hash).toMatch(/^sha256:/);
      expect(res.json().transaction_handoff.agreement_hash).toBe(res.json().agreement.agreement_hash);
      expect(res.json().transaction_handoff.handoff_id).toMatch(/^handoff_/);
      expect(res.json().transaction_handoff.handoff_hash).toMatch(/^sha256:/);
      expect(res.json().transaction_handoff_summary.chain_hash).toMatch(/^sha256:/);
      expect(res.json().transaction_handoff_summary.handoff_hashes).toEqual([
        res.json().transaction_handoff.handoff_hash,
      ]);
      expect(mockCreateRound).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          sessionId: "sess-001",
          roundNo: 2,
          senderRole: "BUYER",
          messageType: "ACCEPT",
          priceminor: "50000",
          decision: "ACCEPT",
          idempotencyKey: "accept-idem-good-hash",
          metadata: expect.objectContaining({
            agreement: expect.objectContaining({
              accepted_proposal_hash: "sha256:expected",
            }),
            transaction_handoff: expect.objectContaining({
              status: "ready_for_settlement",
            }),
          }),
        }),
      );
      expect(mockUpdateSessionState).toHaveBeenCalledWith(
        expect.anything(),
        "sess-001",
        1,
        expect.objectContaining({
          status: "ACCEPTED",
          currentRound: 2,
        }),
      );
      expect(mockEventDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "negotiation.agreed",
        payload: expect.objectContaining({
          agreed_price_minor: 50000,
        }),
      }));
    });

    it("returns a human-approval handoff when HNP accept includes payment approval signals", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          counterPriceMinor: "53000",
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-approval",
                proposalHash: "sha256:approval",
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-needs-approval",
            idempotency_key: "accept-idem-needs-approval",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-approval",
              accepted_proposal_hash: "sha256:approval",
              accepted_issues: [
                { issue_id: "hnp.issue.price.total", value: 53000, unit: "USD", kind: "NEGOTIABLE" },
              ],
            },
          },
          transaction_signals: {
            payment_decision: "HUMAN_APPROVAL_REQUIRED",
            payment_reasons: ["above_user_approval_threshold"],
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        transaction_handoff: {
          status: "needs_human_approval",
          next_action: "request_human_approval",
          required_human_approvals: ["above_user_approval_threshold"],
        },
        transaction_handoff_summary: {
          current_status: "needs_human_approval",
          current_next_action: "request_human_approval",
        },
      });
    });

    it("falls back to accepted proposal issues and currency from HNP round metadata", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          counterPriceMinor: "70000",
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-eur",
                proposalHash: "sha256:eurproposal",
                currency: "EUR",
                issues: [
                  { issue_id: "hnp.issue.price.total", value: 70000, unit: "EUR", kind: "NEGOTIABLE" },
                  { issue_id: "hnp.issue.delivery.window", value: "3d", kind: "NEGOTIABLE" },
                ],
                settlementPreconditions: ["escrow_authorized"],
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-eur",
            idempotency_key: "accept-idem-eur",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-eur",
              accepted_proposal_hash: "sha256:eurproposal",
            },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        agreement: {
          accepted_proposal_id: "proposal-eur",
          accepted_proposal_hash: "sha256:eurproposal",
          agreed_price: { currency: "EUR", units_minor: 70000 },
          accepted_issues: [
            { issue_id: "hnp.issue.price.total", value: 70000, unit: "EUR", kind: "NEGOTIABLE" },
            { issue_id: "hnp.issue.delivery.window", value: "3d", kind: "NEGOTIABLE" },
          ],
          settlement_preconditions: ["escrow_authorized"],
        },
      });
      expect(mockEventDispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "negotiation.agreed",
        payload: expect.objectContaining({
          agreed_price_minor: 70000,
        }),
      }));
    });

    it("rejects an HNP accept when accepted issues conflict with the stored proposal", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          counterPriceMinor: "48000",
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-issue-bound",
                proposalHash: "sha256:issuebound",
                currency: "USD",
                issues: [
                  { issue_id: "hnp.issue.price.total", value: 48000, unit: "USD", kind: "NEGOTIABLE" },
                  { issue_id: "vendor.apple.storage_gb", value: 128, unit: "GB", kind: "INFORMATIONAL" },
                ],
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-conflicting-issues",
            idempotency_key: "accept-idem-conflicting-issues",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-issue-bound",
              accepted_proposal_hash: "sha256:issuebound",
              accepted_issues: [
                { issue_id: "hnp.issue.price.total", value: 45000, unit: "USD", kind: "NEGOTIABLE" },
                { issue_id: "vendor.apple.storage_gb", value: 128, unit: "GB", kind: "INFORMATIONAL" },
              ],
            },
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "INVALID_PROPOSAL_ISSUES",
      });
      expect(mockUpdateSessionState).not.toHaveBeenCalled();
      expect(mockEventDispatch).not.toHaveBeenCalledWith(expect.objectContaining({
        type: "negotiation.agreed",
      }));
    });

    it("rejects invalid transaction handoff signals before accepting the session", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-invalid-handoff",
                proposalHash: "sha256:invalidhandoff",
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-invalid-handoff",
            idempotency_key: "accept-idem-invalid-handoff",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-invalid-handoff",
              accepted_proposal_hash: "sha256:invalidhandoff",
            },
          },
          transaction_signals: {
            dispute_evidence_packet_hashes: ["not-a-sha256-hash"],
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: "INVALID_TRANSACTION_HANDOFF",
        issues: [expect.objectContaining({ code: "INVALID_REFERENCE_HASH" })],
      });
      expect(mockUpdateSessionState).not.toHaveBeenCalled();
    });

    it("returns 409 when an HNP accept binds to the wrong proposal hash", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockGetRoundsBySessionId.mockResolvedValue([
        {
          ...mockRound,
          metadata: {
            protocol: {
              hnp: {
                messageId: "prior",
                proposalId: "proposal-1",
                proposalHash: "sha256:expected",
                sequence: 1,
              },
            },
          },
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/00000000-0000-4000-a000-000000000099/accept",
        headers: AUTH_HEADERS,
        payload: {
          hnp: {
            spec_version: "2026-03-09",
            capability: "hnp.core.negotiation",
            session_id: "00000000-0000-4000-a000-000000000099",
            message_id: "accept-wrong-hash",
            idempotency_key: "accept-idem-wrong-hash",
            sequence: 2,
            sent_at_ms: Date.now(),
            expires_at_ms: Date.now() + 60_000,
            sender_agent_id: "buyer-001",
            sender_role: "BUYER",
            type: "ACCEPT",
            payload: {
              accepted_message_id: "prior",
              accepted_proposal_id: "proposal-1",
              accepted_proposal_hash: "sha256:actual",
            },
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "INVALID_PROPOSAL",
      });
      expect(mockUpdateSessionState).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /negotiations/sessions/:id/reject — 거절
  // ═══════════════════════════════════════════════════════════════════

  describe("PATCH /negotiations/sessions/:id/reject", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "PATCH", url: "/negotiations/sessions/sess-001/reject" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/unknown/reject",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 for terminal session", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACCEPTED" });
      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/reject",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("SESSION_TERMINAL");
    });

    it("returns 200 from ACTIVE status", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue({ ...mockSession, status: "REJECTED" });

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/reject",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().session_status).toBe("REJECTED");
    });

    it("returns 409 on concurrent modification", async () => {
      mockGetSessionById.mockResolvedValue({ ...mockSession, status: "ACTIVE" });
      mockUpdateSessionState.mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/sessions/sess-001/reject",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONCURRENT_MODIFICATION");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /negotiations/sessions/:id/state — 경량 상태 (polling)
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /negotiations/sessions/:id/state", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/negotiations/sessions/sess-001/state" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown session", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions/unknown/state",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 200 with lightweight state fields", async () => {
      mockGetSessionById.mockResolvedValue(mockSession);
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/sessions/sess-001/state",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ACTIVE");
      expect(body.current_round).toBe(1);
      expect(body.version).toBe(1);
      expect(body.last_offer_price_minor).toBe("10000");
      expect(body.last_utility).toBeDefined();
      // Must NOT include full session data
      expect(body.id).toBeUndefined();
      expect(body.strategy_snapshot).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /negotiations/sessions/expire-stale — Cron 벌크 만료
  // ═══════════════════════════════════════════════════════════════════

  describe("POST /negotiations/sessions/expire-stale", () => {
    it("returns 200 with expired_count", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions/expire-stale",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().expired_count).toBeDefined();
      expect(typeof res.json().expired_count).toBe("number");
    });
  });
});

// =====================================================================
// GROUP API
// =====================================================================

describe("Group API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGroupById.mockResolvedValue(null);
    mockGetSessionsByGroupId.mockResolvedValue([]);
    mockUpdateGroupStatus.mockResolvedValue(null);
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /negotiations/groups — 그룹 생성
  // ═══════════════════════════════════════════════════════════════════

  describe("POST /negotiations/groups", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups",
        payload: VALID_GROUP_PAYLOAD,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 with invalid topology", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups",
        headers: AUTH_HEADERS,
        payload: { ...VALID_GROUP_PAYLOAD, topology: "INVALID" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 with max_sessions > 50", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups",
        headers: AUTH_HEADERS,
        payload: { ...VALID_GROUP_PAYLOAD, max_sessions: 100 },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 201 with valid data", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups",
        headers: AUTH_HEADERS,
        payload: VALID_GROUP_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().group).toBeDefined();
      expect(mockCreateGroup).toHaveBeenCalledOnce();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /negotiations/groups/:id — 그룹 상세
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /negotiations/groups/:id", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/negotiations/groups/group-001" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown group", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/negotiations/groups/unknown",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("GROUP_NOT_FOUND");
    });

    it("returns 200 with group + sessions", async () => {
      mockGetGroupById.mockResolvedValue(mockGroup);
      mockGetSessionsByGroupId.mockResolvedValue([mockSession]);

      const res = await app.inject({
        method: "GET",
        url: "/negotiations/groups/group-001",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.group.id).toBe("group-001");
      expect(body.group.topology).toBe("1_BUYER_N_SELLERS");
      expect(body.sessions).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /negotiations/groups/:id/sessions — 세션 추가
  // ═══════════════════════════════════════════════════════════════════

  describe("POST /negotiations/groups/:id/sessions", () => {
    it("returns 404 for unknown group", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups/unknown/sessions",
        headers: AUTH_HEADERS,
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when group not ACTIVE", async () => {
      mockGetGroupById.mockResolvedValue({ ...mockGroup, status: "RESOLVED" });
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups/group-001/sessions",
        headers: AUTH_HEADERS,
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("GROUP_NOT_ACTIVE");
    });

    it("returns 409 when capacity exceeded", async () => {
      mockGetGroupById.mockResolvedValue({ ...mockGroup, maxSessions: 1 });
      mockGetSessionsByGroupId.mockResolvedValue([mockSession]); // already 1

      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups/group-001/sessions",
        headers: AUTH_HEADERS,
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("GROUP_CAPACITY_EXCEEDED");
    });

    it("returns 201 with valid session added", async () => {
      mockGetGroupById.mockResolvedValue(mockGroup);
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups/group-001/sessions",
        headers: AUTH_HEADERS,
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().session).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // POST /negotiations/groups/:id/orchestrate — 수동 오케스트레이션
  // ═══════════════════════════════════════════════════════════════════

  describe("POST /negotiations/groups/:id/orchestrate", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: "/negotiations/groups/group-001/orchestrate" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 200 with actions", async () => {
      mockExecuteGroupOrchestration.mockResolvedValue([{ action: "no_action" }]);
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/groups/group-001/orchestrate",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().actions).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /negotiations/groups/:id/cancel — 그룹 취소
  // ═══════════════════════════════════════════════════════════════════

  describe("PATCH /negotiations/groups/:id/cancel", () => {
    it("returns 404 for unknown group", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/groups/unknown/cancel",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when group not ACTIVE", async () => {
      mockGetGroupById.mockResolvedValue({ ...mockGroup, status: "CANCELLED" });
      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/groups/group-001/cancel",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("GROUP_NOT_ACTIVE");
    });

    it("returns 409 on concurrent modification", async () => {
      mockGetGroupById.mockResolvedValue(mockGroup);
      mockUpdateGroupStatus.mockResolvedValue(null); // version mismatch

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/groups/group-001/cancel",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("CONCURRENT_MODIFICATION");
    });

    it("returns 200 on successful cancel", async () => {
      mockGetGroupById.mockResolvedValue(mockGroup);
      mockUpdateGroupStatus.mockResolvedValue({ ...mockGroup, status: "CANCELLED" });

      const res = await app.inject({
        method: "PATCH",
        url: "/negotiations/groups/group-001/cancel",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("CANCELLED");
    });
  });
});

// =====================================================================
// SETTLEMENT APPROVAL API
// =====================================================================

describe("Settlement Approval API", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /settlement-approvals — 승인 목록
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /settlement-approvals", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/settlement-approvals?user_id=buyer-001" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 without user_id", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/settlement-approvals",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("MISSING_USER_ID");
    });

    it("returns 200 with approvals list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/settlement-approvals?user_id=buyer-001",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().approvals).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GET /settlement-approvals/:id — 단일 조회
  // ═══════════════════════════════════════════════════════════════════

  describe("GET /settlement-approvals/:id", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/settlement-approvals/appr-001" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown approval", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/settlement-approvals/unknown",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("APPROVAL_NOT_FOUND");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /settlement-approvals/:id/seller-approve — 판매자 승인
  // ═══════════════════════════════════════════════════════════════════

  describe("PATCH /settlement-approvals/:id/seller-approve", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/settlement-approvals/appr-001/seller-approve",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown approval", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/settlement-approvals/unknown/seller-approve",
        headers: SELLER_AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PATCH /settlement-approvals/:id/buyer-approve — 구매자 승인
  // ═══════════════════════════════════════════════════════════════════

  describe("PATCH /settlement-approvals/:id/buyer-approve", () => {
    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/settlement-approvals/appr-001/buyer-approve",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown approval", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/settlement-approvals/unknown/buyer-approve",
        headers: AUTH_HEADERS,
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
