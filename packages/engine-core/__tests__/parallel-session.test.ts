import { describe, it, expect } from 'vitest';
import {
  computeParallelSessionEU,
  rankParallelSessions,
  computeDynamicBatna,
} from '../src/index.js';
import type { ParallelSessionEval } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(
  overrides?: Partial<Omit<ParallelSessionEval, 'eu'>>,
): Omit<ParallelSessionEval, 'eu'> {
  return {
    session_id: 'sess_1',
    p_close: 0.8,
    u_best: 0.9,
    u_batna_other: 0.3,
    kappa: 0.05,
    t_spent: 0.4,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeParallelSessionEU
// ---------------------------------------------------------------------------

describe('computeParallelSessionEU', () => {
  it('computes EU = p_close * u_best + (1-p_close) * u_batna_other - kappa * t_spent', () => {
    const session = makeSession();
    const result = computeParallelSessionEU(session);
    // EU = 0.8*0.9 + 0.2*0.3 - 0.05*0.4 = 0.72 + 0.06 - 0.02 = 0.76
    expect(result.eu).toBeCloseTo(0.76);
  });

  it('preserves all input fields', () => {
    const session = makeSession({ session_id: 'test_123' });
    const result = computeParallelSessionEU(session);
    expect(result.session_id).toBe('test_123');
    expect(result.p_close).toBe(0.8);
    expect(result.u_best).toBe(0.9);
    expect(result.u_batna_other).toBe(0.3);
    expect(result.kappa).toBe(0.05);
    expect(result.t_spent).toBe(0.4);
  });

  it('returns 0 EU when p_close=0, u_batna_other=0, kappa=0', () => {
    const session = makeSession({
      p_close: 0,
      u_batna_other: 0,
      kappa: 0,
    });
    const result = computeParallelSessionEU(session);
    expect(result.eu).toBeCloseTo(0);
  });

  it('high p_close and u_best yields high EU', () => {
    const session = makeSession({
      p_close: 1.0,
      u_best: 1.0,
      u_batna_other: 0,
      kappa: 0,
      t_spent: 0,
    });
    const result = computeParallelSessionEU(session);
    expect(result.eu).toBeCloseTo(1.0);
  });

  it('high time cost reduces EU', () => {
    const lowTime = computeParallelSessionEU(makeSession({ t_spent: 0.1 }));
    const highTime = computeParallelSessionEU(makeSession({ t_spent: 1.0 }));
    expect(lowTime.eu).toBeGreaterThan(highTime.eu);
  });

  it('negative EU is possible with high time cost', () => {
    const session = makeSession({
      p_close: 0.1,
      u_best: 0.1,
      u_batna_other: 0,
      kappa: 1.0,
      t_spent: 1.0,
    });
    const result = computeParallelSessionEU(session);
    expect(result.eu).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// rankParallelSessions
// ---------------------------------------------------------------------------

describe('rankParallelSessions', () => {
  it('sorts sessions by EU in descending order', () => {
    const sessions = [
      makeSession({ session_id: 'low', p_close: 0.2, u_best: 0.3 }),
      makeSession({ session_id: 'high', p_close: 0.9, u_best: 0.95 }),
      makeSession({ session_id: 'mid', p_close: 0.5, u_best: 0.6 }),
    ];
    const ranked = rankParallelSessions(sessions);
    expect(ranked[0].session_id).toBe('high');
    expect(ranked[2].session_id).toBe('low');
    expect(ranked[0].eu).toBeGreaterThanOrEqual(ranked[1].eu);
    expect(ranked[1].eu).toBeGreaterThanOrEqual(ranked[2].eu);
  });

  it('returns empty array for empty input', () => {
    expect(rankParallelSessions([])).toEqual([]);
  });

  it('single session is returned with computed EU', () => {
    const sessions = [makeSession()];
    const ranked = rankParallelSessions(sessions);
    expect(ranked).toHaveLength(1);
    expect(typeof ranked[0].eu).toBe('number');
  });

  it('all sessions have EU computed', () => {
    const sessions = [
      makeSession({ session_id: 'a' }),
      makeSession({ session_id: 'b' }),
      makeSession({ session_id: 'c' }),
    ];
    const ranked = rankParallelSessions(sessions);
    for (const s of ranked) {
      expect(typeof s.eu).toBe('number');
      expect(Number.isFinite(s.eu)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// computeDynamicBatna
// ---------------------------------------------------------------------------

describe('computeDynamicBatna', () => {
  const evaluated: ParallelSessionEval[] = [
    { ...makeSession({ session_id: 'a', p_close: 0.8, u_best: 0.9 }), eu: 0.76 },
    { ...makeSession({ session_id: 'b', p_close: 0.5, u_best: 0.7 }), eu: 0.43 },
    { ...makeSession({ session_id: 'c', p_close: 0.3, u_best: 0.4 }), eu: 0.15 },
  ];

  it('returns max(p_close * u_best) of other sessions', () => {
    // Exclude 'a' → best alternative is 'b': 0.5*0.7 = 0.35
    const batna = computeDynamicBatna(evaluated, 'a');
    expect(batna).toBeCloseTo(0.35);
  });

  it('returns 0 when no other sessions exist', () => {
    const single: ParallelSessionEval[] = [
      { ...makeSession({ session_id: 'only' }), eu: 0.7 },
    ];
    expect(computeDynamicBatna(single, 'only')).toBe(0);
  });

  it('returns 0 for empty sessions array', () => {
    expect(computeDynamicBatna([], 'any')).toBe(0);
  });

  it('excludes the specified session correctly', () => {
    // Exclude 'b' → best alternative is 'a': 0.8*0.9 = 0.72
    const batna = computeDynamicBatna(evaluated, 'b');
    expect(batna).toBeCloseTo(0.72);
  });

  it('handles non-existent session id (returns max of all)', () => {
    const batna = computeDynamicBatna(evaluated, 'nonexistent');
    // All sessions included → max(0.72, 0.35, 0.12) = 0.72
    expect(batna).toBeCloseTo(0.72);
  });
});
