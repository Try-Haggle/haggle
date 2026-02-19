import { describe, expect, it } from 'vitest';
import { computeVr } from '../src/utility/v-risk.js';

describe('computeVr', () => {
  it('computes weighted average correctly', () => {
    // Test 1: 0.6*0.85 + 0.4*0.90 = 0.510 + 0.360 = 0.870
    expect(computeVr({ r_score: 0.85, i_completeness: 0.90, w_rep: 0.6, w_info: 0.4 })).toBeCloseTo(0.87, 3);
  });

  it('computes for test 2 seller', () => {
    // 0.6*0.70 + 0.4*0.80 = 0.420 + 0.320 = 0.740
    expect(computeVr({ r_score: 0.70, i_completeness: 0.80, w_rep: 0.6, w_info: 0.4 })).toBeCloseTo(0.74, 3);
  });

  it('returns 0 when both inputs are 0', () => {
    expect(computeVr({ r_score: 0, i_completeness: 0, w_rep: 0.6, w_info: 0.4 })).toBe(0);
  });

  it('returns 1 when both inputs are 1', () => {
    expect(computeVr({ r_score: 1.0, i_completeness: 1.0, w_rep: 0.6, w_info: 0.4 })).toBe(1.0);
  });

  it('preserves reputation value (gold seller with sparse listing)', () => {
    // Gold seller (0.95) with sparse listing (0.30): 0.6*0.95 + 0.4*0.30 = 0.69
    const vr = computeVr({ r_score: 0.95, i_completeness: 0.30, w_rep: 0.6, w_info: 0.4 });
    expect(vr).toBeCloseTo(0.69, 3);
  });
});
