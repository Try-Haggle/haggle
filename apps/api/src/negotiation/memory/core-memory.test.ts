import { describe, it, expect, beforeEach } from 'vitest';
import { CoreMemoryStore } from './core-memory.js';
import type { BuddyDNA, RefereeCoaching } from '../types.js';

const defaultBuddyDna: BuddyDNA = {
  style: 'balanced',
  preferred_tactic: 'anchoring',
  category_experience: 'electronics',
  condition_trade_success_rate: 0.7,
  best_timing: 'mid-session',
  tone: {
    style: 'professional',
    formality: 'neutral',
    emoji_use: false,
  },
};

function makeCoaching(overrides: Partial<RefereeCoaching> = {}): RefereeCoaching {
  return {
    recommended_price: 1300,
    acceptable_range: { min: 1200, max: 1400 },
    suggested_tactic: 'concede',
    hint: 'opponent is conceding',
    opponent_pattern: 'CONCEDER',
    convergence_rate: 0.6,
    time_pressure: 0.3,
    utility_snapshot: { u_price: 0.7, u_time: 0.5, u_risk: 0.8, u_quality: 0.6, u_total: 0.65 },
    strategic_hints: ['consider accepting'],
    warnings: [],
    ...overrides,
  };
}

describe('CoreMemoryStore', () => {
  let store: CoreMemoryStore;

  beforeEach(() => {
    store = new CoreMemoryStore();
  });

  it('initialize creates valid CoreMemory', () => {
    const memory = store.initialize({
      sessionId: 'sess-1',
      role: 'buyer',
      target: 1200,
      floor: 1500,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'iPhone 14 Pro electronics skill',
    });

    expect(memory.session.session_id).toBe('sess-1');
    expect(memory.session.phase).toBe('DISCOVERY');
    expect(memory.session.round).toBe(0);
    expect(memory.session.rounds_remaining).toBe(20);
    expect(memory.session.role).toBe('buyer');
    expect(memory.session.max_rounds).toBe(20);
    expect(memory.session.intervention_mode).toBe('FULL_AUTO');
    expect(memory.boundaries.my_target).toBe(1200);
    expect(memory.boundaries.my_floor).toBe(1500);
    expect(memory.buddy_dna).toEqual(defaultBuddyDna);
    expect(memory.skill_summary).toBe('iPhone 14 Pro electronics skill');
  });

  it('get returns null for missing session', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('get/set roundtrip preserves data', () => {
    const memory = store.initialize({
      sessionId: 'sess-2',
      role: 'seller',
      target: 1500,
      floor: 1200,
      maxRounds: 15,
      interventionMode: 'APPROVE_ONLY',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test skill',
    });

    const fetched = store.get('sess-2');
    expect(fetched).toEqual(memory);
  });

  it('updateAfterRound updates boundaries and increments round', () => {
    store.initialize({
      sessionId: 'sess-3',
      role: 'buyer',
      target: 1200,
      floor: 1500,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test',
    });

    const updated = store.updateAfterRound(
      'sess-3',
      {
        price: 1300,
        opponentPrice: 1400,
        conditions: { warranty: '30d' },
        phase: 'BARGAINING',
      },
      makeCoaching(),
    );

    expect(updated.session.round).toBe(1);
    expect(updated.session.rounds_remaining).toBe(19);
    expect(updated.boundaries.current_offer).toBe(1300);
    expect(updated.boundaries.opponent_offer).toBe(1400);
    expect(updated.session.phase).toBe('BARGAINING');
    expect(updated.coaching.suggested_tactic).toBe('concede');
  });

  it('buyer gap = opponent - current', () => {
    store.initialize({
      sessionId: 'sess-buyer',
      role: 'buyer',
      target: 1200,
      floor: 1500,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test',
    });

    const updated = store.updateAfterRound(
      'sess-buyer',
      {
        price: 1300,
        opponentPrice: 1400,
        conditions: {},
        phase: 'BARGAINING',
      },
      makeCoaching(),
    );

    // buyer gap = opponent(1400) - current(1300) = 100
    expect(updated.boundaries.gap).toBe(100);
  });

  it('seller gap = current - opponent', () => {
    store.initialize({
      sessionId: 'sess-seller',
      role: 'seller',
      target: 1500,
      floor: 1200,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test',
    });

    const updated = store.updateAfterRound(
      'sess-seller',
      {
        price: 1400,
        opponentPrice: 1300,
        conditions: {},
        phase: 'BARGAINING',
      },
      makeCoaching(),
    );

    // seller gap = current(1400) - opponent(1300) = 100
    expect(updated.boundaries.gap).toBe(100);
  });

  it('updatePhase changes phase', () => {
    store.initialize({
      sessionId: 'sess-4',
      role: 'buyer',
      target: 1200,
      floor: 1500,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test',
    });

    const updated = store.updatePhase('sess-4', 'OPENING');
    expect(updated.session.phase).toBe('OPENING');

    // Round and other fields unchanged
    expect(updated.session.round).toBe(0);
  });

  it('updateInterventionMode changes mode', () => {
    store.initialize({
      sessionId: 'sess-5',
      role: 'buyer',
      target: 1200,
      floor: 1500,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test',
    });

    const updated = store.updateInterventionMode('sess-5', 'MANUAL');
    expect(updated.session.intervention_mode).toBe('MANUAL');
  });

  it('delete removes entry', () => {
    store.initialize({
      sessionId: 'sess-6',
      role: 'buyer',
      target: 1200,
      floor: 1500,
      maxRounds: 20,
      interventionMode: 'FULL_AUTO',
      buddyDna: defaultBuddyDna,
      skillSummary: 'test',
    });

    expect(store.get('sess-6')).not.toBeNull();
    store.delete('sess-6');
    expect(store.get('sess-6')).toBeNull();
  });

  it('updateAfterRound throws for missing session', () => {
    expect(() =>
      store.updateAfterRound('missing', { price: 100, opponentPrice: 200, conditions: {}, phase: 'BARGAINING' }, makeCoaching()),
    ).toThrow('Session missing not found');
  });
});
