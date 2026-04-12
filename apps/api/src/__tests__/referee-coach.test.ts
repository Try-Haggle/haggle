import { describe, it, expect } from 'vitest';
import { computeCoaching } from '../negotiation/referee/coach.js';
import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  BuddyDNA,
  NegotiationPhase,
} from '../negotiation/types.js';

// ─── Helpers ───

function makeBuddyDna(overrides?: Partial<BuddyDNA>): BuddyDNA {
  return {
    style: 'balanced',
    preferred_tactic: 'reciprocal_concession',
    category_experience: 'electronics',
    condition_trade_success_rate: 0.7,
    best_timing: 'mid-round',
    tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    ...overrides,
  };
}

function makeMemory(overrides?: {
  phase?: NegotiationPhase;
  role?: 'buyer' | 'seller';
  round?: number;
  rounds_remaining?: number;
  max_rounds?: number;
  my_target?: number;
  my_floor?: number;
  current_offer?: number;
  opponent_offer?: number;
  competition?: CoreMemory['competition'];
}): CoreMemory {
  const o = overrides ?? {};
  return {
    session: {
      session_id: 'test-session',
      phase: o.phase ?? 'BARGAINING',
      round: o.round ?? 5,
      rounds_remaining: o.rounds_remaining ?? 10,
      role: o.role ?? 'buyer',
      max_rounds: o.max_rounds ?? 15,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: o.my_target ?? 500,
      my_floor: o.my_floor ?? 700,
      current_offer: o.current_offer ?? 550,
      opponent_offer: o.opponent_offer ?? 650,
      gap: (o.opponent_offer ?? 650) - (o.current_offer ?? 550),
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {} as CoreMemory['coaching'],
    buddy_dna: makeBuddyDna(),
    skill_summary: 'electronics',
    competition: o.competition,
  };
}

function makeFact(round: number, buyer_offer: number, seller_offer: number): RoundFact {
  return {
    round,
    phase: 'BARGAINING',
    buyer_offer,
    seller_offer,
    gap: seller_offer - buyer_offer,
    conditions_changed: {},
    coaching_given: { recommended: 0, tactic: '' },
    coaching_followed: true,
    human_intervened: false,
    timestamp: Date.now(),
  };
}

describe('computeCoaching', () => {
  // ─── Phase-specific coaching (5) ───

  it('DISCOVERY: recommended_price should be 0', () => {
    const memory = makeMemory({ phase: 'DISCOVERY' });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.recommended_price).toBe(0);
  });

  it('OPENING: buyer anchor should be below target', () => {
    const memory = makeMemory({ phase: 'OPENING', role: 'buyer', my_target: 500 });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.recommended_price).toBeLessThan(500);
  });

  it('OPENING: seller anchor should be above target', () => {
    const memory = makeMemory({ phase: 'OPENING', role: 'seller', my_target: 500, my_floor: 400 });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.recommended_price).toBeGreaterThan(500);
  });

  it('BARGAINING: recommended_price from Faratin curve is between target and floor', () => {
    const memory = makeMemory({
      phase: 'BARGAINING',
      role: 'buyer',
      my_target: 500,
      my_floor: 700,
      round: 5,
      max_rounds: 15,
    });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.recommended_price).toBeGreaterThanOrEqual(500);
    expect(coaching.recommended_price).toBeLessThanOrEqual(700);
  });

  it('CLOSING: recommended_price uses current_offer', () => {
    const memory = makeMemory({ phase: 'CLOSING', current_offer: 580 });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.recommended_price).toBe(580);
  });

  // ─── BuddyDNA reflection (1) ───

  it('aggressive style should produce wider opening margin', () => {
    const memory = makeMemory({ phase: 'OPENING', role: 'buyer', my_target: 500 });
    const aggressive = computeCoaching(memory, [], null, makeBuddyDna({ style: 'aggressive' }));
    const defensive = computeCoaching(memory, [], null, makeBuddyDna({ style: 'defensive' }));
    // Aggressive buyer goes lower (more margin), so lower price
    expect(aggressive.recommended_price).toBeLessThan(defensive.recommended_price);
  });

  // ─── Convergence rate (1) ───

  it('convergence_rate positive when gap is shrinking', () => {
    const facts = [
      makeFact(1, 500, 700),
      makeFact(2, 520, 680),
      makeFact(3, 540, 660),
    ];
    const memory = makeMemory();
    const coaching = computeCoaching(memory, facts, null, makeBuddyDna());
    expect(coaching.convergence_rate).toBeGreaterThan(0);
  });

  // ─── Time pressure (1) ───

  it('time_pressure = 1 - (rounds_remaining / max_rounds)', () => {
    const memory = makeMemory({ rounds_remaining: 3, max_rounds: 15 });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.time_pressure).toBeCloseTo(1 - 3 / 15, 5);
  });

  // ─── Strategic hints (1) ───

  it('includes competition hints when competition present', () => {
    const memory = makeMemory({
      competition: {
        batna_price: 480,
        n_active_sessions: 3,
        my_rank: 2,
        injection_count: 0,
        last_injected_round: 0,
        sensitivity: 0.5,
      },
    });
    const coaching = computeCoaching(memory, [], null, makeBuddyDna());
    expect(coaching.strategic_hints.some((h) => h.includes('Competition'))).toBe(true);
    expect(coaching.strategic_hints.some((h) => h.includes('urgency'))).toBe(true);
  });

  // ─── Opponent pattern (1) ───

  it('classifies CONCEDER when opponent makes large concessions', () => {
    const facts = [
      makeFact(1, 500, 800),
      makeFact(2, 510, 740),
      makeFact(3, 520, 680),
      makeFact(4, 530, 620),
    ];
    const memory = makeMemory({ role: 'buyer' });
    const coaching = computeCoaching(memory, facts, null, makeBuddyDna());
    expect(coaching.opponent_pattern).toBe('CONCEDER');
  });
});
