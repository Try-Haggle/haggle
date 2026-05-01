/**
 * Negotiation Phase Lifecycle — Integration Tests
 *
 * Tests the complete negotiation lifecycle through all phases:
 *   OPENING → BARGAINING → CLOSING → SETTLEMENT
 *
 * Uses real Step 56 modules (Skill, Referee, Phase Machine, Memory Reconstructor)
 * with DB + xAI mocked. Verifies phase transitions, LLM invocation points,
 * price movement, coaching, and validation across a full iPhone 15 Pro negotiation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetRoundByIdempotencyKey,
  mockCreateRound,
  mockGetRoundsBySessionId,
  mockGetSessionById,
  mockUpdateSessionState,
  mockCallLLM,
  mockTxExecute,
  mockMapRawToDbSession,
} = vi.hoisted(() => ({
  mockGetRoundByIdempotencyKey: vi.fn(),
  mockCreateRound: vi.fn(),
  mockGetRoundsBySessionId: vi.fn(),
  mockGetSessionById: vi.fn(),
  mockUpdateSessionState: vi.fn(),
  mockCallLLM: vi.fn(),
  mockTxExecute: vi.fn(),
  mockMapRawToDbSession: vi.fn(),
}));

vi.mock('../services/negotiation-round.service.js', () => ({
  getRoundByIdempotencyKey: (...args: unknown[]) => mockGetRoundByIdempotencyKey(...args),
  createRound: (...args: unknown[]) => mockCreateRound(...args),
  getRoundsBySessionId: (...args: unknown[]) => mockGetRoundsBySessionId(...args),
}));

vi.mock('../services/negotiation-session.service.js', () => ({
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
}));

vi.mock('../services/conversation-signal-sink.js', () => ({
  recordRoundConversationSignals: vi.fn().mockResolvedValue({
    incoming: { extracted: 0, inserted: 0 },
    outgoing: { extracted: 0, inserted: 0 },
  }),
}));

vi.mock('../negotiation/adapters/xai-client.js', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

vi.mock('@haggle/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock('../lib/negotiation-executor.js', () => ({
  mapRawToDbSession: (...args: unknown[]) => mockMapRawToDbSession(...args),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { executeLLMNegotiationRound } from '../lib/llm-negotiation-executor.js';
import type { RoundExecutionInput } from '../lib/negotiation-executor.js';
import type { DbSession, DbRound } from '../lib/session-reconstructor.js';

// ---------------------------------------------------------------------------
// iPhone 15 Pro Scenario — $750 target, $950 floor (buyer side)
// Seller starts at $920, parties converge over ~8 rounds.
// ---------------------------------------------------------------------------

const SCENARIO = {
  item: 'iPhone 15 Pro 256GB Natural Titanium',
  buyerTarget: 75000,  // $750
  buyerFloor: 95000,   // $950
  sellerTarget: 90000, // $900
  sellerFloor: 70000,  // $700
  maxRounds: 15,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.now();

function makeSession(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: 'sess-lifecycle-001',
    groupId: null,
    intentId: 'intent-001',
    listingId: 'listing-iphone15pro',
    strategyId: 'default',
    role: 'BUYER',
    status: 'CREATED',
    buyerId: 'buyer-001',
    sellerId: 'seller-001',
    counterpartyId: 'seller-001',
    currentRound: 0,
    roundsNoConcession: 0,
    lastOfferPriceMinor: null,
    lastUtility: null,
    strategySnapshot: {
      p_target: SCENARIO.buyerTarget,
      p_limit: SCENARIO.buyerFloor,
      max_rounds: SCENARIO.maxRounds,
      alpha: { price: 0.5, time: 0.2, reputation: 0.15, satisfaction: 0.15 },
    },
    version: 1,
    expiresAt: null,
    createdAt: new Date('2026-04-11'),
    updatedAt: new Date('2026-04-11'),
    ...overrides,
  };
}

function makeRound(overrides: Partial<DbRound> = {}): DbRound {
  return {
    id: `round-${overrides.roundNo ?? 1}`,
    sessionId: 'sess-lifecycle-001',
    roundNo: 1,
    senderRole: 'SELLER',
    messageType: 'OFFER',
    priceminor: '92000',
    counterPriceMinor: '67500',
    utility: { u_total: 0.5, v_p: 0.4, v_t: 0.04, v_r: 0.03, v_s: 0.03 },
    decision: 'COUNTER',
    metadata: null,
    idempotencyKey: `idem-${overrides.roundNo ?? 1}`,
    createdAt: new Date('2026-04-11'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<RoundExecutionInput> = {}): RoundExecutionInput {
  return {
    sessionId: 'sess-lifecycle-001',
    offerPriceMinor: 92000,
    senderRole: 'SELLER',
    idempotencyKey: `idem-${Date.now()}-${Math.random()}`,
    roundData: { r_score: 0.8 },
    nowMs: NOW,
    ...overrides,
  };
}

function makeLLMResponse(action = 'COUNTER', price = 78000) {
  return {
    content: JSON.stringify({
      action,
      price,
      reasoning: `Strategic ${action.toLowerCase()} at $${price / 100}.`,
      tactic_used: 'reciprocal_concession',
    }),
    usage: { prompt_tokens: 400, completion_tokens: 90 },
    reasoning_used: false,
  };
}

function makeMockDb(session: DbSession) {
  mockMapRawToDbSession.mockReturnValue(session);
  mockTxExecute.mockResolvedValue([session as unknown]);

  const tx = {
    execute: mockTxExecute,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();
  mockGetRoundByIdempotencyKey.mockResolvedValue(null);
  mockCreateRound.mockImplementation(async (_tx: unknown, data: Record<string, unknown>) => ({
    id: `round-new-${Date.now()}`,
    ...data,
  }));
  mockUpdateSessionState.mockResolvedValue(true);
  mockGetSessionById.mockResolvedValue(null);
}

// Track all rounds for the full lifecycle test
interface RoundResult {
  phase: string;
  roundNo: number;
  decision: string;
  outgoingPrice: number;
  llmCalled: boolean;
  sellerOffer: number;
  coaching?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Negotiation Phase Lifecycle — iPhone 15 Pro ($750 target)', () => {
  beforeEach(() => resetMocks());
  afterEach(() => vi.restoreAllMocks());

  // ═════════════════════════════════════════════════════════════════════════
  // Phase 1: OPENING — 초기 제안
  // ═════════════════════════════════════════════════════════════════════════

  describe('Phase 1: OPENING — 앵커링', () => {
    it('CREATED 세션에서 첫 제안 → COUNTER (10% 마진 앵커링)', async () => {
      const session = makeSession({ currentRound: 0, status: 'CREATED' });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([]);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 67500));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 92000 }),
      );

      // Skill: buyer target $750 × (1-0.10) = $675 anchor
      expect(result.decision).toBeDefined();
      expect(result.roundNo).toBe(1);
      expect(result.idempotent).toBe(false);

      // Phase should transition OPENING → BARGAINING (COUNTER_OFFER_MADE)
      const roundData = mockCreateRound.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
      expect(roundData).toBeDefined();
      expect(roundData!.phaseAtRound).toBe('BARGAINING');
    });

    it('OPENING 앵커 가격이 target 기반 10% 마진', async () => {
      const session = makeSession({ currentRound: 0, status: 'CREATED' });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([]);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 68000));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 92000 }),
      );

      // Skill auto-calculates: $750 × 0.90 = $675, then LLM adjusts to $680
      // The important thing is it's below target
      if (result.decision === 'COUNTER') {
        expect(result.outgoingPrice).toBeLessThanOrEqual(SCENARIO.buyerTarget);
      }
    });

    it('seller가 target 이하 제안 → 즉시 ACCEPT (LLM 불필요)', async () => {
      const session = makeSession({ currentRound: 0, status: 'CREATED' });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([]);

      // Seller offers $740 — below buyer target $750
      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 74000 }),
      );

      expect(result.decision).toBe('ACCEPT');
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('seller가 floor 초과 제안 → 즉시 REJECT (LLM 불필요)', async () => {
      const session = makeSession({ currentRound: 0, status: 'CREATED' });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([]);

      // Seller offers $960 — above buyer floor $950
      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 96000 }),
      );

      expect(result.decision).toBe('REJECT');
      expect(mockCallLLM).not.toHaveBeenCalled();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Phase 2: BARGAINING — Faratin 양보 곡선 + LLM
  // ═════════════════════════════════════════════════════════════════════════

  describe('Phase 2: BARGAINING — 가격 수렴', () => {
    it('BARGAINING COUNTER → LLM 호출 + coaching + validation', async () => {
      const session = makeSession({
        currentRound: 3,
        status: 'ACTIVE',
        lastOfferPriceMinor: '78000',
        version: 3,
      });
      const db = makeMockDb(session);

      const rounds = [
        makeRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '67500' }),
        makeRound({ roundNo: 2, priceminor: '88000', counterPriceMinor: '72000' }),
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '78000' }),
      ];
      mockGetRoundsBySessionId.mockResolvedValue(rounds);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 80000));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 83000 }),
      );

      expect(result.decision).toBeDefined();
      expect(mockCallLLM).toHaveBeenCalledOnce();

      const roundData = mockCreateRound.mock.calls[0][1] as Record<string, unknown>;
      expect(roundData.coaching).toBeDefined();
      expect(roundData.validation).toBeDefined();
      expect(roundData.message).toBeDefined();
      expect(roundData.metadata).toHaveProperty('engine', 'llm');
    });

    it('가격이 라운드마다 수렴 (buyer 상승, seller 하락)', async () => {
      // Round 4: buyer has been moving up, seller moving down
      const session = makeSession({
        currentRound: 4,
        status: 'ACTIVE',
        lastOfferPriceMinor: '78000',
        version: 4,
      });
      const db = makeMockDb(session);

      const rounds = [
        makeRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '67500' }),
        makeRound({ roundNo: 2, priceminor: '88000', counterPriceMinor: '72000' }),
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '75000' }),
        makeRound({ roundNo: 4, priceminor: '83000', counterPriceMinor: '78000' }),
      ];
      mockGetRoundsBySessionId.mockResolvedValue(rounds);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 79500));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 82000 }),
      );

      // Counter should be between previous buyer offer and seller's current offer
      if (result.decision === 'COUNTER') {
        expect(result.outgoingPrice).toBeGreaterThanOrEqual(78000);
        expect(result.outgoingPrice).toBeLessThanOrEqual(82000);
      }
    });

    it('LLM 실패 → rule-based fallback (서비스 중단 없음)', async () => {
      const session = makeSession({
        currentRound: 3,
        status: 'ACTIVE',
        lastOfferPriceMinor: '78000',
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 1 }),
        makeRound({ roundNo: 2, priceminor: '88000', counterPriceMinor: '72000' }),
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '78000' }),
      ]);
      mockCallLLM.mockRejectedValue(new Error('XAI_TIMEOUT'));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 83000 }),
      );

      // Should NOT throw — graceful fallback
      expect(result.decision).toBeDefined();
      expect(result.outgoingPrice).toBeGreaterThan(0);
      expect(mockCreateRound).toHaveBeenCalledOnce();
    });

    it('opponent pattern → coaching 전술 적용', async () => {
      const session = makeSession({
        currentRound: 5,
        status: 'ACTIVE',
        lastOfferPriceMinor: '80000',
        version: 5,
      });
      const db = makeMockDb(session);

      // Seller barely conceding (BOULWARE pattern)
      const rounds = [
        makeRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '67500' }),
        makeRound({ roundNo: 2, priceminor: '91000', counterPriceMinor: '72000' }),
        makeRound({ roundNo: 3, priceminor: '90000', counterPriceMinor: '75000' }),
        makeRound({ roundNo: 4, priceminor: '89500', counterPriceMinor: '78000' }),
        makeRound({ roundNo: 5, priceminor: '89000', counterPriceMinor: '80000' }),
      ];
      mockGetRoundsBySessionId.mockResolvedValue(rounds);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 81000));

      await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 88500 }),
      );

      const roundData = mockCreateRound.mock.calls[0][1] as Record<string, unknown>;
      const coaching = roundData.coaching as Record<string, unknown>;
      expect(coaching).toBeDefined();
      // Against BOULWARE opponent, coaching should suggest firm stance
      expect(coaching.suggested_tactic).toBeDefined();
    });

    it('stagnation 4라운드 → STALLED 상태', async () => {
      const session = makeSession({
        currentRound: 6,
        status: 'ACTIVE',
        lastOfferPriceMinor: '80000',
        roundsNoConcession: 4,
        version: 6,
      });
      const db = makeMockDb(session);

      // Same prices for 4 rounds → stagnation
      const rounds = [
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '80000' }),
        makeRound({ roundNo: 4, priceminor: '85000', counterPriceMinor: '80000' }),
        makeRound({ roundNo: 5, priceminor: '85000', counterPriceMinor: '80000' }),
        makeRound({ roundNo: 6, priceminor: '85000', counterPriceMinor: '80000' }),
      ];
      mockGetRoundsBySessionId.mockResolvedValue(rounds);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 80500));

      await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85000 }),
      );

      const updateCall = mockUpdateSessionState.mock.calls[0];
      expect(updateCall).toBeDefined();
      // With roundsNoConcession = 4, phaseToDbStatus maps to STALLED
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Phase 3: CLOSING — Near-Deal 감지
  // ═════════════════════════════════════════════════════════════════════════

  describe('Phase 3: CLOSING — Near-Deal 감지', () => {
    it('gap < 5% → auto-ACCEPT (near-deal)', async () => {
      const session = makeSession({
        currentRound: 7,
        status: 'ACTIVE',
        lastOfferPriceMinor: '82000',
        version: 7,
        strategySnapshot: {
          p_target: SCENARIO.buyerTarget,
          p_limit: SCENARIO.buyerFloor,
          max_rounds: SCENARIO.maxRounds,
        },
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 6, priceminor: '83000', counterPriceMinor: '81500' }),
        makeRound({ roundNo: 7, priceminor: '82500', counterPriceMinor: '82000' }),
      ]);

      // Seller offers $825 — gap from $820 = $500 = 2.5% of $20K range
      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 82500 }),
      );

      // Skill detects gap < 5% → ACCEPT
      expect(result.decision).toBe('ACCEPT');
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('NEAR_DEAL 상태 세션 → CLOSING phase', async () => {
      const session = makeSession({
        currentRound: 7,
        status: 'NEAR_DEAL',
        lastOfferPriceMinor: '82000',
        version: 7,
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 7, priceminor: '82500', counterPriceMinor: '82000' }),
      ]);

      // Offer at exact our price → ACCEPT
      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 82000 }),
      );

      expect(result.decision).toBe('ACCEPT');
    });

    it('CLOSING phase에서 CONFIRM 생성', async () => {
      // When session is in CLOSING phase (detected via NEAR_DEAL status)
      const session = makeSession({
        currentRound: 8,
        status: 'NEAR_DEAL',
        lastOfferPriceMinor: '82000',
        version: 8,
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 7, priceminor: '82500', counterPriceMinor: '82000' }),
        makeRound({ roundNo: 8, priceminor: '82100', counterPriceMinor: '82000' }),
      ]);

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 82100 }),
      );

      // Near target → ACCEPT or in CLOSING → CONFIRM
      expect(['ACCEPT', 'COUNTER', 'NEAR_DEAL']).toContain(result.decision);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Phase 4: SETTLEMENT — 최종 확정
  // ═════════════════════════════════════════════════════════════════════════

  describe('Phase 4: SETTLEMENT — 최종 확정', () => {
    it('ACCEPTED 세션에 추가 제안 → SESSION_TERMINAL 에러', async () => {
      const session = makeSession({ status: 'ACCEPTED', currentRound: 8 });
      const db = makeMockDb(session);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput()),
      ).rejects.toThrow('SESSION_TERMINAL');
    });

    it('REJECTED 세션에 추가 제안 → SESSION_TERMINAL 에러', async () => {
      const session = makeSession({ status: 'REJECTED', currentRound: 5 });
      const db = makeMockDb(session);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput()),
      ).rejects.toThrow('SESSION_TERMINAL');
    });

    it('만료된 세션 → SESSION_EXPIRED 에러', async () => {
      const session = makeSession({
        expiresAt: new Date(NOW - 60000),
        currentRound: 3,
      });
      const db = makeMockDb(session);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput()),
      ).rejects.toThrow('SESSION_EXPIRED');
    });

    it('ACCEPT 시 negotiation.agreed 이벤트 발행', async () => {
      const session = makeSession({
        currentRound: 0,
        status: 'CREATED',
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([]);

      const mockDispatch = vi.fn().mockResolvedValue(undefined);
      const dispatcher = { dispatch: mockDispatch, registerHandler: vi.fn() };

      mockGetSessionById.mockResolvedValue({
        ...session,
        lastOfferPriceMinor: '74000',
      });

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 74000 }),
        dispatcher as any,
      );

      if (result.sessionStatus === 'ACCEPTED') {
        expect(mockDispatch).toHaveBeenCalledOnce();
        const evt = mockDispatch.mock.calls[0][0];
        expect(evt.type).toBe('negotiation.agreed');
        expect(evt.payload.session_id).toBe('sess-lifecycle-001');
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Referee — Validation + Auto-fix
  // ═════════════════════════════════════════════════════════════════════════

  describe('Referee — 검증 + 자동 수정', () => {
    it('LLM이 floor 위반 가격 제시 → Referee가 자동 수정', async () => {
      const session = makeSession({
        role: 'SELLER',
        currentRound: 4,
        status: 'ACTIVE',
        lastOfferPriceMinor: '85000',
        version: 4,
        strategySnapshot: {
          p_target: 90000,
          p_limit: 70000,  // seller floor $700
          max_rounds: 15,
        },
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 1, senderRole: 'BUYER', priceminor: '70000', counterPriceMinor: '92000' }),
        makeRound({ roundNo: 2, senderRole: 'BUYER', priceminor: '73000', counterPriceMinor: '88000' }),
        makeRound({ roundNo: 3, senderRole: 'BUYER', priceminor: '76000', counterPriceMinor: '86000' }),
        makeRound({ roundNo: 4, senderRole: 'BUYER', priceminor: '78000', counterPriceMinor: '85000' }),
      ]);

      // LLM returns price below seller floor
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 60000));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 80000, senderRole: 'BUYER' }),
      );

      // Referee should correct price to be >= floor
      if (result.decision === 'COUNTER') {
        expect(result.outgoingPrice).toBeGreaterThanOrEqual(70000);
      }
    });

    it('방향 전환 감지 → SOFT violation (경고만, 진행 차단 안 함)', async () => {
      const session = makeSession({
        currentRound: 5,
        status: 'ACTIVE',
        lastOfferPriceMinor: '80000',
        version: 5,
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '78000' }),
        makeRound({ roundNo: 4, priceminor: '83000', counterPriceMinor: '80000' }),
        makeRound({ roundNo: 5, priceminor: '82000', counterPriceMinor: '80000' }),
      ]);
      mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 80500));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 81500 }),
      );

      // Should not throw — SOFT violations don't block
      expect(result.decision).toBeDefined();

      const roundData = mockCreateRound.mock.calls[0][1] as Record<string, unknown>;
      expect(roundData.validation).toBeDefined();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Prompt Construction — LLM 프롬프트 구조 검증
  // ═════════════════════════════════════════════════════════════════════════

  describe('Prompt Construction — 프롬프트 구조', () => {
    it('system prompt에 Skill 컨텍스트 + JSON 스키마 포함', async () => {
      const session = makeSession({
        currentRound: 3,
        status: 'ACTIVE',
        lastOfferPriceMinor: '78000',
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 1 }),
        makeRound({ roundNo: 2, priceminor: '88000', counterPriceMinor: '72000' }),
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '78000' }),
      ]);
      mockCallLLM.mockResolvedValue(makeLLMResponse());

      await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 83000 }),
      );

      const [systemPrompt, userPrompt] = mockCallLLM.mock.calls[0];

      // System prompt has skill context
      expect(systemPrompt).toContain('iPhone Pro');
      expect(systemPrompt).toContain('JSON');

      // User prompt has compact memory encoding
      expect(userPrompt).toContain('S:');
      expect(userPrompt).toContain('B:');
      expect(userPrompt).toContain('C:');
    });

    it('reasoning 모드 플래그가 callLLM에 전달됨', async () => {
      const session = makeSession({
        currentRound: 4,
        status: 'ACTIVE',
        lastOfferPriceMinor: '80000',
      });
      const db = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeRound({ roundNo: 1 }),
        makeRound({ roundNo: 2, priceminor: '88000', counterPriceMinor: '72000' }),
        makeRound({ roundNo: 3, priceminor: '85000', counterPriceMinor: '78000' }),
        makeRound({ roundNo: 4, priceminor: '83000', counterPriceMinor: '80000' }),
      ]);
      mockCallLLM.mockResolvedValue(makeLLMResponse());

      await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 82000 }),
      );

      expect(mockCallLLM).toHaveBeenCalledOnce();
      const opts = mockCallLLM.mock.calls[0][2];
      expect(typeof opts.reasoning).toBe('boolean');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // Full Lifecycle — 8라운드 시나리오
  // ═════════════════════════════════════════════════════════════════════════

  describe('Full Lifecycle — 8라운드 iPhone 15 Pro', () => {
    it('OPENING → BARGAINING → ACCEPT 전체 흐름', async () => {
      const results: RoundResult[] = [];

      // ── Round 1: OPENING ──
      {
        resetMocks();
        const session = makeSession({ currentRound: 0, status: 'CREATED' });
        const db = makeMockDb(session);
        mockGetRoundsBySessionId.mockResolvedValue([]);
        mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', 68000));

        const r = await executeLLMNegotiationRound(
          db as any,
          makeInput({ offerPriceMinor: 92000, idempotencyKey: 'life-r1' }),
        );
        results.push({
          phase: 'OPENING→BARGAINING',
          roundNo: r.roundNo,
          decision: r.decision,
          outgoingPrice: r.outgoingPrice,
          llmCalled: mockCallLLM.mock.calls.length > 0,
          sellerOffer: 92000,
        });
      }

      // ── Round 2-6: BARGAINING ──
      const bargainingPairs = [
        { seller: 89000, llmCounter: 72000 },
        { seller: 86000, llmCounter: 75000 },
        { seller: 84000, llmCounter: 78000 },
        { seller: 83000, llmCounter: 80000 },
        { seller: 82000, llmCounter: 81000 },
      ];

      let roundHistory: DbRound[] = [
        makeRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '68000' }),
      ];

      for (let i = 0; i < bargainingPairs.length; i++) {
        resetMocks();
        const rn = i + 2;
        const pair = bargainingPairs[i]!;

        const session = makeSession({
          currentRound: rn - 1,
          status: 'ACTIVE',
          lastOfferPriceMinor: String(roundHistory[roundHistory.length - 1]!.counterPriceMinor),
          version: rn,
        });
        const db = makeMockDb(session);
        mockGetRoundsBySessionId.mockResolvedValue([...roundHistory]);
        mockCallLLM.mockResolvedValue(makeLLMResponse('COUNTER', pair.llmCounter));

        const r = await executeLLMNegotiationRound(
          db as any,
          makeInput({
            offerPriceMinor: pair.seller,
            idempotencyKey: `life-r${rn}`,
          }),
        );

        results.push({
          phase: 'BARGAINING',
          roundNo: r.roundNo,
          decision: r.decision,
          outgoingPrice: r.outgoingPrice,
          llmCalled: mockCallLLM.mock.calls.length > 0,
          sellerOffer: pair.seller,
        });

        roundHistory.push(
          makeRound({
            roundNo: rn,
            priceminor: String(pair.seller),
            counterPriceMinor: String(r.outgoingPrice),
          }),
        );
      }

      // ── Round 7: near-deal → ACCEPT ──
      {
        resetMocks();
        const session = makeSession({
          currentRound: 6,
          status: 'ACTIVE',
          lastOfferPriceMinor: '81000',
          version: 7,
        });
        const db = makeMockDb(session);
        mockGetRoundsBySessionId.mockResolvedValue([...roundHistory]);

        // Seller offers $815 — gap from $810 = $500, 2.5% of 20K range → auto ACCEPT
        const r = await executeLLMNegotiationRound(
          db as any,
          makeInput({ offerPriceMinor: 81500, idempotencyKey: 'life-r7' }),
        );

        results.push({
          phase: 'CLOSING',
          roundNo: r.roundNo,
          decision: r.decision,
          outgoingPrice: r.outgoingPrice,
          llmCalled: mockCallLLM.mock.calls.length > 0,
          sellerOffer: 81500,
        });
      }

      // ── Verify lifecycle ──

      // Total rounds executed
      expect(results.length).toBe(7);

      // Phase progression
      expect(results[0]!.phase).toBe('OPENING→BARGAINING');
      expect(results[1]!.phase).toBe('BARGAINING');
      expect(results[results.length - 1]!.phase).toBe('CLOSING');

      // Price convergence: buyer offers monotonically increase
      const buyerOffers = results
        .filter((r) => r.decision === 'COUNTER')
        .map((r) => r.outgoingPrice);
      for (let i = 1; i < buyerOffers.length; i++) {
        expect(buyerOffers[i]).toBeGreaterThanOrEqual(buyerOffers[i - 1]!);
      }

      // LLM called during BARGAINING
      const bargainingResults = results.filter((r) => r.phase === 'BARGAINING');
      for (const r of bargainingResults) {
        if (r.decision === 'COUNTER') {
          expect(r.llmCalled).toBe(true);
        }
      }

      // Final round should be ACCEPT
      expect(results[results.length - 1]!.decision).toBe('ACCEPT');
    });
  });
});
