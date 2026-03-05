import { describe, it, expect } from 'vitest';
import { validateStrategy, validateRoundData } from '../src/strategy/validation.js';
import { SessionError } from '../src/errors/types.js';
import type { MasterStrategy, RoundData } from '../src/strategy/types.js';

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
    created_at: 1000000,
    expires_at: 1000000 + 86400000,
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

describe('validateStrategy', () => {
  it('returns null for a valid strategy', () => {
    expect(validateStrategy(makeStrategy())).toBeNull();
  });

  it('rejects weights that do not sum to 1.0', () => {
    const s = makeStrategy({ weights: { w_p: 0.5, w_t: 0.5, w_r: 0.5, w_s: 0.5 } });
    expect(validateStrategy(s)).toBe(SessionError.INVALID_STRATEGY);
  });

  it('accepts weights within tolerance of 1.0', () => {
    const s = makeStrategy({ weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2000000001 } });
    expect(validateStrategy(s)).toBeNull();
  });

  it('rejects p_target <= 0', () => {
    expect(validateStrategy(makeStrategy({ p_target: 0 }))).toBe(SessionError.INVALID_STRATEGY);
    expect(validateStrategy(makeStrategy({ p_target: -10 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects p_limit <= 0', () => {
    expect(validateStrategy(makeStrategy({ p_limit: 0 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects t_deadline <= 0', () => {
    expect(validateStrategy(makeStrategy({ t_deadline: 0 }))).toBe(SessionError.INVALID_STRATEGY);
    expect(validateStrategy(makeStrategy({ t_deadline: -1 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects alpha <= 0', () => {
    expect(validateStrategy(makeStrategy({ alpha: 0 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects beta <= 0', () => {
    expect(validateStrategy(makeStrategy({ beta: -0.5 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects u_threshold outside [0,1]', () => {
    expect(validateStrategy(makeStrategy({ u_threshold: -0.1 }))).toBe(SessionError.INVALID_STRATEGY);
    expect(validateStrategy(makeStrategy({ u_threshold: 1.1 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects u_aspiration outside [0,1]', () => {
    expect(validateStrategy(makeStrategy({ u_aspiration: -0.1 }))).toBe(SessionError.INVALID_STRATEGY);
    expect(validateStrategy(makeStrategy({ u_aspiration: 1.5 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('rejects u_aspiration < u_threshold', () => {
    expect(validateStrategy(makeStrategy({ u_threshold: 0.8, u_aspiration: 0.3 }))).toBe(SessionError.INVALID_STRATEGY);
  });

  it('accepts u_aspiration == u_threshold', () => {
    expect(validateStrategy(makeStrategy({ u_threshold: 0.5, u_aspiration: 0.5 }))).toBeNull();
  });

  it('rejects expires_at <= created_at', () => {
    expect(validateStrategy(makeStrategy({ created_at: 1000, expires_at: 1000 }))).toBe(SessionError.INVALID_STRATEGY);
    expect(validateStrategy(makeStrategy({ created_at: 2000, expires_at: 1000 }))).toBe(SessionError.INVALID_STRATEGY);
  });
});

describe('validateRoundData', () => {
  it('returns null for valid round data', () => {
    expect(validateRoundData(makeRoundData())).toBeNull();
  });

  it('rejects p_effective <= 0', () => {
    expect(validateRoundData(makeRoundData({ p_effective: 0 }))).toBe(SessionError.INVALID_ROUND_DATA);
    expect(validateRoundData(makeRoundData({ p_effective: -5 }))).toBe(SessionError.INVALID_ROUND_DATA);
  });

  it('rejects r_score outside [0,1]', () => {
    expect(validateRoundData(makeRoundData({ r_score: -0.1 }))).toBe(SessionError.INVALID_ROUND_DATA);
    expect(validateRoundData(makeRoundData({ r_score: 1.1 }))).toBe(SessionError.INVALID_ROUND_DATA);
  });

  it('rejects i_completeness outside [0,1]', () => {
    expect(validateRoundData(makeRoundData({ i_completeness: -0.1 }))).toBe(SessionError.INVALID_ROUND_DATA);
    expect(validateRoundData(makeRoundData({ i_completeness: 1.5 }))).toBe(SessionError.INVALID_ROUND_DATA);
  });

  it('rejects t_elapsed < 0', () => {
    expect(validateRoundData(makeRoundData({ t_elapsed: -1 }))).toBe(SessionError.INVALID_ROUND_DATA);
  });

  it('accepts t_elapsed == 0', () => {
    expect(validateRoundData(makeRoundData({ t_elapsed: 0 }))).toBeNull();
  });

  it('rejects n_success < 0', () => {
    expect(validateRoundData(makeRoundData({ n_success: -1 }))).toBe(SessionError.INVALID_ROUND_DATA);
  });

  it('rejects n_dispute_losses < 0', () => {
    expect(validateRoundData(makeRoundData({ n_dispute_losses: -1 }))).toBe(SessionError.INVALID_ROUND_DATA);
  });
});
