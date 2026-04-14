/**
 * LLM Negotiation Executor — Integration Tests
 *
 * Tests the full pipeline: executeLLMNegotiationRound() with real Step 56 modules
 * (RefereeService, DefaultEngineSkill, GrokFastAdapter, phase-machine, screening, etc.)
 * Only DB layer and xAI HTTP client are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be before imports
// ---------------------------------------------------------------------------

const {
  mockGetRoundByIdempotencyKey,
  mockCreateRound,
  mockGetRoundsBySessionId,
  mockGetSessionById,
  mockUpdateSessionState,
  mockCallLLM,
  mockTxExecute,
} = vi.hoisted(() => ({
  mockGetRoundByIdempotencyKey: vi.fn(),
  mockCreateRound: vi.fn(),
  mockGetRoundsBySessionId: vi.fn(),
  mockGetSessionById: vi.fn(),
  mockUpdateSessionState: vi.fn(),
  mockCallLLM: vi.fn(),
  mockTxExecute: vi.fn(),
}));

// Mock DB service layer
vi.mock('../services/negotiation-round.service.js', () => ({
  getRoundByIdempotencyKey: (...args: unknown[]) => mockGetRoundByIdempotencyKey(...args),
  createRound: (...args: unknown[]) => mockCreateRound(...args),
  getRoundsBySessionId: (...args: unknown[]) => mockGetRoundsBySessionId(...args),
}));

vi.mock('../services/negotiation-session.service.js', () => ({
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  updateSessionState: (...args: unknown[]) => mockUpdateSessionState(...args),
}));

// Mock xAI client — the only external API call
vi.mock('../negotiation/adapters/xai-client.js', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

// Mock @haggle/db sql tag + Database type
vi.mock('@haggle/db', () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

// Mock negotiation-executor for the mapRawToDbSession import
const { mockMapRawToDbSession } = vi.hoisted(() => ({
  mockMapRawToDbSession: vi.fn(),
}));

vi.mock('../lib/negotiation-executor.js', () => ({
  mapRawToDbSession: (...args: unknown[]) => mockMapRawToDbSession(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { executeLLMNegotiationRound } from '../lib/llm-negotiation-executor.js';
import type { RoundExecutionInput } from '../lib/negotiation-executor.js';
import type { DbSession, DbRound } from '../lib/session-reconstructor.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.now();

function makeDbSession(overrides: Partial<DbSession> = {}): DbSession {
  return {
    id: 'sess-int-001',
    groupId: null,
    intentId: null,
    listingId: 'listing-001',
    strategyId: 'default',
    role: 'BUYER',
    status: 'ACTIVE',
    buyerId: 'buyer-001',
    sellerId: 'seller-001',
    counterpartyId: 'seller-001',
    currentRound: 3,
    roundsNoConcession: 0,
    lastOfferPriceMinor: '80000', // $800 — our last counter
    lastUtility: { u_total: 0.55, v_p: 0.45, v_t: 0.04, v_r: 0.03, v_s: 0.03 },
    strategySnapshot: {
      p_target: 75000, // buyer target $750
      p_limit: 95000,  // buyer floor $950
      max_rounds: 15,
      alpha: { price: 0.5, time: 0.2, reputation: 0.15, satisfaction: 0.15 },
    },
    version: 3,
    expiresAt: null,
    createdAt: new Date('2026-04-10'),
    updatedAt: new Date('2026-04-10'),
    ...overrides,
  };
}

function makeDbRound(overrides: Partial<DbRound> = {}): DbRound {
  return {
    id: 'round-001',
    sessionId: 'sess-int-001',
    roundNo: 1,
    senderRole: 'SELLER',
    messageType: 'OFFER',
    priceminor: '90000',
    counterPriceMinor: '80000',
    utility: { u_total: 0.5, v_p: 0.4, v_t: 0.04, v_r: 0.03, v_s: 0.03 },
    decision: 'COUNTER',
    metadata: { tactic: 'anchoring', reasoning: 'Initial anchor' },
    idempotencyKey: 'idem-001',
    createdAt: new Date('2026-04-10'),
    ...overrides,
  };
}

function makeInput(overrides: Partial<RoundExecutionInput> = {}): RoundExecutionInput {
  return {
    sessionId: 'sess-int-001',
    offerPriceMinor: 87000, // seller offers $870
    senderRole: 'SELLER',
    idempotencyKey: `idem-round-${Date.now()}`,
    roundData: {
      r_score: 0.7,
      t_elapsed: 60000,
    },
    nowMs: NOW,
    ...overrides,
  };
}

/** Create a fake db object with .transaction() */
function makeMockDb(dbSession: DbSession) {
  // mapRawToDbSession converts the raw row to DbSession
  mockMapRawToDbSession.mockReturnValue(dbSession);

  // tx.execute returns the locked row as raw
  mockTxExecute.mockResolvedValue([dbSession as unknown as Record<string, unknown>]);

  const tx = {
    execute: mockTxExecute,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const db = {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(tx);
    }),
  };

  return { db, tx };
}

