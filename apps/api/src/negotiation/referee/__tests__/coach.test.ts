import { describe, it, expect, vi } from 'vitest';
import { computeCoaching, computeCoachingAsync } from '../coach.js';
import type { CoreMemory, RoundFact, BuddyDNA } from '../../types.js';

const BUDDY: BuddyDNA = {
  style: 'balanced',
  preferred_tactic: 'reciprocal_concession',
  category_experience: 'electronics',
  condition_trade_success_rate: 0.7,
  best_timing: 'mid-bargaining',
  tone: { style: 'professional', formality: 'neutral', emoji_use: false },
};

function makeMemory(overrides: Partial<CoreMemory['session']> = {}, bOverrides: Partial<CoreMemory['boundaries']> = {}): CoreMemory {
  return {
    session: {
      session_id: 'test', phase: 'BARGAINING', round: 5, rounds_remaining: 10,
      role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO', ...overrides,
    },
    boundaries: {
      my_target: 500, my_floor: 650, current_offer: 520, opponent_offer: 620, gap: 100, ...bOverrides,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 530, acceptable_range: { min: 480, max: 650 },
      suggested_tactic: 'anchoring', hint: '', opponent_pattern: 'UNKNOWN',
      convergence_rate: 0, time_pressure: 0,
      utility_snapshot: { u_price: 0, u_time: 0, u_risk: 0, u_quality: 0, u_total: 0 },
      strategic_hints: [], warnings: [],
    },
    buddy_dna: BUDDY,
    skill_summary: 'test',
  };
}

function makeFact(round: number, buyer: number, seller: number): RoundFact {
  return {
    round, phase: 'BARGAINING', buyer_offer: buyer, seller_offer: seller,
    gap: seller - buyer, conditions_changed: {},
    coaching_given: { recommended: 550, tactic: 'anchoring' },
    coaching_followed: true, human_intervened: false, timestamp: Date.now(),
  };
}

describe('computeCoaching', () => {
  it('should return valid coaching structure', () => {
    const coaching = computeCoaching(makeMemory(), [], null, BUDDY);
    expect(coaching.recommended_price).toBeGreaterThan(0);
    expect(coaching.acceptable_range.min).toBeLessThanOrEqual(coaching.acceptable_range.max);
    expect(coaching.time_pressure).toBeGreaterThanOrEqual(0);
    expect(coaching.time_pressure).toBeLessThanOrEqual(1);
  });

  it('should return 0 recommended_price in DISCOVERY', () => {
    const coaching = computeCoaching(makeMemory({ phase: 'DISCOVERY' }), [], null, BUDDY);
    expect(coaching.recommended_price).toBe(0);
  });

  it('should compute higher opening for seller', () => {
    const buyerCoaching = computeCoaching(
      makeMemory({ phase: 'OPENING', role: 'buyer' }), [], null, BUDDY,
    );
    const sellerCoaching = computeCoaching(
      makeMemory({ phase: 'OPENING', role: 'seller' }), [], null, BUDDY,
    );
    expect(buyerCoaching.recommended_price).toBeLessThan(500); // below target
    expect(sellerCoaching.recommended_price).toBeGreaterThan(500); // above target
  });

  it('should increase time_pressure with rounds', () => {
    const early = computeCoaching(makeMemory({ round: 2, rounds_remaining: 13 }), [], null, BUDDY);
    const late = computeCoaching(makeMemory({ round: 12, rounds_remaining: 3 }), [], null, BUDDY);
    expect(late.time_pressure).toBeGreaterThan(early.time_pressure);
  });

  it('should classify opponent from facts', () => {
    // Conceding opponent (seller dropping rapidly)
    const facts = [
      makeFact(1, 500, 700),
      makeFact(2, 510, 660),
      makeFact(3, 520, 620),
    ];
    const coaching = computeCoaching(makeMemory(), facts, null, BUDDY);
    expect(['CONCEDER', 'LINEAR']).toContain(coaching.opponent_pattern);
  });

  it('should warn on high time pressure', () => {
    const coaching = computeCoaching(
      makeMemory({ round: 13, rounds_remaining: 2 }), [], null, BUDDY,
    );
    expect(coaching.warnings.some((w) => w.includes('low on rounds'))).toBe(true);
  });

  it('should add competition hints when present', () => {
    const memory = makeMemory();
    memory.competition = {
      batna_price: 480, n_active_sessions: 3, my_rank: 2,
      injection_count: 0, last_injected_round: 0, sensitivity: 0.5,
    };
    const coaching = computeCoaching(memory, [], null, BUDDY);
    expect(coaching.strategic_hints.some((h) => h.includes('Competition'))).toBe(true);
  });

  it('should vary tactic by style', () => {
    const aggressive: BuddyDNA = { ...BUDDY, style: 'aggressive' };
    const defensive: BuddyDNA = { ...BUDDY, style: 'defensive' };

    const aggCoach = computeCoaching(makeMemory(), [], null, aggressive);
    const defCoach = computeCoaching(makeMemory(), [], null, defensive);

    expect(aggCoach.strategic_hints).not.toEqual(defCoach.strategic_hints);
  });
});

// ─── computeCoachingAsync ───────────────────────────────────────────────────

/**
 * Build a mock DB that simulates a Drizzle query chain returning the given rows.
 * The mock ignores all arguments — it just returns rows for any query.
 */
function makeMockDb(rows: unknown[]): import('@haggle/db').Database {
  const chain = { limit: vi.fn().mockResolvedValue(rows) };
  const withWhere = { where: vi.fn().mockReturnValue(chain) };
  const withFrom = { from: vi.fn().mockReturnValue(withWhere) };
  return { select: vi.fn().mockReturnValue(withFrom) } as unknown as import('@haggle/db').Database;
}

describe('computeCoachingAsync', () => {
  it('uses trust score from DB when available', async () => {
    // Trust score 80 → u_risk = 0.8
    const mockDb = makeMockDb([{ score: '80.0000' }]);
    const coaching = await computeCoachingAsync(makeMemory(), [], null, BUDDY, mockDb, 'counterparty-uuid');
    // u_risk should be 80/100 = 0.8
    expect(coaching.utility_snapshot.u_risk).toBeCloseTo(0.8, 2);
    // Verify DB was queried
    expect((mockDb.select as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('falls back to 0.5 when DB query fails', async () => {
    const chain = { limit: vi.fn().mockRejectedValue(new Error('DB connection error')) };
    const withWhere = { where: vi.fn().mockReturnValue(chain) };
    const withFrom = { from: vi.fn().mockReturnValue(withWhere) };
    const mockDb = { select: vi.fn().mockReturnValue(withFrom) } as unknown as import('@haggle/db').Database;

    const coaching = await computeCoachingAsync(makeMemory(), [], null, BUDDY, mockDb, 'counterparty-uuid');
    expect(coaching.utility_snapshot.u_risk).toBeCloseTo(0.5, 2);
  });

  it('falls back to 0.5 when DB returns no rows', async () => {
    const mockDb = makeMockDb([]);
    const coaching = await computeCoachingAsync(makeMemory(), [], null, BUDDY, mockDb, 'counterparty-uuid');
    expect(coaching.utility_snapshot.u_risk).toBeCloseTo(0.5, 2);
  });
});
