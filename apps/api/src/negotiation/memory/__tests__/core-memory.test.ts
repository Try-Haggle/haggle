import { describe, it, expect, beforeEach } from 'vitest';
import { CoreMemoryStore } from '../core-memory.js';
import type { BuddyDNA, RefereeCoaching } from '../../types.js';

const BUDDY_DNA: BuddyDNA = {
  style: 'balanced',
  preferred_tactic: 'reciprocal_concession',
  category_experience: 'electronics',
  condition_trade_success_rate: 0.7,
  best_timing: 'mid-bargaining',
  tone: {
    style: 'professional',
    formality: 'neutral',
    emoji_use: false,
  },
};

describe('CoreMemoryStore', () => {
  let store: CoreMemoryStore;

  beforeEach(() => {
    store = new CoreMemoryStore();
  });

  it('should initialize a new session', () => {
    const memory = store.initialize({
      sessionId: 'sess-1',
      role: 'buyer',
      target: 500,
      floor: 650,
      maxRounds: 15,
      interventionMode: 'FULL_AUTO',
      buddyDna: BUDDY_DNA,
      skillSummary: 'Electronics iPhone Pro',
    });

    expect(memory.session.session_id).toBe('sess-1');
    expect(memory.session.phase).toBe('DISCOVERY');
    expect(memory.session.round).toBe(0);
    expect(memory.session.rounds_remaining).toBe(15);
    expect(memory.boundaries.my_target).toBe(500);
    expect(memory.boundaries.my_floor).toBe(650);
    expect(memory.boundaries.gap).toBe(0);
  });

  it('should get and set memory', () => {
    store.initialize({
      sessionId: 'sess-2',
      role: 'seller',
      target: 700,
      floor: 550,
      maxRounds: 20,
      interventionMode: 'APPROVE_ONLY',
      buddyDna: BUDDY_DNA,
      skillSummary: 'test',
    });

    const retrieved = store.get('sess-2');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.session.role).toBe('seller');
  });

  it('should return null for unknown session', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('should update after round', () => {
    store.initialize({
      sessionId: 'sess-3',
      role: 'buyer',
      target: 500,
      floor: 650,
      maxRounds: 10,
      interventionMode: 'FULL_AUTO',
      buddyDna: BUDDY_DNA,
      skillSummary: 'test',
    });

    const coaching: RefereeCoaching = {
      recommended_price: 520,
      acceptable_range: { min: 480, max: 650 },
      suggested_tactic: 'anchoring',
      hint: 'test',
      opponent_pattern: 'LINEAR',
      convergence_rate: 0.1,
      time_pressure: 0.1,
      utility_snapshot: { u_price: 0.8, u_time: 0.9, u_risk: 0.5, u_quality: 0.5, u_total: 0.7 },
      strategic_hints: [],
      warnings: [],
    };

    const updated = store.updateAfterRound('sess-3', {
      price: 480,
      opponentPrice: 600,
      conditions: {},
      phase: 'OPENING',
    }, coaching);

    expect(updated.session.round).toBe(1);
    expect(updated.session.rounds_remaining).toBe(9);
    expect(updated.boundaries.current_offer).toBe(480);
    expect(updated.boundaries.opponent_offer).toBe(600);
    // buyer gap: opponent - my = 600 - 480 = 120
    expect(updated.boundaries.gap).toBe(120);
  });

  it('should throw on update for unknown session', () => {
    expect(() =>
      store.updateAfterRound('unknown', {
        price: 100, opponentPrice: 200, conditions: {}, phase: 'OPENING',
      }, {} as RefereeCoaching),
    ).toThrow('Session unknown not found');
  });

  it('should update phase', () => {
    store.initialize({
      sessionId: 'sess-4',
      role: 'buyer',
      target: 500,
      floor: 650,
      maxRounds: 10,
      interventionMode: 'FULL_AUTO',
      buddyDna: BUDDY_DNA,
      skillSummary: 'test',
    });

    const updated = store.updatePhase('sess-4', 'BARGAINING');
    expect(updated.session.phase).toBe('BARGAINING');
  });

  it('should update intervention mode', () => {
    store.initialize({
      sessionId: 'sess-5',
      role: 'buyer',
      target: 500,
      floor: 650,
      maxRounds: 10,
      interventionMode: 'FULL_AUTO',
      buddyDna: BUDDY_DNA,
      skillSummary: 'test',
    });

    const updated = store.updateInterventionMode('sess-5', 'HYBRID');
    expect(updated.session.intervention_mode).toBe('HYBRID');
  });

  it('should delete session', () => {
    store.initialize({
      sessionId: 'sess-6',
      role: 'buyer',
      target: 500,
      floor: 650,
      maxRounds: 10,
      interventionMode: 'FULL_AUTO',
      buddyDna: BUDDY_DNA,
      skillSummary: 'test',
    });

    store.delete('sess-6');
    expect(store.get('sess-6')).toBeNull();
  });
});