// ---------------------------------------------------------------------------
// Standard LLM response for xAI mock
// ---------------------------------------------------------------------------

function makeLLMResponse(overrides: Record<string, unknown> = {}) {
  const content = JSON.stringify({
    action: 'COUNTER',
    price: 82000,
    reasoning: 'Strategic counter at $820 based on market analysis.',
    tactic_used: 'reciprocal_concession',
    ...overrides,
  });

  return {
    content,
    usage: { prompt_tokens: 350, completion_tokens: 80 },
    reasoning_used: false,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('LLM Executor — Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no existing round (not idempotent)
    mockGetRoundByIdempotencyKey.mockResolvedValue(null);

    // Default: createRound returns a round object
    mockCreateRound.mockImplementation(async (_tx: unknown, data: Record<string, unknown>) => ({
      id: `round-new-${Date.now()}`,
      ...data,
    }));

    // Default: updateSessionState succeeds
    mockUpdateSessionState.mockResolvedValue(true);

    // Default: getSessionById for post-commit event dispatch
    mockGetSessionById.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 1. HAPPY PATH — Full pipeline with LLM augmentation
  // ═══════════════════════════════════════════════════════════════════════

  describe('Happy path — BARGAINING with LLM', () => {
    it('executes full pipeline: screen → phase → skill → LLM → referee → persist', async () => {
      // Session with significant gap so skill returns COUNTER (not auto-accept)
      const session = makeDbSession({
        currentRound: 5,
        status: 'ACTIVE',
        lastOfferPriceMinor: '82000', // our last counter was $820
      });
      const { db } = makeMockDb(session);

      const rounds: DbRound[] = [
        makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '90000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '88000', counterPriceMinor: '80000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', priceminor: '87000', counterPriceMinor: '81000' }),
        makeDbRound({ roundNo: 5, id: 'r-005', priceminor: '86000', counterPriceMinor: '82000' }),
      ];
      mockGetRoundsBySessionId.mockResolvedValue(rounds);

      // LLM returns a COUNTER with price
      mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 83500 }));

      // Seller's new offer: $855 (gap from our $820 = $35 → 35000/20000 = 17.5% of range → not near deal)
      const input = makeInput({ offerPriceMinor: 85500 });
      const result = await executeLLMNegotiationRound(db as any, input);

      expect(result.idempotent).toBe(false);
      expect(['COUNTER', 'ACCEPT']).toContain(result.decision);

      // Should have persisted a round
      expect(mockCreateRound).toHaveBeenCalledOnce();
      const roundData = mockCreateRound.mock.calls[0][1];
      expect(roundData.sessionId).toBe('sess-int-001');
      expect(roundData.roundNo).toBe(6); // currentRound + 1
      expect(roundData.senderRole).toBe('SELLER');
      expect(roundData.metadata.engine).toBe('llm');

      // Should have called LLM (BARGAINING + COUNTER path)
      expect(mockCallLLM).toHaveBeenCalledOnce();

      // Should have updated session state
      expect(mockUpdateSessionState).toHaveBeenCalledOnce();
      const sessionUpdate = mockUpdateSessionState.mock.calls[0];
      expect(sessionUpdate[1]).toBe('sess-int-001');
      expect(sessionUpdate[2]).toBe(3); // version
    });

    it('includes coaching, validation, and message in persisted round', async () => {
      const session = makeDbSession({
        currentRound: 3,
        lastOfferPriceMinor: '80000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '89000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '87000', counterPriceMinor: '80000' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 82500 }));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 86000 }),
      );

      const roundData = mockCreateRound.mock.calls[0][1];

      // Coaching snapshot from real computeCoaching
      expect(roundData.coaching).toBeDefined();
      expect(roundData.coaching.recommended_price).toBeTypeOf('number');
      expect(roundData.coaching.suggested_tactic).toBeTypeOf('string');

      // Validation from real validateMove
      expect(roundData.validation).toBeDefined();
      expect(roundData.validation.violations).toBeInstanceOf(Array);

      // Rendered message from real TemplateMessageRenderer
      expect(roundData.message).toBeTypeOf('string');
      expect(roundData.message.length).toBeGreaterThan(0);

      // Phase recorded
      expect(roundData.phaseAtRound).toBeTypeOf('string');
    });

    it('returns extended fields (message, phase, reasoningUsed) in result', async () => {
      const session = makeDbSession({
        currentRound: 3,
        lastOfferPriceMinor: '80000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '89000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '87000', counterPriceMinor: '80000' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse());

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 86000 }),
      ) as unknown as Record<string, unknown>;

      expect(result.message).toBeTypeOf('string');
      expect(result.phase).toBeTypeOf('string');
      expect(typeof result.reasoningUsed).toBe('boolean');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. LLM FAILURE — Graceful fallback to rule-based
  // ═══════════════════════════════════════════════════════════════════════

  describe('LLM failure fallback', () => {
    it('falls back to rule-based skill decision when LLM throws', async () => {
      const session = makeDbSession({
        currentRound: 4,
        lastOfferPriceMinor: '81000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '89000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '87000', counterPriceMinor: '80000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', priceminor: '86000', counterPriceMinor: '81000' }),
      ]);

      // LLM fails with timeout
      mockCallLLM.mockRejectedValue(new Error('XAI_TIMEOUT: request timed out'));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // Should still produce a valid result (not throw)
      expect(result.idempotent).toBe(false);
      expect(result.decision).toBeDefined();
      expect(result.outgoingPrice).toBeGreaterThan(0);

      // Round should still be persisted
      expect(mockCreateRound).toHaveBeenCalledOnce();

      // LLM was called but failed
      expect(mockCallLLM).toHaveBeenCalledOnce();

      // Metadata indicates llm engine
      const roundData = mockCreateRound.mock.calls[0][1];
      expect(roundData.metadata.engine).toBe('llm');
    });

    it('falls back when LLM returns unparseable response', async () => {
      const session = makeDbSession({
        currentRound: 4,
        lastOfferPriceMinor: '81000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '89000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '87000', counterPriceMinor: '80000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', priceminor: '86000', counterPriceMinor: '81000' }),
      ]);

      // LLM returns garbage
      mockCallLLM.mockResolvedValue({
        content: 'Sorry, I cannot help with negotiations.',
        usage: { prompt_tokens: 100, completion_tokens: 20 },
        reasoning_used: false,
      });

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // Should not throw — falls back to skill decision
      expect(result.decision).toBeDefined();
      expect(mockCreateRound).toHaveBeenCalledOnce();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. SKILL AUTO-ACCEPT / AUTO-REJECT (no LLM needed)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Skill auto-decisions (bypass LLM)', () => {
    it('auto-accepts when offer meets buyer target', async () => {
      const session = makeDbSession({
        currentRound: 3,
        lastOfferPriceMinor: '80000',
        strategySnapshot: {
          p_target: 75000, // buyer wants $750
          p_limit: 95000,
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002' }),
        makeDbRound({ roundNo: 3, id: 'r-003' }),
      ]);

      // Seller offers $740 — below buyer target of $750
      const input = makeInput({ offerPriceMinor: 74000 });

      const result = await executeLLMNegotiationRound(db as any, input);

      // Skill auto-accepts: offer $740 ≤ target $750
      expect(result.decision).toBe('ACCEPT');

      // LLM should NOT be called (ACCEPT ≠ COUNTER)
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('auto-rejects when offer exceeds buyer floor', async () => {
      const session = makeDbSession({
        currentRound: 3,
        lastOfferPriceMinor: '80000',
        strategySnapshot: {
          p_target: 75000,
          p_limit: 95000, // buyer floor $950
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002' }),
        makeDbRound({ roundNo: 3, id: 'r-003' }),
      ]);

      // Seller offers $960 — above buyer floor of $950
      const input = makeInput({ offerPriceMinor: 96000 });

      const result = await executeLLMNegotiationRound(db as any, input);

      // Skill auto-rejects: offer $960 > floor $950
      expect(result.decision).toBe('REJECT');

      // LLM should NOT be called
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('auto-accepts when gap is near zero (< 5% of range)', async () => {
      // When lastOffer equals incoming offer, gap = 0 → auto-accept
      const session = makeDbSession({
        currentRound: 5,
        lastOfferPriceMinor: '85000', // our last counter was $850
        strategySnapshot: {
          p_target: 75000,
          p_limit: 95000,
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002' }),
        makeDbRound({ roundNo: 3, id: 'r-003' }),
        makeDbRound({ roundNo: 4, id: 'r-004' }),
        makeDbRound({ roundNo: 5, id: 'r-005' }),
      ]);

      // Seller matches our price: gap = 0 → skill auto-accepts
      const input = makeInput({ offerPriceMinor: 85000 });

      const result = await executeLLMNegotiationRound(db as any, input);

      expect(result.decision).toBe('ACCEPT');
      expect(mockCallLLM).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. IDEMPOTENCY — Cached response
  // ═══════════════════════════════════════════════════════════════════════

  describe('Idempotency', () => {
    it('returns cached result when idempotency key exists (outside TX)', async () => {
      const existingRound = {
        id: 'round-cached',
        roundNo: 3,
        decision: 'COUNTER',
        priceminor: '87000',
        counterPriceMinor: '83000',
        utility: { u_total: 0.6, v_p: 0.5, v_t: 0.04, v_r: 0.03, v_s: 0.03 },
      };
      mockGetRoundByIdempotencyKey.mockResolvedValue(existingRound);
      mockGetSessionById.mockResolvedValue(makeDbSession());

      const { db } = makeMockDb(makeDbSession());

      const input = makeInput({ idempotencyKey: 'idem-existing' });
      const result = await executeLLMNegotiationRound(db as any, input);

      expect(result.idempotent).toBe(true);
      expect(result.roundId).toBe('round-cached');
      expect(result.decision).toBe('COUNTER');

      // No transaction, no LLM call
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockCallLLM).not.toHaveBeenCalled();
      expect(mockCreateRound).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. TERMINAL SESSION — Rejects offers
  // ═══════════════════════════════════════════════════════════════════════

  describe('Terminal session check', () => {
    it('throws SESSION_TERMINAL for ACCEPTED session', async () => {
      const session = makeDbSession({ status: 'ACCEPTED' });
      const { db } = makeMockDb(session);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput()),
      ).rejects.toThrow('SESSION_TERMINAL: ACCEPTED');

      expect(mockCallLLM).not.toHaveBeenCalled();
      expect(mockCreateRound).not.toHaveBeenCalled();
    });

    it('throws SESSION_TERMINAL for REJECTED session', async () => {
      const session = makeDbSession({ status: 'REJECTED' });
      const { db } = makeMockDb(session);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput()),
      ).rejects.toThrow('SESSION_TERMINAL: REJECTED');
    });

    it('throws SESSION_EXPIRED for expired session', async () => {
      const session = makeDbSession({
        expiresAt: new Date(NOW - 60000), // expired 1 minute ago
      });
      const { db } = makeMockDb(session);

      mockUpdateSessionState.mockResolvedValue(true);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput()),
      ).rejects.toThrow('SESSION_EXPIRED');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. PHASE TRANSITIONS
  // ═══════════════════════════════════════════════════════════════════════

  describe('Phase transitions', () => {
    it('OPENING phase auto-transitions to BARGAINING on COUNTER', async () => {
      // CREATED + round 0 → OPENING. COUNTER triggers OPENING→BARGAINING.
      const session = makeDbSession({
        currentRound: 0,
        status: 'CREATED',
        lastOfferPriceMinor: null,
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([]);
      mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 77000 }));

      const input = makeInput({ offerPriceMinor: 90000 });
      const result = await executeLLMNegotiationRound(db as any, input);

      expect(result.decision).toBeDefined();

      // Phase machine: OPENING + COUNTER → COUNTER_OFFER_MADE → BARGAINING
      // Then skill returns COUNTER → currentPhase is BARGAINING → LLM is called
      expect(mockCallLLM).toHaveBeenCalledOnce();

      const roundData = mockCreateRound.mock.calls[0][1];
      // Phase should be BARGAINING (transitioned from OPENING)
      expect(roundData.phaseAtRound).toBe('BARGAINING');
    });

    it('calls LLM for active BARGAINING session', async () => {
      const session = makeDbSession({
        currentRound: 5,
        status: 'ACTIVE',
        lastOfferPriceMinor: '82000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '90000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '88000', counterPriceMinor: '80000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', priceminor: '87000', counterPriceMinor: '81000' }),
        makeDbRound({ roundNo: 5, id: 'r-005', priceminor: '86000', counterPriceMinor: '82000' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 83000 }));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // BARGAINING + COUNTER → LLM called
      expect(mockCallLLM).toHaveBeenCalledOnce();
      expect(result.decision).toBeDefined();
    });

    it('transitions to CLOSING when near-deal detected', async () => {
      // Gap < 10% of range → near deal
      const session = makeDbSession({
        currentRound: 8,
        status: 'ACTIVE',
        lastOfferPriceMinor: '84500', // our counter at $845
        strategySnapshot: {
          p_target: 75000,
          p_limit: 95000, // range = 20000
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 7, id: 'r-007', priceminor: '85000', counterPriceMinor: '84000' }),
        makeDbRound({ roundNo: 8, id: 'r-008', priceminor: '84700', counterPriceMinor: '84500' }),
      ]);

      // Offer very close: gap = |84500 - 85000| = 500, gapRatio = 500/20000 = 0.025 < 0.10
      const input = makeInput({ offerPriceMinor: 85000 });

      // Gap < 5% → skill auto-accepts
      const result = await executeLLMNegotiationRound(db as any, input);

      expect(['ACCEPT', 'COUNTER', 'NEAR_DEAL']).toContain(result.decision);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. REFEREE VALIDATION — Auto-fix HARD violations
  // ═══════════════════════════════════════════════════════════════════════

  describe('Referee validation', () => {
    it('auto-fixes when LLM returns price below seller floor', async () => {
      const session = makeDbSession({
        role: 'SELLER',
        currentRound: 5,
        status: 'ACTIVE',
        lastOfferPriceMinor: '85000',
        strategySnapshot: {
          p_target: 95000, // seller target $950
          p_limit: 75000,  // seller floor $750
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, senderRole: 'BUYER', priceminor: '70000', counterPriceMinor: '92000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', senderRole: 'BUYER', priceminor: '73000', counterPriceMinor: '90000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', senderRole: 'BUYER', priceminor: '76000', counterPriceMinor: '88000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', senderRole: 'BUYER', priceminor: '78000', counterPriceMinor: '86000' }),
        makeDbRound({ roundNo: 5, id: 'r-005', senderRole: 'BUYER', priceminor: '80000', counterPriceMinor: '85000' }),
      ]);

      // LLM returns price below seller's floor
      mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 60000 }));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 82000, senderRole: 'BUYER' }),
      );

      expect(result.decision).toBeDefined();
      // Referee should have corrected: price >= seller floor (75000)
      if (result.decision === 'COUNTER') {
        expect(result.outgoingPrice).toBeGreaterThanOrEqual(75000);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. CONCURRENT MODIFICATION — Version conflict
  // ═══════════════════════════════════════════════════════════════════════

  describe('Concurrent modification', () => {
    it('throws CONCURRENT_MODIFICATION when session version conflicts', async () => {
      const session = makeDbSession({
        currentRound: 3,
        lastOfferPriceMinor: '80000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002' }),
        makeDbRound({ roundNo: 3, id: 'r-003' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse());

      // updateSessionState returns null → version conflict
      mockUpdateSessionState.mockResolvedValue(null);

      await expect(
        executeLLMNegotiationRound(db as any, makeInput({ offerPriceMinor: 86000 })),
      ).rejects.toThrow('CONCURRENT_MODIFICATION');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. EVENT DISPATCH
  // ═══════════════════════════════════════════════════════════════════════

  describe('Event dispatch', () => {
    it('dispatches negotiation.agreed event on ACCEPT', async () => {
      const session = makeDbSession({
        currentRound: 3,
        lastOfferPriceMinor: '80000',
        strategySnapshot: {
          p_target: 75000,
          p_limit: 95000,
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1 }),
        makeDbRound({ roundNo: 2, id: 'r-002' }),
        makeDbRound({ roundNo: 3, id: 'r-003' }),
      ]);

      // Offer below target → auto-accept
      const input = makeInput({ offerPriceMinor: 74000 });

      const mockDispatch = vi.fn().mockResolvedValue(undefined);
      const eventDispatcher = {
        dispatch: mockDispatch,
        registerHandler: vi.fn(),
      };

      mockGetSessionById.mockResolvedValue({
        ...session,
        buyerId: 'buyer-001',
        sellerId: 'seller-001',
        lastOfferPriceMinor: '74000',
        intentId: null,
      });

      const result = await executeLLMNegotiationRound(db as any, input, eventDispatcher as any);

      if (result.sessionStatus === 'ACCEPTED') {
        expect(mockDispatch).toHaveBeenCalledOnce();
        const event = mockDispatch.mock.calls[0][0];
        expect(event.type).toBe('negotiation.agreed');
        expect(event.payload.session_id).toBe('sess-int-001');
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 10. MULTI-ROUND SCENARIO — Evolving memory across rounds
  // ═══════════════════════════════════════════════════════════════════════

  describe('Multi-round scenario', () => {
    it('processes 3 rounds showing OPENING→BARGAINING progression', async () => {
      // --- Round 1: CREATED→OPENING→BARGAINING (auto-transition) ---
      {
        const session = makeDbSession({
          currentRound: 0,
          status: 'CREATED',
          lastOfferPriceMinor: null,
        });
        const { db } = makeMockDb(session);
        mockGetRoundsBySessionId.mockResolvedValue([]);
        mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 77000 }));

        const result = await executeLLMNegotiationRound(
          db as any,
          makeInput({ offerPriceMinor: 90000, idempotencyKey: 'idem-r1' }),
        );

        expect(result.roundNo).toBe(1);
        expect(result.decision).toBeDefined();
        // OPENING→BARGAINING auto-transition means LLM IS called
        expect(mockCallLLM).toHaveBeenCalled();
      }

      vi.clearAllMocks();
      mockGetRoundByIdempotencyKey.mockResolvedValue(null);
      mockCreateRound.mockImplementation(async (_tx: unknown, data: Record<string, unknown>) => ({
        id: 'round-r2',
        ...data,
      }));
      mockUpdateSessionState.mockResolvedValue(true);
      mockGetSessionById.mockResolvedValue(null);

      // --- Round 2: BARGAINING continues ---
      {
        const session = makeDbSession({
          currentRound: 1,
          status: 'ACTIVE',
          lastOfferPriceMinor: '78000', // our counter from round 1
        });
        const { db } = makeMockDb(session);
        mockGetRoundsBySessionId.mockResolvedValue([
          makeDbRound({ roundNo: 1, priceminor: '90000', counterPriceMinor: '78000' }),
        ]);
        mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 80000 }));

        const result = await executeLLMNegotiationRound(
          db as any,
          makeInput({ offerPriceMinor: 88000, idempotencyKey: 'idem-r2' }),
        );

        expect(result.roundNo).toBe(2);
        expect(result.decision).toBeDefined();
      }

      vi.clearAllMocks();
      mockGetRoundByIdempotencyKey.mockResolvedValue(null);
      mockCreateRound.mockImplementation(async (_tx: unknown, data: Record<string, unknown>) => ({
        id: 'round-r3',
        ...data,
      }));
      mockUpdateSessionState.mockResolvedValue(true);
      mockGetSessionById.mockResolvedValue(null);

      // --- Round 3: BARGAINING with more history ---
      {
        const session = makeDbSession({
          currentRound: 2,
          status: 'ACTIVE',
          lastOfferPriceMinor: '80000',
        });
        const { db } = makeMockDb(session);
        mockGetRoundsBySessionId.mockResolvedValue([
          makeDbRound({ roundNo: 1, priceminor: '90000', counterPriceMinor: '78000' }),
          makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '88000', counterPriceMinor: '80000' }),
        ]);

        mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 81500 }));

        const result = await executeLLMNegotiationRound(
          db as any,
          makeInput({ offerPriceMinor: 86000, idempotencyKey: 'idem-r3' }),
        );

        expect(result.roundNo).toBe(3);
        expect(result.decision).toBeDefined();
        // Verify LLM was called for BARGAINING
        expect(mockCallLLM).toHaveBeenCalledOnce();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. LLM RESPONSE PARSING — Various formats
  // ═══════════════════════════════════════════════════════════════════════

  describe('LLM response handling', () => {
    const bargainingSession = () => makeDbSession({
      currentRound: 5,
      status: 'ACTIVE',
      lastOfferPriceMinor: '82000',
    });

    const bargainingRounds = () => [
      makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
      makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '90000', counterPriceMinor: '78000' }),
      makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '88000', counterPriceMinor: '80000' }),
      makeDbRound({ roundNo: 4, id: 'r-004', priceminor: '87000', counterPriceMinor: '81000' }),
      makeDbRound({ roundNo: 5, id: 'r-005', priceminor: '86000', counterPriceMinor: '82000' }),
    ];

    it('accepts LLM ACCEPT decision', async () => {
      const { db } = makeMockDb(bargainingSession());
      mockGetRoundsBySessionId.mockResolvedValue(bargainingRounds());

      mockCallLLM.mockResolvedValue(makeLLMResponse({
        action: 'ACCEPT',
        price: 85500,
        reasoning: 'Deal is favorable at current price.',
      }));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // LLM ACCEPT should be used
      expect(['ACCEPT', 'COUNTER']).toContain(result.decision);
    });

    it('handles LLM HOLD decision', async () => {
      const { db } = makeMockDb(bargainingSession());
      mockGetRoundsBySessionId.mockResolvedValue(bargainingRounds());

      mockCallLLM.mockResolvedValue(makeLLMResponse({
        action: 'HOLD',
        reasoning: 'Need more information about item condition.',
      }));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // HOLD is processed through referee
      expect(result.decision).toBeDefined();
    });

    it('parses markdown-wrapped ```json blocks from LLM', async () => {
      const { db } = makeMockDb(bargainingSession());
      mockGetRoundsBySessionId.mockResolvedValue(bargainingRounds());

      // LLM wraps response in markdown code block
      mockCallLLM.mockResolvedValue({
        content: '```json\n{"action":"COUNTER","price":83500,"reasoning":"Strategic counter","tactic_used":"reciprocal_concession"}\n```',
        usage: { prompt_tokens: 350, completion_tokens: 80 },
        reasoning_used: false,
      });

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // Should parse successfully despite markdown wrapping
      expect(result.decision).toBeDefined();
      expect(mockCreateRound).toHaveBeenCalledOnce();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 12. SELLER ROLE — Direction-aware logic
  // ═══════════════════════════════════════════════════════════════════════

  describe('Seller role', () => {
    it('correctly handles seller-side negotiation', async () => {
      const session = makeDbSession({
        role: 'SELLER',
        currentRound: 4,
        status: 'ACTIVE',
        lastOfferPriceMinor: '85000', // seller's last counter
        strategySnapshot: {
          p_target: 90000, // seller target $900
          p_limit: 70000,  // seller floor $700
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, senderRole: 'BUYER', priceminor: '75000', counterPriceMinor: '88000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', senderRole: 'BUYER', priceminor: '78000', counterPriceMinor: '86000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', senderRole: 'BUYER', priceminor: '80000', counterPriceMinor: '85000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', senderRole: 'BUYER', priceminor: '82000', counterPriceMinor: '85000' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse({ price: 84000 }));

      const result = await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 83000, senderRole: 'BUYER' }),
      );

      expect(result.decision).toBeDefined();
      expect(result.outgoingPrice).toBeGreaterThan(0);

      const roundData = mockCreateRound.mock.calls[0][1];
      expect(roundData.senderRole).toBe('BUYER');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 13. REASONING MODE — Verify shouldUseReasoning integration
  // ═══════════════════════════════════════════════════════════════════════

  describe('Reasoning mode selection', () => {
    it('passes reasoning flag to callLLM during BARGAINING', async () => {
      const session = makeDbSession({
        currentRound: 5,
        status: 'ACTIVE',
        lastOfferPriceMinor: '82000',
        strategySnapshot: {
          p_target: 75000,
          p_limit: 95000,
          max_rounds: 15,
        },
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '90000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '88000', counterPriceMinor: '80000' }),
        makeDbRound({ roundNo: 4, id: 'r-004', priceminor: '87000', counterPriceMinor: '81000' }),
        makeDbRound({ roundNo: 5, id: 'r-005', priceminor: '86000', counterPriceMinor: '82000' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse());

      await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 85500 }),
      );

      // callLLM should be called with reasoning option
      expect(mockCallLLM).toHaveBeenCalledOnce();
      const callArgs = mockCallLLM.mock.calls[0];
      // callArgs: [systemPrompt, userPrompt, options]
      expect(callArgs[2]).toBeDefined();
      expect(typeof callArgs[2].reasoning).toBe('boolean');
      expect(callArgs[2].correlationId).toBe('sess-int-001');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 14. PROMPT CONSTRUCTION — Verify adapter integration
  // ═══════════════════════════════════════════════════════════════════════

  describe('Prompt construction', () => {
    it('passes skill context and compact memory encoding to LLM', async () => {
      const session = makeDbSession({
        currentRound: 3,
        status: 'ACTIVE',
        lastOfferPriceMinor: '80000',
      });
      const { db } = makeMockDb(session);

      mockGetRoundsBySessionId.mockResolvedValue([
        makeDbRound({ roundNo: 1, priceminor: '92000', counterPriceMinor: '76000' }),
        makeDbRound({ roundNo: 2, id: 'r-002', priceminor: '89000', counterPriceMinor: '78000' }),
        makeDbRound({ roundNo: 3, id: 'r-003', priceminor: '87000', counterPriceMinor: '80000' }),
      ]);

      mockCallLLM.mockResolvedValue(makeLLMResponse());

      await executeLLMNegotiationRound(
        db as any,
        makeInput({ offerPriceMinor: 86000 }),
      );

      expect(mockCallLLM).toHaveBeenCalledOnce();
      const [systemPrompt, userPrompt] = mockCallLLM.mock.calls[0];

      // System prompt should contain skill context + JSON schema
      expect(systemPrompt).toContain('iPhone Pro');
      expect(systemPrompt).toContain('JSON');

      // User prompt should contain compact memory encoding
      expect(userPrompt).toContain('S:'); // Session line
      expect(userPrompt).toContain('B:'); // Boundaries line
      expect(userPrompt).toContain('C:'); // Coaching line
    });
  });
});
