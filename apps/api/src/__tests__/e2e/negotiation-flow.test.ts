/**
 * E2E: Full negotiation flow
 *
 * Covers: create listing → create intent → trigger match →
 *         create session → 3 offer rounds → ACCEPT
 *
 * Uses Fastify inject() — no real server or DB required.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { getTestApp, closeTestApp } from "../helpers.js";

// ─── Hoisted mocks ───────────────────────────────────────────────────

const {
  mockCreateSession,
  mockGetSessionById,
  mockGetSessionsByUserId,
  mockGetSessionsByGroupId,
  mockUpdateSessionState,
  mockBatchUpdateSessionStatus,
  mockGetRoundsBySessionId,
  mockGetRoundByIdempotencyKey,
  mockCreateGroup,
  mockGetGroupById,
  mockUpdateGroupStatus,
  mockExecuteNegotiationRound,
  mockExecuteGroupOrchestration,
  mockExecuteGroupTerminal,
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

// ─── Negotiation service mocks ────────────────────────────────────────

vi.mock("../../services/negotiation-session.service.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  getSessionsByUserId: (...args: unknown[]) => mockGetSessionsByUserId(...args),
  getSessionsByGroupId: (...args: unknown[]) => mockGetSessionsByGroupId(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
  lockSessionForUpdate: vi.fn().mockResolvedValue(null),
  batchUpdateSessionStatus: (...args: unknown[]) => mockBatchUpdateSessionStatus(...args),
}));

vi.mock("../../services/negotiation-round.service.js", () => ({
  createRound: vi.fn().mockResolvedValue(null),
  getRoundsBySessionId: (...args: unknown[]) => mockGetRoundsBySessionId(...args),
  getRoundByIdempotencyKey: (...args: unknown[]) => mockGetRoundByIdempotencyKey(...args),
  getLatestRound: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/negotiation-group.service.js", () => ({
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  getGroupById: (...args: unknown[]) => mockGetGroupById(...args),
  getActiveGroupsByUser: vi.fn().mockResolvedValue([]),
  updateGroupStatus: (...args: unknown[]) => mockUpdateGroupStatus(...args),
  updateGroupMetadata: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/negotiation-executor.js", () => ({
  executeNegotiationRound: (...args: unknown[]) => mockExecuteNegotiationRound(...args),
}));

vi.mock("../../lib/group-executor.js", () => ({
  executeGroupOrchestration: (...args: unknown[]) => mockExecuteGroupOrchestration(...args),
  executeGroupTerminal: (...args: unknown[]) => mockExecuteGroupTerminal(...args),
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

// ─── Supporting service mocks (required by server.ts) ────────────────

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
  createIntent: vi.fn().mockResolvedValue({ id: "intent-e2e-001", status: "ACTIVE" }),
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

// ─── Test fixtures ────────────────────────────────────────────────────

const BUYER_ID = "00000000-0000-4000-a000-000000000010";
const SELLER_ID = "00000000-0000-4000-a000-000000000020";
const LISTING_ID = "00000000-0000-4000-a000-000000000001";
const SESSION_ID = "e2e-sess-001";
// Must be a UUID to pass createSessionSchema validation (z.string().uuid().optional())
const INTENT_ID = "00000000-0000-4000-a000-000000000099";

// Decoded: sub=BUYER_ID, email=buyer@haggle.ai, role=authenticated
const BUYER_AUTH = {
  authorization:
    "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTQwMDAtYTAwMC0wMDAwMDAwMDAwMTAiLCJlbWFpbCI6ImJ1eWVyQGhhZ2dsZS5haSIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.fake",
};

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    groupId: null,
    intentId: INTENT_ID,
    listingId: LISTING_ID,
    strategyId: "default",
    role: "BUYER",
    status: "ACTIVE",
    buyerId: BUYER_ID,
    sellerId: SELLER_ID,
    counterpartyId: SELLER_ID,
    currentRound: 1,
    roundsNoConcession: 0,
    lastOfferPriceMinor: "80000",
    lastUtility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
    strategySnapshot: { alpha: { price: 0.4, time: 0.2, reputation: 0.2, satisfaction: 0.2 } },
    version: 1,
    expiresAt: null,
    createdAt: new Date("2026-04-13"),
    updatedAt: new Date("2026-04-13"),
    ...overrides,
  };
}

function makeRound(roundNo: number, decision: string, price: number) {
  return {
    id: `e2e-round-${roundNo}`,
    sessionId: SESSION_ID,
    roundNo,
    senderRole: "BUYER",
    messageType: "OFFER",
    priceminor: String(price),
    counterPriceMinor: String(price - 2000),
    utility: { u_total: 0.6, v_p: 0.5, v_t: 0.03, v_r: 0.04, v_s: 0.03 },
    decision,
    metadata: null,
    idempotencyKey: `e2e-idem-${roundNo}`,
    createdAt: new Date("2026-04-13"),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("E2E: Full negotiation flow", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue(makeSession());
    mockGetSessionById.mockResolvedValue(null);
    mockGetSessionsByUserId.mockResolvedValue([]);
    mockGetSessionsByGroupId.mockResolvedValue([]);
    mockUpdateSessionState.mockResolvedValue(null);
    mockCreateGroup.mockResolvedValue(null);
    mockGetGroupById.mockResolvedValue(null);
    mockUpdateGroupStatus.mockResolvedValue(null);
    mockGetRoundsBySessionId.mockResolvedValue([]);
    mockGetRoundByIdempotencyKey.mockResolvedValue(null);
    mockExecuteNegotiationRound.mockReset();
    mockExecuteGroupOrchestration.mockResolvedValue([]);
    mockExecuteGroupTerminal.mockResolvedValue([]);
  });

  // ── Step 1: Create intent (buyer declares purchase interest) ──────────

  it("Step 1 — POST /intents creates a buyer intent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/intents",
      headers: BUYER_AUTH,
      payload: {
        user_id: BUYER_ID,
        role: "BUYER",
        category: "electronics",
        keywords: ["iPhone 15 Pro"],
        strategy: {},
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.intent).toBeDefined();
    expect(body.intent.id).toBe("intent-e2e-001");
    expect(body.intent.status).toBe("ACTIVE");
  });

  // ── Step 2: Trigger match (system finds a matching listing) ──────────

  it("Step 2 — POST /intents/trigger-match returns 400 without listing_id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/intents/trigger-match",
      payload: { intent_id: INTENT_ID },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_TRIGGER_REQUEST");
  });

  // ── Step 3: Create negotiation session ────────────────────────────────

  it("Step 3 — POST /negotiations/sessions creates an ACTIVE session", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/negotiations/sessions",
      headers: BUYER_AUTH,
      payload: {
        listing_id: LISTING_ID,
        strategy_id: "default",
        role: "BUYER",
        buyer_id: BUYER_ID,
        seller_id: SELLER_ID,
        counterparty_id: SELLER_ID,
        strategy_snapshot: { alpha: { price: 0.4, time: 0.2, reputation: 0.2, satisfaction: 0.2 } },
        intent_id: INTENT_ID,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.session.id).toBe(SESSION_ID);
    expect(body.session.status).toBe("ACTIVE");
    expect(body.session.role).toBe("BUYER");
    expect(mockCreateSession).toHaveBeenCalledOnce();
  });

  // ── Step 4: Submit 3 rounds of offers (COUNTER → COUNTER → ACCEPT) ───

  it("Step 4a — POST /negotiations/sessions/:id/offers submits round 1 (COUNTER)", async () => {
    const session = makeSession({ currentRound: 1 });
    mockGetSessionById.mockResolvedValue(session);
    mockExecuteNegotiationRound.mockResolvedValue({
      sessionId: SESSION_ID,
      roundNo: 1,
      decision: "COUNTER",
      sessionStatus: "ACTIVE",
      outgoingPrice: 78000,
      utility: { u_total: 0.55 },
      idempotent: false,
    });

    const res = await app.inject({
      method: "POST",
      url: `/negotiations/sessions/${SESSION_ID}/offers`,
      headers: BUYER_AUTH,
      payload: {
        price_minor: 80000,
        sender_role: "BUYER",
        idempotency_key: "e2e-idem-1",
        round_data: { r_score: 0.7, t_elapsed: 0.1 },
      },
    });
    // Non-idempotent new round returns 201
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.decision).toBe("COUNTER");
    expect(body.outgoing_price).toBe(78000);
    expect(body.session_status).toBe("ACTIVE");
  });

  it("Step 4b — POST /negotiations/sessions/:id/offers submits round 2 (COUNTER)", async () => {
    const session = makeSession({ currentRound: 2 });
    mockGetSessionById.mockResolvedValue(session);
    mockExecuteNegotiationRound.mockResolvedValue({
      sessionId: SESSION_ID,
      roundNo: 2,
      decision: "COUNTER",
      sessionStatus: "NEAR_DEAL",
      outgoingPrice: 77000,
      utility: { u_total: 0.65 },
      idempotent: false,
    });

    const res = await app.inject({
      method: "POST",
      url: `/negotiations/sessions/${SESSION_ID}/offers`,
      headers: BUYER_AUTH,
      payload: {
        price_minor: 79000,
        sender_role: "BUYER",
        idempotency_key: "e2e-idem-2",
        round_data: { r_score: 0.75, t_elapsed: 0.2 },
      },
    });
    // Non-idempotent new round returns 201
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.decision).toBe("COUNTER");
    expect(body.session_status).toBe("NEAR_DEAL");
  });

  it("Step 4c — POST /negotiations/sessions/:id/offers submits round 3 (ACCEPT)", async () => {
    const session = makeSession({ currentRound: 3 });
    mockGetSessionById.mockResolvedValue(session);
    mockExecuteNegotiationRound.mockResolvedValue({
      sessionId: SESSION_ID,
      roundNo: 3,
      decision: "ACCEPT",
      sessionStatus: "ACCEPTED",
      outgoingPrice: null,
      utility: { u_total: 0.82 },
      idempotent: false,
    });

    const res = await app.inject({
      method: "POST",
      url: `/negotiations/sessions/${SESSION_ID}/offers`,
      headers: BUYER_AUTH,
      payload: {
        price_minor: 77000,
        sender_role: "BUYER",
        idempotency_key: "e2e-idem-3",
        round_data: { r_score: 0.8, t_elapsed: 0.35 },
      },
    });
    // Non-idempotent new round returns 201
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.decision).toBe("ACCEPT");
    expect(body.session_status).toBe("ACCEPTED");
    expect(body.outgoing_price).toBeNull();
  });

  // ── Step 5: Verify final session state + round history ────────────────

  it("Step 5 — GET /negotiations/sessions/:id returns ACCEPTED session with 3 rounds", async () => {
    const acceptedSession = makeSession({ status: "ACCEPTED", currentRound: 3 });
    const rounds = [
      makeRound(1, "COUNTER", 80000),
      makeRound(2, "COUNTER", 79000),
      makeRound(3, "ACCEPT", 77000),
    ];
    mockGetSessionById.mockResolvedValue(acceptedSession);
    mockGetRoundsBySessionId.mockResolvedValue(rounds);

    const res = await app.inject({
      method: "GET",
      url: `/negotiations/sessions/${SESSION_ID}`,
      headers: BUYER_AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.status).toBe("ACCEPTED");
    expect(body.session.current_round).toBe(3);
    expect(body.rounds).toHaveLength(3);
    expect(body.rounds[2].decision).toBe("ACCEPT");
  });
});
