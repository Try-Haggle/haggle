import { describe, expect, it } from 'vitest';
import { computeVs } from '../src/utility/v-relationship.js';

describe('computeVs', () => {
  it('returns v_s_base for first-time (n_success=0, no disputes)', () => {
    expect(computeVs({ n_success: 0, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 })).toBe(0.5);
  });

  it('returns 0.8 for 3 successes out of 10 threshold', () => {
    // 0.5 + 3/10 + 0 = 0.8
    expect(computeVs({ n_success: 3, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 })).toBeCloseTo(0.8, 3);
  });

  it('clamps to 1.0 when exceeding max', () => {
    // 0.5 + 10/10 + 0 = 1.5 → clamped to 1.0
    expect(computeVs({ n_success: 10, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 })).toBe(1.0);
  });

  it('applies dispute penalty', () => {
    // 0.5 + 3/10 + 1*(-0.3) = 0.5 + 0.3 - 0.3 = 0.5
    expect(computeVs({ n_success: 3, n_dispute_losses: 1, n_threshold: 10, v_s_base: 0.5 })).toBeCloseTo(0.5, 3);
  });

  it('clamps to 0 when disputes exceed all', () => {
    // 0.5 + 0/10 + 3*(-0.3) = 0.5 - 0.9 = -0.4 → clamped to 0
    expect(computeVs({ n_success: 0, n_dispute_losses: 3, n_threshold: 10, v_s_base: 0.5 })).toBe(0);
  });

  it('first-time + 1 dispute = risk signal', () => {
    // 0.5 + 0/10 + 1*(-0.3) = 0.2
    expect(computeVs({ n_success: 0, n_dispute_losses: 1, n_threshold: 10, v_s_base: 0.5 })).toBeCloseTo(0.2, 3);
  });

  it('disputes offset successes', () => {
    // 0.5 + 3/10 + 2*(-0.3) = 0.5 + 0.3 - 0.6 = 0.2
    expect(computeVs({ n_success: 3, n_dispute_losses: 2, n_threshold: 10, v_s_base: 0.5 })).toBeCloseTo(0.2, 3);
  });
});
