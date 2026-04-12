/**
 * Step 39 — Hold + pipeline integration tests.
 * End-to-end flows: assembleContext with hold → computeUtility → executeRound.
 */
import { describe, it, expect } from 'vitest';
import { assembleContext } from '../src/strategy/assembler.js';
import { executeRound } from '../src/round/executor.js';
import { handleHoldExpired } from '../src/round/hold-expired.js';
import { transition } from '../src/session/state-machine.js';
import type { MasterStrategy, RoundData } from '../src/strategy/types.js';
import type { NegotiationSession } from '../src/session/types.js';
import type { HnpMessage } from '../src/protocol/types.js';
import type { HoldContext } from '@haggle/engine-core';

function makeStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat-1', user_id: 'user-1',
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    p_target: 30, p_limit: 100, alpha: 1.0, beta: 1.0,
    t_deadline: 120, v_t_floor: 0.05, n_threshold: 10, v_s_base: 0.3,
    w_rep: 0.6, w_info: 0.4, u_threshold: 0.4, u_aspiration: 0.8,
    persona: 'balanced', gamma: 0.1,
    created_at: Date.now(), expires_at: Date.now() + 86400000,
    ...overrides,
  };
}

function makeSession(overrides?: Partial<NegotiationSession>): NegotiationSession {
  return {
    session_id: 'sess-1', strategy_id: 'strat-1', role: 'BUYER',
    status: 'ACTIVE', counterparty_id: 'seller-1', rounds: [],
    current_round: 1, rounds_no_concession: 0,
    last_offer_price: 60, last_utility: null,
    created_at: Date.now(), updated_at: Date.now(),
    ...overrides,
  };
}

function makeRoundData(overrides?: Partial<RoundData>): RoundData {
  return {
    p_effective: 55, r_score: 0.8, i_completeness: 0.9,
    t_elapsed: 30, n_success: 5, n_dispute_losses: 0,
    ...overrides,
  };
}

function makeOffer(): HnpMessage {
  return {
    type: 'COUNTER', role: 'SELLER', round: 1,
    payload: { price_minor: 5500, currency: 'USD' },
    timestamp: Date.now(),
  };
}

describe('hold integration: assembleContext → computeUtility', () => {
  it('hold is passed through to NegotiationContext', () => {
    const hold: HoldContext = {
      is_held: true, hold_kind: 'SOFT_HOLD',
      held_price_minor: 5000, hold_remaining_ms: 10000,
      hold_total_ms: 60000, resume_reprice_required: false,
    };
    const ctx = assembleContext(makeStrategy(), makeRoundData({ hold }));
    expect(ctx.hold).toEqual(hold);
    expect(ctx.hold?.is_held).toBe(true);
  });

  it('executeRound works with hold in roundData', () => {
    const hold: HoldContext = {
      is_held: true, hold_kind: 'SOFT_HOLD',
      held_price_minor: 5500, hold_remaining_ms: 5000,
      hold_total_ms: 60000, resume_reprice_required: false,
    };
    const result = executeRound(
      makeSession(), makeStrategy(),
      makeOffer(), makeRoundData({ hold }),
    );
    expect(result.utility).toBeDefined();
    expect(result.decision).toBeDefined();
    expect(result.session.status).toBeDefined();
  });
});

describe('hold expiration → session lifecycle', () => {
  it('hold expired on ACTIVE session → stays ACTIVE, requires reprice for SOFT_HOLD', () => {
    const session = makeSession({ status: 'ACTIVE' });
    const result = handleHoldExpired(session, {
      hold_kind: 'SOFT_HOLD', held_price_minor: 5500, expired_at: Date.now(),
    });
    expect(result.session.status).toBe('ACTIVE');
    expect(result.reprice_required).toBe(true);
    expect(result.previous_hold_price_minor).toBe(5500);
  });

  it('hold expired on NEAR_DEAL → reverts to ACTIVE', () => {
    const session = makeSession({ status: 'NEAR_DEAL' });
    const result = handleHoldExpired(session, {
      hold_kind: 'SELLER_RESERVED', held_price_minor: 9900, expired_at: Date.now(),
    });
    expect(result.session.status).toBe('ACTIVE');
    expect(result.reprice_required).toBe(false);
  });

  it('hold expired then regular round can continue', () => {
    const session = makeSession({ status: 'NEAR_DEAL' });
    const expired = handleHoldExpired(session, {
      hold_kind: 'SOFT_HOLD', held_price_minor: 5500, expired_at: Date.now(),
    });
    // After hold expiry, session is ACTIVE — can receive counter
    const nextStatus = transition(expired.session.status, 'counter');
    expect(nextStatus).toBe('ACTIVE');
  });

  it('terminal session ignores hold expiration', () => {
    const session = makeSession({ status: 'ACCEPTED' });
    const result = handleHoldExpired(session, {
      hold_kind: 'SOFT_HOLD', held_price_minor: 5500, expired_at: Date.now(),
    });
    expect(result.session.status).toBe('ACCEPTED');
    expect(result.reprice_required).toBe(false);
  });
});

describe('term_space + hold combined in executeRound', () => {
  it('strategy with term_space flows through executeRound', () => {
    const strategy = makeStrategy({
      term_space: {
        terms: [{
          id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 1.0,
          domain: { min: 0, max: 10000, direction: 'lower_is_better' },
        }],
        current_values: { price: 5500 },
      },
    });
    const result = executeRound(
      makeSession(), strategy, makeOffer(), makeRoundData(),
    );
    expect(result.utility).toBeDefined();
    expect(result.decision).toBeDefined();
    // When term_space is present, u_total comes from multi-term path
    expect(result.utility.u_total).toBeGreaterThan(0);
  });
});
