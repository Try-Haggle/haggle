import { describe, it, expect } from 'vitest';
import { handleHoldExpired } from '../src/round/hold-expired.js';
import type { HoldSnapshot } from '../src/round/hold-expired.js';
import type { NegotiationSession } from '../src/session/types.js';
import { transition } from '../src/session/state-machine.js';

function makeSession(overrides?: Partial<NegotiationSession>): NegotiationSession {
  return {
    session_id: 'sess-1',
    strategy_id: 'strat-1',
    role: 'BUYER',
    status: 'ACTIVE',
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

function makeHoldSnapshot(overrides?: Partial<HoldSnapshot>): HoldSnapshot {
  return {
    hold_kind: 'SOFT_HOLD',
    held_price_minor: 5000,
    expired_at: Date.now(),
    ...overrides,
  };
}

describe('hold_expired state transitions', () => {
  it('ACTIVE + hold_expired → ACTIVE', () => {
    expect(transition('ACTIVE', 'hold_expired')).toBe('ACTIVE');
  });

  it('NEAR_DEAL + hold_expired → ACTIVE', () => {
    expect(transition('NEAR_DEAL', 'hold_expired')).toBe('ACTIVE');
  });

  it('terminal states reject hold_expired', () => {
    expect(transition('ACCEPTED', 'hold_expired')).toBeNull();
    expect(transition('REJECTED', 'hold_expired')).toBeNull();
    expect(transition('EXPIRED', 'hold_expired')).toBeNull();
  });

  it('CREATED rejects hold_expired', () => {
    expect(transition('CREATED', 'hold_expired')).toBeNull();
  });

  it('STALLED rejects hold_expired', () => {
    expect(transition('STALLED', 'hold_expired')).toBeNull();
  });

  it('WAITING rejects hold_expired', () => {
    expect(transition('WAITING', 'hold_expired')).toBeNull();
  });
});

describe('handleHoldExpired', () => {
  it('SOFT_HOLD → reprice_required=true', () => {
    const result = handleHoldExpired(
      makeSession({ status: 'ACTIVE' }),
      makeHoldSnapshot({ hold_kind: 'SOFT_HOLD' }),
    );
    expect(result.reprice_required).toBe(true);
    expect(result.session.status).toBe('ACTIVE');
    expect(result.previous_hold_price_minor).toBe(5000);
  });

  it('SELLER_RESERVED → reprice_required=false', () => {
    const result = handleHoldExpired(
      makeSession({ status: 'ACTIVE' }),
      makeHoldSnapshot({ hold_kind: 'SELLER_RESERVED', held_price_minor: 9900 }),
    );
    expect(result.reprice_required).toBe(false);
    expect(result.previous_hold_price_minor).toBe(9900);
  });

  it('NEAR_DEAL → transitions to ACTIVE', () => {
    const result = handleHoldExpired(
      makeSession({ status: 'NEAR_DEAL' }),
      makeHoldSnapshot(),
    );
    expect(result.session.status).toBe('ACTIVE');
  });

  it('terminal state → returns session unchanged, no reprice', () => {
    const session = makeSession({ status: 'ACCEPTED' });
    const result = handleHoldExpired(session, makeHoldSnapshot());
    expect(result.session).toBe(session); // same reference
    expect(result.reprice_required).toBe(false);
    expect(result.previous_hold_price_minor).toBeUndefined();
  });

  it('updates updated_at timestamp', () => {
    const oldTime = 1000;
    const session = makeSession({ status: 'ACTIVE', updated_at: oldTime });
    const result = handleHoldExpired(session, makeHoldSnapshot());
    expect(result.session.updated_at).toBeGreaterThan(oldTime);
  });

  it('preserves all other session fields', () => {
    const session = makeSession({
      status: 'ACTIVE',
      current_round: 5,
      rounds_no_concession: 2,
    });
    const result = handleHoldExpired(session, makeHoldSnapshot());
    expect(result.session.current_round).toBe(5);
    expect(result.session.rounds_no_concession).toBe(2);
    expect(result.session.session_id).toBe('sess-1');
  });
});
