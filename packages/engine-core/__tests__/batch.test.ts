import { describe, expect, it } from 'vitest';
import { batchEvaluate } from '../src/batch/evaluator.js';
import { compareSessions } from '../src/batch/comparator.js';
import type { BatchEvaluateRequest, SessionSnapshot } from '../src/batch/types.js';
import type { UtilityResult } from '../src/types.js';

describe('batchEvaluate', () => {
  const baseStrategy = {
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    p_target: 180,
    p_limit: 220,
    time: { t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
    n_threshold: 10,
  };

  it('evaluates and ranks listings by u_total descending', () => {
    const request: BatchEvaluateRequest = {
      strategy: baseStrategy,
      listings: [
        { listing_id: 'A', p_effective: 210, r_score: 0.7, i_completeness: 0.7 },
        { listing_id: 'B', p_effective: 190, r_score: 0.9, i_completeness: 0.95 },
        { listing_id: 'C', p_effective: 200, r_score: 0.85, i_completeness: 0.9 },
      ],
    };

    const result = batchEvaluate(request);
    expect(result.evaluated).toBe(3);
    expect(result.errors).toBe(0);
    expect(result.rankings[0].rank).toBe(1);
    expect(result.rankings[1].rank).toBe(2);
    expect(result.rankings[2].rank).toBe(3);
    // B (cheapest, best reputation) should rank highest
    expect(result.rankings[0].listing_id).toBe('B');
    // Verify descending order
    expect(result.rankings[0].u_total).toBeGreaterThanOrEqual(result.rankings[1].u_total);
    expect(result.rankings[1].u_total).toBeGreaterThanOrEqual(result.rankings[2].u_total);
  });

  it('handles 200 listings within reasonable time', () => {
    const listings = Array.from({ length: 200 }, (_, i) => ({
      listing_id: `L${i}`,
      p_effective: 190 + (i % 30),
      r_score: 0.5 + (i % 50) / 100,
      i_completeness: 0.6 + (i % 40) / 100,
    }));

    const start = performance.now();
    const result = batchEvaluate({ strategy: baseStrategy, listings });
    const elapsed = performance.now() - start;

    expect(result.evaluated).toBe(200);
    expect(result.errors).toBe(0);
    expect(elapsed).toBeLessThan(50); // < 50ms
    // Verify ranking integrity
    for (let i = 0; i < result.rankings.length - 1; i++) {
      expect(result.rankings[i].u_total).toBeGreaterThanOrEqual(result.rankings[i + 1].u_total);
      expect(result.rankings[i].rank).toBe(i + 1);
    }
  });

  it('skips listings that cause errors', () => {
    const request: BatchEvaluateRequest = {
      strategy: { ...baseStrategy, p_target: 220, p_limit: 220 }, // ZERO_PRICE_RANGE
      listings: [
        { listing_id: 'A', p_effective: 200, r_score: 0.7, i_completeness: 0.7 },
      ],
    };

    const result = batchEvaluate(request);
    expect(result.evaluated).toBe(0);
    expect(result.errors).toBe(1);
  });

  it('uses default values for optional listing fields', () => {
    const request: BatchEvaluateRequest = {
      strategy: baseStrategy,
      listings: [
        { listing_id: 'A', p_effective: 200, r_score: 0.8, i_completeness: 0.9 },
      ],
    };

    const result = batchEvaluate(request);
    expect(result.evaluated).toBe(1);
    expect(result.errors).toBe(0);
  });
});

describe('compareSessions', () => {
  function makeSnapshot(id: string, u_total: number, u_threshold = 0.6, u_aspiration = 0.85): SessionSnapshot {
    return {
      session_id: id,
      utility: { u_total, v_p: 0, v_t: 0.5, v_r: 0, v_s: 0 } as UtilityResult,
      thresholds: { u_threshold, u_aspiration },
    };
  }

  it('ranks sessions by u_total descending', () => {
    const sessions = [makeSnapshot('S1', 0.6), makeSnapshot('S2', 0.9), makeSnapshot('S3', 0.75)];
    const result = compareSessions(sessions);
    expect(result.rankings[0].session_id).toBe('S2');
    expect(result.rankings[1].session_id).toBe('S3');
    expect(result.rankings[2].session_id).toBe('S1');
  });

  it('computes BATNA as 2nd best u_total', () => {
    const sessions = [makeSnapshot('S1', 0.9), makeSnapshot('S2', 0.7), makeSnapshot('S3', 0.5)];
    const result = compareSessions(sessions);
    expect(result.batna).toBe(0.7);
  });

  it('batna is undefined for single session', () => {
    const result = compareSessions([makeSnapshot('S1', 0.8)]);
    expect(result.batna).toBeUndefined();
  });

  it('recommends ACCEPT_BEST when best >= aspiration', () => {
    const result = compareSessions([makeSnapshot('S1', 0.9, 0.6, 0.85)]);
    expect(result.recommended_action).toBe('ACCEPT_BEST');
  });

  it('recommends CONTINUE when best >= threshold but < aspiration', () => {
    const result = compareSessions([makeSnapshot('S1', 0.7, 0.6, 0.85)]);
    expect(result.recommended_action).toBe('CONTINUE');
  });

  it('recommends ESCALATE when best < threshold', () => {
    const result = compareSessions([makeSnapshot('S1', 0.4, 0.6, 0.85)]);
    expect(result.recommended_action).toBe('ESCALATE');
  });

  it('handles empty sessions', () => {
    const result = compareSessions([]);
    expect(result.rankings).toHaveLength(0);
    expect(result.recommended_action).toBe('ESCALATE');
  });
});
