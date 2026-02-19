import { describe, it, expect } from 'vitest';
import { executeRound } from '../src/round/executor.js';
import type { MasterStrategy, RoundData } from '../src/strategy/types.js';
import type { NegotiationSession } from '../src/session/types.js';
import type { HnpMessage } from '../src/protocol/types.js';

/**
 * Integration test: simulate a multi-round buyer negotiation.
 *
 * Scenario: Buyer wants to buy at $80 (target), willing to pay up to $120 (limit).
 * Seller starts at $130, gradually comes down.
 * Expected flow: CREATED → ACTIVE → ... → ACCEPTED or NEAR_DEAL
 */

function makeBuyerStrategy(): MasterStrategy {
  return {
    id: 'strat-buyer',
    user_id: 'buyer-1',
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
    u_aspiration: 0.7,
    persona: 'balanced',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
  };
}

function makeInitialSession(): NegotiationSession {
  return {
    session_id: 'int-sess-1',
    strategy_id: 'strat-buyer',
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
  };
}

function makeSellerOffer(price: number, round: number): HnpMessage {
  return {
    session_id: 'int-sess-1',
    round,
    type: round === 1 ? 'OFFER' : 'COUNTER',
    price,
    sender_role: 'SELLER',
    timestamp: Date.now(),
  };
}

function roundData(price: number, elapsed: number): RoundData {
  return {
    p_effective: price,
    r_score: 0.8,
    i_completeness: 0.9,
    t_elapsed: elapsed,
    n_success: 2,
    n_dispute_losses: 0,
  };
}

describe('integration: multi-round buyer negotiation', () => {
  it('progresses CREATED → ACTIVE on first offer', () => {
    const strategy = makeBuyerStrategy();
    let session = makeInitialSession();

    const r1 = executeRound(session, strategy, makeSellerOffer(130, 1), roundData(130, 60));
    session = r1.session;

    expect(session.status).toBe('ACTIVE');
    expect(session.current_round).toBe(1);
    expect(r1.utility.u_total).toBeGreaterThanOrEqual(0);
  });

  it('simulates 5-round negotiation with seller concessions', () => {
    const strategy = makeBuyerStrategy();
    let session = makeInitialSession();

    // Seller prices: 130 → 120 → 105 → 95 → 85 (progressively approaching buyer target)
    const sellerPrices = [130, 120, 105, 95, 85];
    const elapsed = [60, 300, 600, 900, 1200];

    const results = [];

    for (let i = 0; i < sellerPrices.length; i++) {
      const offer = makeSellerOffer(sellerPrices[i], i + 1);
      const rd = roundData(sellerPrices[i], elapsed[i]);
      const result = executeRound(session, strategy, offer, rd);
      results.push(result);
      session = result.session;

      // If accepted, stop
      if (result.decision === 'ACCEPT') break;
    }

    // Session should have advanced past CREATED
    expect(session.status).not.toBe('CREATED');
    // Should have recorded rounds
    expect(session.rounds.length).toBeGreaterThan(0);
    expect(session.rounds.length).toBeLessThanOrEqual(5);
    // Round numbers are sequential
    for (let i = 0; i < session.rounds.length; i++) {
      expect(session.rounds[i].round_no).toBe(i + 1);
    }
  });

  it('detects no concession and increments counter', () => {
    const strategy = makeBuyerStrategy();
    let session = makeInitialSession();

    // Round 1: first offer
    const r1 = executeRound(session, strategy, makeSellerOffer(110, 1), roundData(110, 60));
    session = r1.session;
    expect(session.rounds_no_concession).toBe(0); // first round has no prev

    // Round 2: same price → no concession
    const r2 = executeRound(session, strategy, makeSellerOffer(110, 2), roundData(110, 300));
    session = r2.session;
    expect(session.rounds_no_concession).toBe(1);

    // Round 3: same price → no concession continues
    const r3 = executeRound(session, strategy, makeSellerOffer(110, 3), roundData(110, 600));
    session = r3.session;
    expect(session.rounds_no_concession).toBeGreaterThanOrEqual(2);
  });

  it('resets concession counter on price movement', () => {
    const strategy = makeBuyerStrategy();
    let session = makeInitialSession();

    // Round 1
    const r1 = executeRound(session, strategy, makeSellerOffer(110, 1), roundData(110, 60));
    session = r1.session;

    // Round 2: same price
    const r2 = executeRound(session, strategy, makeSellerOffer(110, 2), roundData(110, 300));
    session = r2.session;
    expect(session.rounds_no_concession).toBe(1);

    // Round 3: seller concedes (lowers price)
    const r3 = executeRound(session, strategy, makeSellerOffer(105, 3), roundData(105, 600));
    session = r3.session;
    expect(session.rounds_no_concession).toBe(0);
  });

  it('produces immutable session chain (each round returns new session)', () => {
    const strategy = makeBuyerStrategy();
    const session1 = makeInitialSession();

    const r1 = executeRound(session1, strategy, makeSellerOffer(120, 1), roundData(120, 60));
    const session2 = r1.session;

    const r2 = executeRound(session2, strategy, makeSellerOffer(110, 2), roundData(110, 300));
    const session3 = r2.session;

    // All sessions are different objects
    expect(session1).not.toBe(session2);
    expect(session2).not.toBe(session3);

    // Original session is untouched
    expect(session1.rounds).toHaveLength(0);
    expect(session1.current_round).toBe(0);
    expect(session1.status).toBe('CREATED');

    // Session chain grows correctly
    expect(session2.rounds).toHaveLength(1);
    expect(session3.rounds).toHaveLength(2);
  });

  it('session is JSON-serializable', () => {
    const strategy = makeBuyerStrategy();
    let session = makeInitialSession();

    const r1 = executeRound(session, strategy, makeSellerOffer(100, 1), roundData(100, 60));
    session = r1.session;

    const json = JSON.stringify(session);
    const restored = JSON.parse(json) as NegotiationSession;

    expect(restored.session_id).toBe(session.session_id);
    expect(restored.status).toBe(session.status);
    expect(restored.rounds).toHaveLength(session.rounds.length);
    expect(restored.current_round).toBe(session.current_round);
  });
});
