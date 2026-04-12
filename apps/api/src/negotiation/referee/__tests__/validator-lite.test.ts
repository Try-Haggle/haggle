import { describe, it, expect } from 'vitest';
import { validateMove } from '../validator.js';
import type { ProtocolDecision, CoreMemory, RefereeCoaching } from '../../types.js';

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

describe('validateMove — lite mode', () => {
  it('should still detect V1 HARD violation in lite mode', () => {
    const move: ProtocolDecision = { action: 'COUNTER', price: 700, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, [], 'BARGAINING', 'lite');
    expect(result.hardPassed).toBe(false);
    expect(result.violations.some((v) => v.rule === 'V1')).toBe(true);
  });

  it('should still detect V2 HARD violation in lite mode', () => {
    const move: ProtocolDecision = { action: 'CONFIRM', price: 540, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, [], 'BARGAINING', 'lite');
    expect(result.violations.some((v) => v.rule === 'V2')).toBe(true);
  });

  it('should still detect V3 HARD violation in lite mode', () => {
    const memory = makeMemory({
      session: {
        session_id: 'test', phase: 'BARGAINING', round: 15, rounds_remaining: 0,
        role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO',
      },
    });
    const move: ProtocolDecision = { action: 'COUNTER', price: 540, reasoning: 'test' };
    const result = validateMove(move, memory, COACHING, [], 'BARGAINING', 'lite');
    expect(result.violations.some((v) => v.rule === 'V3')).toBe(true);
  });

  it('should skip V4 (concession reversal) in lite mode', () => {
    const prev: ProtocolDecision[] = [
      { action: 'COUNTER', price: 500, reasoning: 'r1' },
      { action: 'COUNTER', price: 520, reasoning: 'r2' },
    ];
    const move: ProtocolDecision = { action: 'COUNTER', price: 510, reasoning: 'test' };
    // full mode would catch V4
    const fullResult = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING', 'full');
    expect(fullResult.violations.some((v) => v.rule === 'V4')).toBe(true);
    // lite mode skips it
    const liteResult = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING', 'lite');
    expect(liteResult.violations.some((v) => v.rule === 'V4')).toBe(false);
  });

  it('should skip V5 (stagnation) in lite mode', () => {
    const prev: ProtocolDecision[] = [
      { action: 'COUNTER', price: 520, reasoning: 'r1' },
      { action: 'COUNTER', price: 520, reasoning: 'r2' },
      { action: 'COUNTER', price: 521, reasoning: 'r3' },
      { action: 'COUNTER', price: 521, reasoning: 'r4' },
    ];
    const move: ProtocolDecision = { action: 'COUNTER', price: 521, reasoning: 'test' };
    const fullResult = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING', 'full');
    expect(fullResult.violations.some((v) => v.rule === 'V5')).toBe(true);
    const liteResult = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING', 'lite');
    expect(liteResult.violations.some((v) => v.rule === 'V5')).toBe(false);
  });

  it('should skip V7 (large concession) in lite mode', () => {
    const prev: ProtocolDecision[] = [
      { action: 'COUNTER', price: 520, reasoning: 'r1' },
    ];
    const move: ProtocolDecision = { action: 'COUNTER', price: 610, reasoning: 'test' };
    const fullResult = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING', 'full');
    expect(fullResult.violations.some((v) => v.rule === 'V7')).toBe(true);
    const liteResult = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING', 'lite');
    expect(liteResult.violations.some((v) => v.rule === 'V7')).toBe(false);
  });

  it('should pass cleanly in lite mode when no HARD violations', () => {
    const move: ProtocolDecision = { action: 'COUNTER', price: 540, reasoning: 'test' };
    const result = validateMove(move, makeMemory(), COACHING, [], 'BARGAINING', 'lite');
    expect(result.passed).toBe(true);
    expect(result.hardPassed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should default to full mode when mode not specified', () => {
    const prev: ProtocolDecision[] = [
      { action: 'COUNTER', price: 500, reasoning: 'r1' },
      { action: 'COUNTER', price: 520, reasoning: 'r2' },
    ];
    const move: ProtocolDecision = { action: 'COUNTER', price: 510, reasoning: 'test' };
    // No mode arg — should detect V4 (full mode)
    const result = validateMove(move, makeMemory(), COACHING, prev, 'BARGAINING');
    expect(result.violations.some((v) => v.rule === 'V4')).toBe(true);
  });
});
