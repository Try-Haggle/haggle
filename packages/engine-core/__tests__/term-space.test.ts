import { describe, it, expect } from 'vitest';
import type { Term, TermSpace } from '../src/term/types.js';
import {
  evaluateTerm,
  computeMultiTermUtility,
  validateTermSpace,
} from '../src/term/evaluator.js';
import { EngineError } from '../src/types.js';

// ─── Fixtures ────────────────────────────────────────────

function makeTerm(overrides?: Partial<Term>): Term {
  return {
    id: 'price',
    type: 'NEGOTIABLE',
    layer: 'GLOBAL',
    weight: 1.0,
    domain: { min: 0, max: 100, direction: 'lower_is_better' },
    ...overrides,
  };
}

function makeTermSpace(overrides?: Partial<TermSpace>): TermSpace {
  return {
    terms: [makeTerm()],
    current_values: { price: 50 },
    ...overrides,
  };
}

// ─── validateTermSpace ──────────────────────────────────

describe('validateTermSpace', () => {
  it('returns null for valid term space', () => {
    expect(validateTermSpace(makeTermSpace())).toBeNull();
  });

  it('returns error for empty terms', () => {
    expect(validateTermSpace({ terms: [], current_values: {} })).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('returns error when NEGOTIABLE lacks domain', () => {
    const ts = makeTermSpace({
      terms: [makeTerm({ domain: undefined })],
    });
    expect(validateTermSpace(ts)).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('returns error when INFORMATIONAL has domain', () => {
    const ts = makeTermSpace({
      terms: [makeTerm({ type: 'INFORMATIONAL', weight: 0 })],
    });
    expect(validateTermSpace(ts)).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('returns error for negative weight', () => {
    const ts = makeTermSpace({
      terms: [makeTerm({ weight: -0.5 })],
    });
    expect(validateTermSpace(ts)).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('returns error when domain min >= max', () => {
    const ts = makeTermSpace({
      terms: [makeTerm({ domain: { min: 100, max: 50, direction: 'lower_is_better' } })],
    });
    expect(validateTermSpace(ts)).toBe(EngineError.ZERO_PRICE_RANGE);
  });

  it('returns error when NEGOTIABLE weights do not sum to 1', () => {
    const ts = makeTermSpace({
      terms: [
        makeTerm({ id: 'a', weight: 0.3 }),
        makeTerm({ id: 'b', weight: 0.3 }),
      ],
      current_values: { a: 50, b: 50 },
    });
    expect(validateTermSpace(ts)).toBe(EngineError.INVALID_WEIGHTS);
  });

  it('accepts valid multi-term space with weights summing to 1', () => {
    const ts = makeTermSpace({
      terms: [
        makeTerm({ id: 'a', weight: 0.6 }),
        makeTerm({ id: 'b', weight: 0.4, domain: { min: 0, max: 30, direction: 'higher_is_better' } }),
      ],
      current_values: { a: 50, b: 15 },
    });
    expect(validateTermSpace(ts)).toBeNull();
  });
});

// ─── evaluateTerm ───────────────────────────────────────

describe('evaluateTerm', () => {
  it('INFORMATIONAL: passes value through clamped to [0,1]', () => {
    const term = makeTerm({ type: 'INFORMATIONAL', domain: undefined, weight: 0 });
    expect(evaluateTerm(term, 0.7)).toBeCloseTo(0.7);
    expect(evaluateTerm(term, 1.5)).toBeCloseTo(1.0);
    expect(evaluateTerm(term, -0.2)).toBeCloseTo(0.0);
  });

  it('NEGOTIABLE lower_is_better: best at min, worst at max', () => {
    const term = makeTerm({ domain: { min: 0, max: 100, direction: 'lower_is_better' } });
    // At min → max utility
    expect(evaluateTerm(term, 0)).toBeCloseTo(1.0);
    // At max → 0
    expect(evaluateTerm(term, 100)).toBe(0);
    // Mid-range → between 0 and 1
    const mid = evaluateTerm(term, 50);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('NEGOTIABLE higher_is_better: best at max, worst at min', () => {
    const term = makeTerm({ domain: { min: 0, max: 100, direction: 'higher_is_better' } });
    expect(evaluateTerm(term, 100)).toBeCloseTo(1.0);
    expect(evaluateTerm(term, 0)).toBe(0);
    const mid = evaluateTerm(term, 50);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('NEGOTIABLE: concavity — first half has more utility gain than second', () => {
    const term = makeTerm({ domain: { min: 0, max: 100, direction: 'lower_is_better' } });
    const u25 = evaluateTerm(term, 25);
    const u75 = evaluateTerm(term, 75);
    // Log utility is concave: improvement from 75→25 > from 25→0 in absolute terms
    expect(u25).toBeGreaterThan(u75);
  });
});

// ─── computeMultiTermUtility ────────────────────────────

describe('computeMultiTermUtility', () => {
  it('single NEGOTIABLE term returns its weighted utility', () => {
    const ts = makeTermSpace({ current_values: { price: 0 } }); // best case
    const u = computeMultiTermUtility(ts);
    expect(u).toBeCloseTo(1.0);
  });

  it('all terms at worst → near 0', () => {
    const ts = makeTermSpace({ current_values: { price: 100 } }); // worst case
    const u = computeMultiTermUtility(ts);
    expect(u).toBe(0);
  });

  it('INFORMATIONAL terms add small bonus', () => {
    const ts: TermSpace = {
      terms: [
        makeTerm({ id: 'price', weight: 1.0 }),
        makeTerm({ id: 'info', type: 'INFORMATIONAL', weight: 0, domain: undefined }),
      ],
      current_values: { price: 50, info: 0.8 },
    };
    const uWithInfo = computeMultiTermUtility(ts);

    const tsNoInfo: TermSpace = {
      terms: [makeTerm({ id: 'price', weight: 1.0 })],
      current_values: { price: 50 },
    };
    const uWithoutInfo = computeMultiTermUtility(tsNoInfo);

    // Info bonus should make utility slightly higher
    expect(uWithInfo).toBeGreaterThan(uWithoutInfo);
  });

  it('multi-term weighted correctly', () => {
    const ts: TermSpace = {
      terms: [
        makeTerm({ id: 'price', weight: 0.6, domain: { min: 0, max: 100, direction: 'lower_is_better' } }),
        makeTerm({ id: 'warranty', weight: 0.4, domain: { min: 0, max: 36, direction: 'higher_is_better' } }),
      ],
      current_values: { price: 0, warranty: 36 },
    };
    const u = computeMultiTermUtility(ts);
    // Both at best value → ~1.0
    expect(u).toBeCloseTo(1.0);
  });

  it('result clamped to [0,1]', () => {
    const ts = makeTermSpace();
    const u = computeMultiTermUtility(ts);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
  });
});
