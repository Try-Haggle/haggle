import { describe, it, expect } from 'vitest';
import {
  classifyConcessionPattern,
  extractConcessions,
  computeConcessionRates,
  classifyOutcome,
  computeCoachDeviation,
  toValueRange,
  summarizeSession,
} from '../src/index.js';
import type { RoundSnapshot, SummarizeInput } from '../src/index.js';

// ── Pattern Classifier ─────────────────────────────────────────

describe('classifyConcessionPattern', () => {
  it('returns LINEAR for fewer than 2 entries', () => {
    expect(classifyConcessionPattern([])).toBe('LINEAR');
    expect(classifyConcessionPattern([100])).toBe('LINEAR');
  });

  it('returns LINEAR for uniform concessions', () => {
    expect(classifyConcessionPattern([100, 100, 100, 100])).toBe('LINEAR');
  });

  it('returns CONCEDER for front-loaded concessions', () => {
    // Large concessions early, small late
    expect(classifyConcessionPattern([500, 400, 50, 50])).toBe('CONCEDER');
  });

  it('returns BOULWARE for back-loaded concessions', () => {
    // Small concessions early, large late
    expect(classifyConcessionPattern([50, 50, 400, 500])).toBe('BOULWARE');
  });

  it('returns LINEAR for all-zero concessions', () => {
    expect(classifyConcessionPattern([0, 0, 0, 0])).toBe('LINEAR');
  });
});

// ── Extract Concessions ────────────────────────────────────────

describe('extractConcessions', () => {
  it('buyer concedes by raising price', () => {
    expect(extractConcessions([50000, 55000, 53000, 58000], 'BUYER'))
      .toEqual([5000, 0, 5000]);
  });

  it('seller concedes by lowering price', () => {
    expect(extractConcessions([80000, 75000, 77000, 72000], 'SELLER'))
      .toEqual([5000, 0, 5000]);
  });

  it('returns empty for single price', () => {
    expect(extractConcessions([50000], 'BUYER')).toEqual([]);
  });
});

// ── Concession Rates ───────────────────────────────────────────

describe('computeConcessionRates', () => {
  it('computes rates relative to initial spread', () => {
    // Buyer: 50000 → 55000 → 60000, spread = 30000
    const rates = computeConcessionRates([50000, 55000, 60000], 30000, 'BUYER');
    expect(rates[0]).toBeCloseTo(5000 / 30000);
    expect(rates[1]).toBeCloseTo(5000 / 30000);
  });

  it('returns zeros for zero spread', () => {
    expect(computeConcessionRates([50000, 55000], 0, 'BUYER')).toEqual([0]);
  });
});

// ── Outcome Classification ─────────────────────────────────────

describe('classifyOutcome', () => {
  it('maps ACCEPTED → DEAL', () => {
    expect(classifyOutcome('ACCEPTED')).toBe('DEAL');
  });

  it('maps REJECTED → REJECT', () => {
    expect(classifyOutcome('REJECTED')).toBe('REJECT');
  });

  it('maps EXPIRED → TIMEOUT', () => {
    expect(classifyOutcome('EXPIRED')).toBe('TIMEOUT');
  });

  it('maps other statuses → WALKAWAY', () => {
    expect(classifyOutcome('SUPERSEDED')).toBe('WALKAWAY');
    expect(classifyOutcome('STALLED')).toBe('WALKAWAY');
  });
});

// ── Coach Deviation ────────────────────────────────────────────

describe('computeCoachDeviation', () => {
  it('computes average absolute deviation', () => {
    const rounds: RoundSnapshot[] = [
      { round_no: 1, price_minor: 50000, role: 'BUYER', coach_recommended_minor: 52000 },
      { round_no: 2, price_minor: 55000, role: 'BUYER', coach_recommended_minor: 54000 },
    ];
    // |50000-52000| = 2000, |55000-54000| = 1000, avg = 1500
    expect(computeCoachDeviation(rounds)).toBe(1500);
  });

  it('returns 0 when no coach data', () => {
    const rounds: RoundSnapshot[] = [
      { round_no: 1, price_minor: 50000, role: 'BUYER' },
    ];
    expect(computeCoachDeviation(rounds)).toBe(0);
  });
});

// ── Value Range ────────────────────────────────────────────────

describe('toValueRange', () => {
  it('buckets prices correctly', () => {
    expect(toValueRange(3000)).toBe('$0-50');       // $30
    expect(toValueRange(7500)).toBe('$50-100');      // $75
    expect(toValueRange(15000)).toBe('$100-250');    // $150
    expect(toValueRange(40000)).toBe('$250-500');    // $400
    expect(toValueRange(80000)).toBe('$500-1000');   // $800
    expect(toValueRange(150000)).toBe('$1000-2500'); // $1500
    expect(toValueRange(350000)).toBe('$2500-5000'); // $3500
    expect(toValueRange(600000)).toBe('$5000+');     // $6000
  });
});

// ── Full Summarizer ────────────────────────────────────────────

