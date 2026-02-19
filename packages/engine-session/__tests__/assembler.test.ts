import { describe, it, expect } from 'vitest';
import { assembleContext } from '../src/strategy/assembler.js';
import type { MasterStrategy, RoundData } from '../src/strategy/types.js';
import type { NegotiationContext } from '@haggle/engine-core';

function makeStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat-1',
    user_id: 'user-1',
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    p_target: 80,
    p_limit: 120,
    alpha: 1.0,
    beta: 1.5,
    t_deadline: 3600,
    v_t_floor: 0.1,
    n_threshold: 5,
    v_s_base: 0.5,
    w_rep: 0.6,
    w_info: 0.4,
    u_threshold: 0.4,
    u_aspiration: 0.8,
    persona: 'balanced',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
    ...overrides,
  };
}

function makeRoundData(overrides?: Partial<RoundData>): RoundData {
  return {
    p_effective: 95,
    r_score: 0.8,
    i_completeness: 0.9,
    t_elapsed: 600,
    n_success: 3,
    n_dispute_losses: 0,
    ...overrides,
  };
}

describe('assembleContext', () => {
  it('maps strategy weights to context weights', () => {
    const strategy = makeStrategy();
    const rd = makeRoundData();
    const ctx = assembleContext(strategy, rd);

    expect(ctx.weights).toEqual(strategy.weights);
  });

  it('maps price context from strategy targets + round effective price', () => {
    const strategy = makeStrategy({ p_target: 80, p_limit: 120 });
    const rd = makeRoundData({ p_effective: 100 });
    const ctx = assembleContext(strategy, rd);

    expect(ctx.price).toEqual({
      p_effective: 100,
      p_target: 80,
      p_limit: 120,
    });
  });

  it('maps time context from strategy + round elapsed', () => {
    const strategy = makeStrategy({ t_deadline: 3600, alpha: 2.0, v_t_floor: 0.05 });
    const rd = makeRoundData({ t_elapsed: 1800 });
    const ctx = assembleContext(strategy, rd);

    expect(ctx.time).toEqual({
      t_elapsed: 1800,
      t_deadline: 3600,
      alpha: 2.0,
      v_t_floor: 0.05,
    });
  });

  it('maps risk context from strategy weights + round scores', () => {
    const strategy = makeStrategy({ w_rep: 0.7, w_info: 0.3 });
    const rd = makeRoundData({ r_score: 0.9, i_completeness: 0.85 });
    const ctx = assembleContext(strategy, rd);

    expect(ctx.risk).toEqual({
      r_score: 0.9,
      i_completeness: 0.85,
      w_rep: 0.7,
      w_info: 0.3,
    });
  });

  it('maps relationship context from strategy base + round history', () => {
    const strategy = makeStrategy({ n_threshold: 10, v_s_base: 0.6 });
    const rd = makeRoundData({ n_success: 5, n_dispute_losses: 1 });
    const ctx = assembleContext(strategy, rd);

    expect(ctx.relationship).toEqual({
      n_success: 5,
      n_dispute_losses: 1,
      n_threshold: 10,
      v_s_base: 0.6,
    });
  });

  it('passes competition context through when provided', () => {
    const rd = makeRoundData({
      competition: { n_competitors: 3, best_alternative: 90, market_position: 0.7 },
    });
    const ctx = assembleContext(makeStrategy(), rd);

    expect(ctx.competition).toEqual({
      n_competitors: 3,
      best_alternative: 90,
      market_position: 0.7,
    });
  });

  it('omits competition context when not provided', () => {
    const ctx = assembleContext(makeStrategy(), makeRoundData());
    expect(ctx.competition).toBeUndefined();
  });

  it('passes gamma through from strategy', () => {
    const ctx = assembleContext(makeStrategy({ gamma: 0.5 }), makeRoundData());
    expect(ctx.gamma).toBe(0.5);
  });

  it('omits gamma when not in strategy', () => {
    const ctx = assembleContext(makeStrategy(), makeRoundData());
    expect(ctx.gamma).toBeUndefined();
  });

  it('produces a valid NegotiationContext shape', () => {
    const ctx = assembleContext(makeStrategy(), makeRoundData());

    // All required fields present
    expect(ctx).toHaveProperty('weights');
    expect(ctx).toHaveProperty('price');
    expect(ctx).toHaveProperty('time');
    expect(ctx).toHaveProperty('risk');
    expect(ctx).toHaveProperty('relationship');
  });
});
