import { describe, it, expect } from 'vitest';
import { assembleContext } from '../src/strategy/assembler.js';
import type { MasterStrategy, RoundData } from '../src/strategy/types.js';
import type { TermSpace, HoldContext } from '@haggle/engine-core';

function makeStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat-1',
    user_id: 'user-1',
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    p_target: 30,
    p_limit: 100,
    alpha: 1.0,
    beta: 1.0,
    t_deadline: 120,
    v_t_floor: 0.05,
    n_threshold: 10,
    v_s_base: 0.3,
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
    p_effective: 50,
    r_score: 0.8,
    i_completeness: 0.9,
    t_elapsed: 30,
    n_success: 5,
    n_dispute_losses: 0,
    ...overrides,
  };
}

describe('assembleContext with term_space', () => {
  it('passes through term_space from strategy', () => {
    const termSpace: TermSpace = {
      terms: [{
        id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 1.0,
        domain: { min: 0, max: 100, direction: 'lower_is_better' },
      }],
      current_values: { price: 50 },
    };
    const ctx = assembleContext(
      makeStrategy({ term_space: termSpace }),
      makeRoundData(),
    );
    expect(ctx.term_space).toBe(termSpace);
  });

  it('term_space is undefined when not set on strategy', () => {
    const ctx = assembleContext(makeStrategy(), makeRoundData());
    expect(ctx.term_space).toBeUndefined();
  });
});

describe('assembleContext with hold', () => {
  it('passes through hold from roundData', () => {
    const hold: HoldContext = {
      is_held: true,
      hold_kind: 'SOFT_HOLD',
      held_price_minor: 5000,
      hold_remaining_ms: 30000,
      hold_total_ms: 60000,
      resume_reprice_required: false,
    };
    const ctx = assembleContext(makeStrategy(), makeRoundData({ hold }));
    expect(ctx.hold).toBe(hold);
  });

  it('hold is undefined when not set on roundData', () => {
    const ctx = assembleContext(makeStrategy(), makeRoundData());
    expect(ctx.hold).toBeUndefined();
  });

  it('both term_space and hold can be set simultaneously', () => {
    const termSpace: TermSpace = {
      terms: [{
        id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 1.0,
        domain: { min: 0, max: 100, direction: 'lower_is_better' },
      }],
      current_values: { price: 50 },
    };
    const hold: HoldContext = {
      is_held: true,
      hold_kind: 'SELLER_RESERVED',
      held_price_minor: 9900,
      hold_remaining_ms: 120000,
      hold_total_ms: 120000,
      resume_reprice_required: false,
    };
    const ctx = assembleContext(
      makeStrategy({ term_space: termSpace }),
      makeRoundData({ hold }),
    );
    expect(ctx.term_space).toBe(termSpace);
    expect(ctx.hold).toBe(hold);
  });
});
