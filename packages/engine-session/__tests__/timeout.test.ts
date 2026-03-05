import { describe, it, expect } from 'vitest';
import { checkTimeout } from '../src/session/timeout.js';
import type { NegotiationSession } from '../src/session/types.js';
import type { MasterStrategy } from '../src/strategy/types.js';

function makeSession(overrides?: Partial<NegotiationSession>): NegotiationSession {
  return {
    session_id: 'sess-timeout-1',
    strategy_id: 'strat-1',
    role: 'BUYER',
    status: 'ACTIVE',
    counterparty_id: 'seller-1',
    rounds: [],
    current_round: 1,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: 1000000,
    updated_at: 1000000,
    ...overrides,
  };
}

function makeStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat-1',
    user_id: 'user-1',
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    p_target: 80,
    p_limit: 120,
    alpha: 1.0,
    beta: 1.5,
    t_deadline: 3600, // 3600 seconds
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

describe('checkTimeout', () => {
  it('returns false when within deadline', () => {
    const session = makeSession({ created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    // 1000 seconds elapsed, deadline is 3600s
    const now = 1000000 + 1000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(false);
  });

  it('returns true when exactly at deadline', () => {
    const session = makeSession({ created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    // exactly 3600 seconds elapsed
    const now = 1000000 + 3600 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(true);
  });

  it('returns true when past deadline', () => {
    const session = makeSession({ created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    const now = 1000000 + 5000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(true);
  });

  it('returns false for ACCEPTED session even if past deadline', () => {
    const session = makeSession({ status: 'ACCEPTED', created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    const now = 1000000 + 5000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(false);
  });

  it('returns false for REJECTED session even if past deadline', () => {
    const session = makeSession({ status: 'REJECTED', created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    const now = 1000000 + 5000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(false);
  });

  it('returns false for EXPIRED session', () => {
    const session = makeSession({ status: 'EXPIRED', created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    const now = 1000000 + 5000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(false);
  });

  it('returns false for SUPERSEDED session', () => {
    const session = makeSession({ status: 'SUPERSEDED', created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    const now = 1000000 + 5000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(false);
  });

  it('returns true for STALLED session past deadline', () => {
    const session = makeSession({ status: 'STALLED', created_at: 1000000 });
    const strategy = makeStrategy({ t_deadline: 3600 });
    const now = 1000000 + 4000 * 1000;
    expect(checkTimeout(session, strategy, now)).toBe(true);
  });
});
