import { describe, expect, it } from 'vitest';
import { computeUtility, EngineError } from '../src/index.js';
import type { NegotiationContext } from '../src/index.js';

const TOL = 0.001;

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(TOL);
}

describe('Conformance Tests (Architecture Doc Section 24)', () => {
  it('Test 1: balanced buyer', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 200, p_target: 180, p_limit: 220 },
      time: { t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
      risk: { r_score: 0.85, i_completeness: 0.90, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 3, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
    };

    const result = computeUtility(ctx);
    expect(result.error).toBeUndefined();
    expectClose(result.v_p, 0.820);
    expectClose(result.v_t, 0.583);
    expectClose(result.v_r, 0.870);
    expectClose(result.v_s, 0.800);
    // Reference impl: u_total = 0.756935
    expectClose(result.u_total, 0.757);
  });

  it('Test 2: aggressive seller', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.70, w_t: 0.10, w_r: 0.15, w_s: 0.05 },
      price: { p_effective: 210, p_target: 220, p_limit: 180 },
      time: { t_elapsed: 7200, t_deadline: 604800, alpha: 3.0, v_t_floor: 0.0 },
      risk: { r_score: 0.70, i_completeness: 0.80, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 0, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
    };

    const result = computeUtility(ctx);
    expect(result.error).toBeUndefined();
    expectClose(result.v_p, 0.925);
    expectClose(result.v_t, 0.965);
    expectClose(result.v_r, 0.740);
    expectClose(result.v_s, 0.500);
    // Reference impl: u_total = 0.879770
    expectClose(result.u_total, 0.880);
  });

  it('Test 3: competition context', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 200, p_target: 180, p_limit: 220 },
      time: { t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
      risk: { r_score: 0.85, i_completeness: 0.90, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 3, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
      competition: { n_competitors: 4, best_alternative: 195, market_position: 0.7 },
      gamma: 0.1,
    };

    const result = computeUtility(ctx);
    expect(result.error).toBeUndefined();
    // v_p_adjusted = 0.820 * (1 + 0.1 * ln(5) * 0.7) = 0.912
    expectClose(result.v_p, 0.912);
    expectClose(result.v_t, 0.583);
    expectClose(result.v_r, 0.870);
    expectClose(result.v_s, 0.800);
    // Reference impl: u_total = 0.793880
    expectClose(result.u_total, 0.794);
  });

  it('Test 4: limit reached (buyer at p_limit)', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 1.0, w_t: 0.0, w_r: 0.0, w_s: 0.0 },
      price: { p_effective: 220, p_target: 180, p_limit: 220 },
      time: { t_elapsed: 0, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
      risk: { r_score: 0.5, i_completeness: 0.5, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 0, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
    };

    const result = computeUtility(ctx);
    expect(result.error).toBeUndefined();
    expect(result.v_p).toBe(0);
    expect(result.u_total).toBe(0);
  });

  it('Test 5: invalid weights (sum = 1.1)', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.5, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 200, p_target: 180, p_limit: 220 },
      time: { t_elapsed: 36000, t_deadline: 86400, alpha: 1.0, v_t_floor: 0.0 },
      risk: { r_score: 0.85, i_completeness: 0.90, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 3, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.5 },
    };

    const result = computeUtility(ctx);
    expect(result.error).toBe(EngineError.INVALID_WEIGHTS);
  });
});
