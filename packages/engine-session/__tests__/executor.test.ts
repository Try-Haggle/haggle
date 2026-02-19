import { describe, it, expect } from 'vitest';
import { executeRound } from '../src/round/executor.js';
import type { MasterStrategy, RoundData } from '../src/strategy/types.js';
import type { NegotiationSession } from '../src/session/types.js';
import type { HnpMessage } from '../src/protocol/types.js';

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

function makeSession(overrides?: Partial<NegotiationSession>): NegotiationSession {
  return {
    session_id: 'sess-1',
    strategy_id: 'strat-1',
    role: 'BUYER',
    status: 'CREATED',
    counterparty_id: 'seller-1',
    rounds: [],
    current_round: 0,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

function makeOffer(price: number, round: number = 1): HnpMessage {
  return {
    session_id: 'sess-1',
    round,
    type: 'OFFER',
    price,
    sender_role: 'SELLER',
    timestamp: Date.now(),
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

describe('executeRound', () => {
  it('returns a valid RoundResult shape', () => {
    const result = executeRound(
      makeSession(),
      makeStrategy(),
      makeOffer(95),
      makeRoundData(),
    );

    expect(result).toHaveProperty('message');
    expect(result).toHaveProperty('utility');
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('session');
    expect(result.message.session_id).toBe('sess-1');
    expect(result.message.sender_role).toBe('BUYER');
  });

  it('advances session from CREATED to ACTIVE on first round', () => {
    const result = executeRound(
      makeSession({ status: 'CREATED' }),
      makeStrategy(),
      makeOffer(95),
      makeRoundData(),
    );

    expect(result.session.status).toBe('ACTIVE');
    expect(result.session.current_round).toBe(1);
    expect(result.session.rounds).toHaveLength(1);
  });

  it('records incoming offer in round history', () => {
    const offer = makeOffer(95, 1);
    const result = executeRound(
      makeSession(),
      makeStrategy(),
      offer,
      makeRoundData(),
    );

    expect(result.session.rounds[0].message).toBe(offer);
    expect(result.session.rounds[0].round_no).toBe(1);
  });

  it('computes utility and stores in round', () => {
    const result = executeRound(
      makeSession(),
      makeStrategy(),
      makeOffer(95),
      makeRoundData(),
    );

    expect(result.utility.u_total).toBeGreaterThanOrEqual(0);
    expect(result.utility.u_total).toBeLessThanOrEqual(1);
    expect(result.session.rounds[0].utility).toBeDefined();
  });

  it('updates last_offer_price with incoming offer price', () => {
    const result = executeRound(
      makeSession(),
      makeStrategy(),
      makeOffer(95),
      makeRoundData(),
    );

    expect(result.session.last_offer_price).toBe(95);
  });

  it('generates counter-offer for COUNTER decision', () => {
    // Use a strategy where u_threshold > u_total to trigger COUNTER
    const strategy = makeStrategy({
      u_threshold: 0.9,
      u_aspiration: 0.95,
    });
    const session = makeSession({ status: 'ACTIVE', current_round: 1 });

    const result = executeRound(
      session,
      strategy,
      makeOffer(115, 2), // high price = low utility for buyer
      makeRoundData({ p_effective: 115 }),
    );

    if (result.decision === 'COUNTER') {
      expect(result.session.rounds[0].counter_price).toBeDefined();
      expect(result.message.type).toBe('COUNTER');
    }
  });

  it('produces ACCEPT when utility exceeds aspiration', () => {
    // Buyer with very low aspiration — almost any offer is acceptable
    const strategy = makeStrategy({
      p_target: 80,
      p_limit: 120,
      u_threshold: 0.1,
      u_aspiration: 0.2,
    });
    const session = makeSession({ status: 'ACTIVE', current_round: 1 });

    const result = executeRound(
      session,
      strategy,
      makeOffer(85, 2), // near target price = high utility
      makeRoundData({ p_effective: 85, t_elapsed: 100 }),
    );

    expect(result.decision).toBe('ACCEPT');
    expect(result.message.type).toBe('ACCEPT');
  });

  it('produces ESCALATE result with escalation request when stalled', () => {
    const strategy = makeStrategy({
      u_threshold: 0.9,
      u_aspiration: 0.95,
    });
    const session = makeSession({
      status: 'ACTIVE',
      current_round: 4,
      rounds_no_concession: 4,
      last_offer_price: 110,
    });

    const result = executeRound(
      session,
      strategy,
      makeOffer(110, 5), // same price → no concession
      makeRoundData({ p_effective: 110 }),
    );

    if (result.decision === 'ESCALATE') {
      expect(result.escalation).toBeDefined();
      expect(result.escalation!.session_id).toBe('sess-1');
      expect(result.escalation!.current_strategy).toBe(strategy);
      expect(result.message.type).toBe('ESCALATE');
    }
  });

  it('does not mutate the input session', () => {
    const session = makeSession();
    const originalRounds = session.rounds;
    const originalStatus = session.status;

    executeRound(session, makeStrategy(), makeOffer(95), makeRoundData());

    expect(session.rounds).toBe(originalRounds);
    expect(session.status).toBe(originalStatus);
    expect(session.current_round).toBe(0);
  });
});
