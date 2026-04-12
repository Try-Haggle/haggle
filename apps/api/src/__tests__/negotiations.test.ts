import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "./helpers.js";

// ─── Hoisted mocks (vi.mock factories run before module-level const) ─

const {
  mockCreateSession, mockGetSessionById, mockGetSessionsByUserId,
  mockGetSessionsByGroupId, mockUpdateSessionState, mockBatchUpdateSessionStatus,
  mockGetRoundsBySessionId, mockGetRoundByIdempotencyKey,
  mockCreateGroup, mockGetGroupById, mockUpdateGroupStatus,
  mockExecuteNegotiationRound,
  mockExecuteGroupOrchestration, mockExecuteGroupTerminal,
} = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockGetSessionById: vi.fn(),
  mockGetSessionsByUserId: vi.fn(),
  mockGetSessionsByGroupId: vi.fn(),
  mockUpdateSessionState: vi.fn(),
  mockBatchUpdateSessionStatus: vi.fn(),
  mockGetRoundsBySessionId: vi.fn(),
  mockGetRoundByIdempotencyKey: vi.fn(),
  mockCreateGroup: vi.fn(),
  mockGetGroupById: vi.fn(),
  mockUpdateGroupStatus: vi.fn(),
  mockExecuteNegotiationRound: vi.fn(),
  mockExecuteGroupOrchestration: vi.fn(),
  mockExecuteGroupTerminal: vi.fn(),
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
  createRound: vi.fn().mockResolvedValue(null),
  getRoundsBySessionId: (...args: unknown[]) => mockGetRoundsBySessionId(...args),
  getRoundByIdempotencyKey: (...args: unknown[]) => mockGetRoundByIdempotencyKey(...args),
  getLatestRound: vi.fn().mockResolvedValue(null),
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
    dispatch: vi.fn().mockResolvedValue({ action: "no_action" }),
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

const SELLER_AUTH_HEADERS = {
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzZWxsZXItMDAxIiwiZW1haWwiOiJzZWxsZXJAaGFnZ2xlLmFpIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.fake",
};

// ─── Valid payloads ─────────────────────────────────────────────────

const VALID_SESSION_PAYLOAD = {
  listing_id: "00000000-0000-4000-a000-000000000001",
  strategy_id: "default",
  role: "BUYER",
  buyer_id: "00000000-0000-4000-a000-000000000010",
  seller_id: "00000000-0000-4000-a000-000000000020",
  counterparty_id: "00000000-0000-4000-a000-000000000020",
  strategy_snapshot: { alpha: { price: 0.4, time: 0.2, reputation: 0.2, satisfaction: 0.2 } },
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

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to sensible defaults
    mockCreateSession.mockResolvedValue(mockSession);
    mockGetSessionById.mockResolvedValue(null);
    mockGetSessionsByUserId.mockResolvedValue([]);
    mockGetSessionsByGroupId.mockResolvedValue([]);
    mockUpdateSessionState.mockResolvedValue(null);
    mockCreateGroup.mockResolvedValue(mockGroup);
    mockGetGroupById.mockResolvedValue(null);
    mockUpdateGroupStatus.mockResolvedValue(null);
    mockGetRoundsBySessionId.mockResolvedValue([]);
    mockGetRoundByIdempotencyKey.mockResolvedValue(null);
    mockExecuteNegotiationRound.mockReset();
    mockExecuteGroupOrchestration.mockResolvedValue([]);
    mockExecuteGroupTerminal.mockResolvedValue([]);
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
        headers: AUTH_HEADERS,
        payload: VALID_SESSION_PAYLOAD,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().session).toBeDefined();
      expect(res.json().session.id).toBe("sess-001");
      expect(mockCreateSession).toHaveBeenCalledOnce();
    });

    it("passes optional expires_at to service", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/negotiations/sessions",
        headers: AUTH_HEADERS,
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
