import { describe, it, expect } from 'vitest';
import { createSession } from '../src/session/factory.js';
import type { CreateSessionOptions } from '../src/session/factory.js';

function makeOptions(overrides?: Partial<CreateSessionOptions>): CreateSessionOptions {
  return {
    session_id: 'sess-factory-1',
    strategy_id: 'strat-1',
    role: 'BUYER',
    counterparty_id: 'seller-1',
    ...overrides,
  };
}

describe('createSession', () => {
  it('maps all required fields from options', () => {
    const session = createSession(makeOptions());

    expect(session.session_id).toBe('sess-factory-1');
    expect(session.strategy_id).toBe('strat-1');
    expect(session.role).toBe('BUYER');
    expect(session.counterparty_id).toBe('seller-1');
  });

  it('sets status to CREATED', () => {
    const session = createSession(makeOptions());
    expect(session.status).toBe('CREATED');
  });

  it('initializes rounds as empty array', () => {
    const session = createSession(makeOptions());
    expect(session.rounds).toEqual([]);
    expect(session.current_round).toBe(0);
  });

  it('initializes concession tracking to zero', () => {
    const session = createSession(makeOptions());
    expect(session.rounds_no_concession).toBe(0);
  });

  it('initializes last_offer_price and last_utility as null', () => {
    const session = createSession(makeOptions());
    expect(session.last_offer_price).toBeNull();
    expect(session.last_utility).toBeNull();
  });

  it('sets created_at and updated_at to the same timestamp', () => {
    const session = createSession(makeOptions());
    expect(session.created_at).toBe(session.updated_at);
    expect(session.created_at).toBeGreaterThan(0);
  });

  it('works with SELLER role', () => {
    const session = createSession(makeOptions({ role: 'SELLER' }));
    expect(session.role).toBe('SELLER');
  });

  it('each call produces a fresh session with current timestamp', () => {
    const s1 = createSession(makeOptions());
    const s2 = createSession(makeOptions({ session_id: 'sess-factory-2' }));
    expect(s1).not.toBe(s2);
    expect(s2.session_id).toBe('sess-factory-2');
  });
});
