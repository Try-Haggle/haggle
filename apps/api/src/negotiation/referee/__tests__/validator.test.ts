import { describe, it, expect } from 'vitest';
import { validateMove } from '../validator.js';
import type { EngineDecision, CoreMemory, RefereeCoaching } from '../../types.js';

function makeMemory(overrides: Record<string, unknown> = {}): CoreMemory {
  return {
    session: {
      session_id: 'test', phase: 'BARGAINING', round: 5, rounds_remaining: 10,
      role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 500, my_floor: 650, current_offer: 520, opponent_offer: 620, gap: 100,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {} as CoreMemory['coaching'],
    buddy_dna: {
      style: 'balanced', preferred_tactic: 'reciprocal_concession',
      category_experience: 'electronics', condition_trade_success_rate: 0.7,
      best_timing: 'mid-bargaining',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: 'test',
    ...overrides,
  } as CoreMemory;
}

const COACHING: RefereeCoaching = {
  recommended_price: 540, acceptable_range: { min: 480, max: 650 },
  suggested_tactic: 'anchoring', hint: '', opponent_pattern: 'LINEAR',
  convergence_rate: 0.1, time_pressure: 0.3,
  utility_snapshot: { u_price: 0.7, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.65 },
  strategic_hints: [], warnings: [],
};

describe('validateMove', () => {
  it('should pass valid COUNTER in BARGAINING', () => {
    const move: EngineDecision = { action: 'COUNTER', price: 540, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, [], 'BARGAINING');
    expect(result.passed).toBe(true);
    expect(result.hardPassed).toBe(true);
  });

  it('should HARD fail on floor violation (buyer)', () => {
    const move: EngineDecision = { action: 'COUNTER', price: 700, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, [], 'BARGAINING');
    expect(result.passed).toBe(false);
    expect(result.hardPassed).toBe(false);
    const v1 = result.violations.find((v) => v.rule === 'V1');
    expect(v1).toBeDefined();
    expect(v1!.severity).toBe('HARD');
  });

  it('should HARD fail on floor violation (seller)', () => {
    const memory = makeMemory({
      session: {
        session_id: 'test', phase: 'BARGAINING', round: 5, rounds_remaining: 10,
        role: 'seller', max_rounds: 15, intervention_mode: 'FULL_AUTO',
      },
      boundaries: {
        my_target: 700, my_floor: 550, current_offer: 680, opponent_offer: 520, gap: 160,
      },
    });
    const move: EngineDecision = { action: 'COUNTER', price: 500, reasoning: 'test' };
    const result = validateMove(move, memory, COACHING, [], 'BARGAINING');
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.rule === 'V1')).toBe(true);
  });

  it('should HARD fail on invalid phase action', () => {
    const move: EngineDecision = { action: 'CONFIRM', price: 540, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, [], 'BARGAINING');
    // CONFIRM is not allowed in BARGAINING (only COUNTER, ACCEPT, REJECT, HOLD)
    // Actually checking PHASE_ALLOWED_ACTIONS...
    // BARGAINING allows: COUNTER, ACCEPT, REJECT, HOLD — CONFIRM is not allowed
    expect(result.violations.some((v) => v.rule === 'V2')).toBe(true);
  });

  it('should HARD fail on COUNTER with 0 rounds remaining', () => {
    const memory = makeMemory({
      session: {
        session_id: 'test', phase: 'BARGAINING', round: 15, rounds_remaining: 0,
        role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO',
      },
    });
    const move: EngineDecision = { action: 'COUNTER', price: 540, reasoning: 'test' };
    const result = validateMove(move, memory, COACHING, [], 'BARGAINING');
    expect(result.violations.some((v) => v.rule === 'V3')).toBe(true);
  });

  it('should SOFT warn on concession direction reversal', () => {
    const prev: EngineDecision[] = [
      { action: 'COUNTER', price: 500, reasoning: 'r1' },
      { action: 'COUNTER', price: 520, reasoning: 'r2' },
    ];
    // Buyer was raising (conceding), now drops — reversal
    const move: EngineDecision = { action: 'COUNTER', price: 510, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING');
    expect(result.violations.some((v) => v.rule === 'V4')).toBe(true);
  });

  it('should SOFT warn on stagnation', () => {
    const prev: EngineDecision[] = [
      { action: 'COUNTER', price: 520, reasoning: 'r1' },
      { action: 'COUNTER', price: 520, reasoning: 'r2' },
      { action: 'COUNTER', price: 521, reasoning: 'r3' },
      { action: 'COUNTER', price: 521, reasoning: 'r4' },
    ];
    const move: EngineDecision = { action: 'COUNTER', price: 521, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING');
    expect(result.violations.some((v) => v.rule === 'V5')).toBe(true);
  });

  it('should SOFT warn on large concession', () => {
    const prev: EngineDecision[] = [
      { action: 'COUNTER', price: 520, reasoning: 'r1' },
    ];
    // Jump from 520 to 610 — way more than recommended step
    const move: EngineDecision = { action: 'COUNTER', price: 610, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING');
    expect(result.violations.some((v) => v.rule === 'V7')).toBe(true);
  });

  it('should have hardPassed=true with only SOFT violations', () => {
    const prev: EngineDecision[] = [
      { action: 'COUNTER', price: 520, reasoning: 'r1' },
      { action: 'COUNTER', price: 520, reasoning: 'r2' },
      { action: 'COUNTER', price: 520, reasoning: 'r3' },
      { action: 'COUNTER', price: 520, reasoning: 'r4' },
    ];
    const move: EngineDecision = { action: 'COUNTER', price: 521, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING');
    // SOFT violations present → passed=false, but hardPassed=true
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.every((v) => v.severity === 'SOFT')).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.hardPassed).toBe(true);
  });
});
