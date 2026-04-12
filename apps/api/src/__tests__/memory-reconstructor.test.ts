import { describe, it, expect } from 'vitest';
import {
  inferPhaseFromStatus,
  phaseToDbStatus,
  reconstructCoreMemory,
  reconstructRoundFacts,
  reconstructOpponentPattern,
  type DbSessionForMemory,
  type DbRoundForMemory,
} from '../negotiation/memory/memory-reconstructor.js';
import type { RefereeCoaching } from '../negotiation/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDbSession(overrides: Partial<DbSessionForMemory> = {}): DbSessionForMemory {
  return {
    id: 'session-1',
    role: 'BUYER',
    status: 'ACTIVE',
    currentRound: 3,
    roundsNoConcession: 0,
    lastOfferPriceMinor: '50000',
    lastUtility: { u_total: 0.7, v_p: 0.6, v_t: 0.8, v_r: 0.5, v_s: 0.5 },
    strategySnapshot: {
      p_target: 45000,
      p_limit: 60000,
      max_rounds: 15,
    },
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeCoaching(overrides: Partial<RefereeCoaching> = {}): RefereeCoaching {
  return {
    recommended_price: 48000,
    acceptable_range: { min: 42000, max: 60000 },
    suggested_tactic: 'reciprocal_concession',
    hint: 'test hint',
    opponent_pattern: 'LINEAR',
    convergence_rate: 0.03,
    time_pressure: 0.2,
    utility_snapshot: { u_price: 0.7, u_time: 0.8, u_risk: 0.5, u_quality: 0.5, u_total: 0.65 },
    strategic_hints: ['Hold position'],
    warnings: [],
    ...overrides,
  };
}

function makeDbRound(overrides: Partial<DbRoundForMemory> = {}): DbRoundForMemory {
  return {
    roundNo: 1,
    senderRole: 'BUYER',
    priceminor: '45000',
    counterPriceMinor: '55000',
    decision: 'COUNTER',
    utility: { u_total: 0.7, v_p: 0.6, v_t: 0.8, v_r: 0.5, v_s: 0.5 },
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// inferPhaseFromStatus
// ---------------------------------------------------------------------------

describe('inferPhaseFromStatus', () => {
  it('maps CREATED → OPENING (skip DISCOVERY)', () => {
    expect(inferPhaseFromStatus('CREATED', 0, 0)).toBe('OPENING');
  });

  it('maps ACTIVE round ≤ 1 → OPENING', () => {
    expect(inferPhaseFromStatus('ACTIVE', 0, 0)).toBe('OPENING');
    expect(inferPhaseFromStatus('ACTIVE', 1, 0)).toBe('OPENING');
  });

  it('maps ACTIVE round > 1 → BARGAINING', () => {
    expect(inferPhaseFromStatus('ACTIVE', 2, 0)).toBe('BARGAINING');
    expect(inferPhaseFromStatus('ACTIVE', 10, 0)).toBe('BARGAINING');
  });

  it('maps NEAR_DEAL → CLOSING', () => {
    expect(inferPhaseFromStatus('NEAR_DEAL', 5, 0)).toBe('CLOSING');
  });

  it('maps STALLED → BARGAINING', () => {
    expect(inferPhaseFromStatus('STALLED', 5, 4)).toBe('BARGAINING');
  });

  it('maps terminal statuses → SETTLEMENT', () => {
    expect(inferPhaseFromStatus('ACCEPTED', 5, 0)).toBe('SETTLEMENT');
    expect(inferPhaseFromStatus('REJECTED', 5, 0)).toBe('SETTLEMENT');
    expect(inferPhaseFromStatus('EXPIRED', 5, 0)).toBe('SETTLEMENT');
    expect(inferPhaseFromStatus('SUPERSEDED', 5, 0)).toBe('SETTLEMENT');
  });
});

// ---------------------------------------------------------------------------
// phaseToDbStatus
// ---------------------------------------------------------------------------

describe('phaseToDbStatus', () => {
  it('maps OPENING → ACTIVE', () => {
    expect(phaseToDbStatus('OPENING', 'COUNTER', 0)).toBe('ACTIVE');
  });

  it('maps BARGAINING → ACTIVE when rounds_no_concession < 4', () => {
    expect(phaseToDbStatus('BARGAINING', 'COUNTER', 2)).toBe('ACTIVE');
  });

  it('maps BARGAINING → STALLED when rounds_no_concession ≥ 4', () => {
    expect(phaseToDbStatus('BARGAINING', 'COUNTER', 4)).toBe('STALLED');
  });

  it('maps BARGAINING + HOLD → WAITING (human intervention pending)', () => {
    expect(phaseToDbStatus('BARGAINING', 'HOLD', 0)).toBe('WAITING');
    expect(phaseToDbStatus('BARGAINING', 'HOLD', 5)).toBe('WAITING');
  });

  it('maps CLOSING → NEAR_DEAL', () => {
    expect(phaseToDbStatus('CLOSING', 'HOLD', 0)).toBe('NEAR_DEAL');
  });

  it('maps SETTLEMENT + ACCEPT → ACCEPTED', () => {
    expect(phaseToDbStatus('SETTLEMENT', 'ACCEPT', 0)).toBe('ACCEPTED');
    expect(phaseToDbStatus('SETTLEMENT', 'CONFIRM', 0)).toBe('ACCEPTED');
  });

  it('maps SETTLEMENT + REJECT → REJECTED', () => {
    expect(phaseToDbStatus('SETTLEMENT', 'REJECT', 0)).toBe('REJECTED');
  });
});

// ---------------------------------------------------------------------------
// reconstructCoreMemory
// ---------------------------------------------------------------------------

describe('reconstructCoreMemory', () => {
  it('builds CoreMemory from DB session + strategy', () => {
    const session = makeDbSession();
    const coaching = makeCoaching();
    const memory = reconstructCoreMemory(session, session.strategySnapshot, coaching);

    expect(memory.session.session_id).toBe('session-1');
    expect(memory.session.role).toBe('buyer');
    expect(memory.session.round).toBe(3);
    expect(memory.session.max_rounds).toBe(15);
    expect(memory.session.rounds_remaining).toBe(12);
    expect(memory.boundaries.my_target).toBe(45000);
    expect(memory.boundaries.my_floor).toBe(60000);
    expect(memory.coaching).toBe(coaching);
  });

  it('infers phase from status when phase column is null', () => {
    const session = makeDbSession({ phase: null, status: 'NEAR_DEAL' });
    const memory = reconstructCoreMemory(session, session.strategySnapshot, makeCoaching());
    expect(memory.session.phase).toBe('CLOSING');
  });

  it('uses stored phase when available', () => {
    const session = makeDbSession({ phase: 'BARGAINING' });
    const memory = reconstructCoreMemory(session, session.strategySnapshot, makeCoaching());
    expect(memory.session.phase).toBe('BARGAINING');
  });

  it('defaults intervention mode to FULL_AUTO', () => {
    const session = makeDbSession();
    const memory = reconstructCoreMemory(session, session.strategySnapshot, makeCoaching());
    expect(memory.session.intervention_mode).toBe('FULL_AUTO');
  });
});

// ---------------------------------------------------------------------------
// reconstructRoundFacts
// ---------------------------------------------------------------------------

describe('reconstructRoundFacts', () => {
  it('converts DB rounds to RoundFact[]', () => {
    const rounds: DbRoundForMemory[] = [
      makeDbRound({ roundNo: 1, senderRole: 'BUYER', priceminor: '40000', counterPriceMinor: '55000' }),
      makeDbRound({ roundNo: 2, senderRole: 'SELLER', priceminor: '53000', counterPriceMinor: '42000' }),
    ];

    const facts = reconstructRoundFacts(rounds, 'BUYER');

    expect(facts).toHaveLength(2);
    expect(facts[0]!.round).toBe(1);
    expect(facts[0]!.buyer_offer).toBe(40000);
    expect(facts[0]!.seller_offer).toBe(55000);
    expect(facts[0]!.gap).toBe(15000);
  });

  it('returns empty array for no rounds', () => {
    expect(reconstructRoundFacts([], 'BUYER')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reconstructOpponentPattern
// ---------------------------------------------------------------------------

describe('reconstructOpponentPattern', () => {
  it('returns null for < 2 facts', () => {
    expect(reconstructOpponentPattern([], 'buyer')).toBeNull();
    const singleFact = reconstructRoundFacts(
      [makeDbRound({ roundNo: 1 })],
      'BUYER',
    );
    expect(reconstructOpponentPattern(singleFact, 'buyer')).toBeNull();
  });

  it('detects BOULWARE pattern (no concession)', () => {
    const rounds: DbRoundForMemory[] = [
      makeDbRound({ roundNo: 1, senderRole: 'BUYER', priceminor: '40000', counterPriceMinor: '55000' }),
      makeDbRound({ roundNo: 2, senderRole: 'BUYER', priceminor: '42000', counterPriceMinor: '55000' }),
      makeDbRound({ roundNo: 3, senderRole: 'BUYER', priceminor: '43000', counterPriceMinor: '55000' }),
    ];
    const facts = reconstructRoundFacts(rounds, 'BUYER');
    const pattern = reconstructOpponentPattern(facts, 'buyer');

    expect(pattern).not.toBeNull();
    expect(pattern!.aggression).toBeGreaterThanOrEqual(0.7);
  });

  it('detects CONCEDER pattern (large concessions)', () => {
    const rounds: DbRoundForMemory[] = [
      makeDbRound({ roundNo: 1, senderRole: 'BUYER', priceminor: '40000', counterPriceMinor: '55000' }),
      makeDbRound({ roundNo: 2, senderRole: 'BUYER', priceminor: '42000', counterPriceMinor: '50000' }),
      makeDbRound({ roundNo: 3, senderRole: 'BUYER', priceminor: '43000', counterPriceMinor: '46000' }),
    ];
    const facts = reconstructRoundFacts(rounds, 'BUYER');
    const pattern = reconstructOpponentPattern(facts, 'buyer');

    expect(pattern).not.toBeNull();
    // CONCEDER: aggression ≤ 0.5 (EMA concession_rate > 0.05 → aggression = 0.2, else 0.5)
    expect(pattern!.aggression).toBeLessThanOrEqual(0.5);
    expect(pattern!.concession_rate).toBeGreaterThan(0);
  });
});