describe('summarizeSession', () => {
  function makeInput(overrides: Partial<SummarizeInput> = {}): SummarizeInput {
    const rounds: RoundSnapshot[] = [
      { round_no: 1, price_minor: 60000, role: 'BUYER', tactic_used: 'anchoring' },
      { round_no: 2, price_minor: 85000, role: 'SELLER', tactic_used: 'reciprocal' },
      { round_no: 3, price_minor: 65000, role: 'BUYER', tactic_used: 'anchoring', coach_recommended_minor: 64000 },
      { round_no: 4, price_minor: 78000, role: 'SELLER' },
      { round_no: 5, price_minor: 70000, role: 'BUYER', coach_recommended_minor: 69000 },
      { round_no: 6, price_minor: 72000, role: 'SELLER' },
      { round_no: 7, price_minor: 72000, role: 'BUYER' },
    ];

    return {
      session_id: 'sess-001',
      category: 'electronics',
      status: 'ACCEPTED',
      initial_ask_minor: 90000, // $900
      rounds,
      created_at_ms: new Date('2026-04-12T10:00:00Z').getTime(),
      ended_at_ms: new Date('2026-04-12T10:47:00Z').getTime(),
      conditions_exchanged: ['charger_included', 'free_shipping'],
      ...overrides,
    };
  }

  it('produces a complete summary for a DEAL', () => {
    const summary = summarizeSession(makeInput());

    expect(summary.session_id).toBe('sess-001');
    expect(summary.category).toBe('electronics');
    expect(summary.outcome).toBe('DEAL');
    expect(summary.total_rounds).toBe(7);
    expect(summary.total_duration_minutes).toBe(47);
    expect(summary.final_price_minor).toBe(72000);
    expect(summary.item_value_range).toBe('$500-1000');
    expect(summary.conditions_exchanged).toEqual(['charger_included', 'free_shipping']);
  });

  it('computes discount rate correctly', () => {
    const summary = summarizeSession(makeInput());
    // (90000 - 72000) / 90000 = 0.2
    expect(summary.discount_rate).toBeCloseTo(0.2);
  });

  it('extracts unique tactics', () => {
    const summary = summarizeSession(makeInput());
    expect(summary.tactics_used).toContain('anchoring');
    expect(summary.tactics_used).toContain('reciprocal');
    expect(summary.tactics_used).toHaveLength(2);
  });

  it('tracks price trajectory', () => {
    const summary = summarizeSession(makeInput());
    expect(summary.price_trajectory).toEqual([60000, 85000, 65000, 78000, 70000, 72000, 72000]);
  });

  it('classifies buyer and seller patterns', () => {
    const summary = summarizeSession(makeInput());
    expect(['BOULWARE', 'LINEAR', 'CONCEDER']).toContain(summary.buyer_pattern);
    expect(['BOULWARE', 'LINEAR', 'CONCEDER']).toContain(summary.seller_pattern);
  });

  it('handles REJECT outcome with no final price', () => {
    const summary = summarizeSession(makeInput({ status: 'REJECTED' }));
    expect(summary.outcome).toBe('REJECT');
    expect(summary.final_price_minor).toBeUndefined();
    expect(summary.discount_rate).toBeUndefined();
  });

  it('handles TIMEOUT outcome', () => {
    const summary = summarizeSession(makeInput({ status: 'EXPIRED' }));
    expect(summary.outcome).toBe('TIMEOUT');
  });

  it('counts referee violations', () => {
    const rounds: RoundSnapshot[] = [
      { round_no: 1, price_minor: 60000, role: 'BUYER', violations: [{ rule: 'min_price', severity: 'HARD' }] },
      { round_no: 2, price_minor: 80000, role: 'SELLER', violations: [{ rule: 'rate_limit', severity: 'SOFT' }, { rule: 'max_concession', severity: 'SOFT' }] },
    ];
    const summary = summarizeSession(makeInput({ rounds }));
    expect(summary.referee_hard_violations).toBe(1);
    expect(summary.referee_soft_violations).toBe(2);
  });

  it('computes coach deviation', () => {
    const summary = summarizeSession(makeInput());
    // Round 3: |65000-64000| = 1000, Round 5: |70000-69000| = 1000, avg = 1000
    expect(summary.coach_vs_actual_avg_deviation).toBe(1000);
  });

  it('sets time context from created_at', () => {
    const summary = summarizeSession(makeInput());
    // 2026-04-12 10:00 UTC → Sunday(0), hour 10
    expect(summary.day_of_week).toBe(0); // Sunday
    expect(summary.hour_of_day).toBe(10);
  });

  it('handles empty rounds gracefully', () => {
    const summary = summarizeSession(makeInput({ rounds: [] }));
    expect(summary.total_rounds).toBe(0);
    expect(summary.price_trajectory).toEqual([]);
    expect(summary.tactics_used).toEqual([]);
    expect(summary.buyer_pattern).toBe('LINEAR');
    expect(summary.seller_pattern).toBe('LINEAR');
  });
});
