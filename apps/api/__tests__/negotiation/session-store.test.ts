import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySessionStore } from '../../src/negotiation/session-store.js';
import type { StoredSession } from '../../src/negotiation/session-store.js';
import type { NegotiationSession, MasterStrategy } from '@haggle/engine-session';

function makeSession(id: string): NegotiationSession {
  const now = Date.now();
  return {
    session_id: id,
    strategy_id: `strat_${id}`,
    role: 'BUYER',
    status: 'CREATED',
    counterparty_id: 'seller_1',
    rounds: [],
    current_round: 0,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: now,
    updated_at: now,
  };
}

function makeStrategy(id: string): MasterStrategy {
  const now = Date.now();
  return {
    id: `strat_${id}`,
    user_id: 'user_1',
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    p_target: 80,
    p_limit: 95,
    alpha: 1.0,
    beta: 1.0,
    t_deadline: 86400,
    v_t_floor: 0.1,
    n_threshold: 3,
    v_s_base: 0.5,
    w_rep: 0.5,
    w_info: 0.7,
    u_threshold: 0.4,
    u_aspiration: 0.7,
    persona: 'balanced',
    created_at: now,
    expires_at: now + 86400_000,
  };
}

function makeEntry(id: string): StoredSession {
  return { session: makeSession(id), strategy: makeStrategy(id) };
}

describe('InMemorySessionStore', () => {
  let store: InMemorySessionStore;

  beforeEach(() => {
    store = new InMemorySessionStore();
  });

  it('should save and retrieve a session', async () => {
    const entry = makeEntry('s1');
    await store.save(entry);
    const result = await store.get('s1');
    expect(result).not.toBeNull();
    expect(result!.session.session_id).toBe('s1');
  });

  it('should return null for non-existent session', async () => {
    const result = await store.get('nonexistent');
    expect(result).toBeNull();
  });

  it('should upsert on save with same session_id', async () => {
    const entry = makeEntry('s1');
    await store.save(entry);

    const updated = { ...entry, session: { ...entry.session, status: 'ACTIVE' as const } };
    await store.save(updated);

    const result = await store.get('s1');
    expect(result!.session.status).toBe('ACTIVE');
    expect(store.size).toBe(1);
  });

  it('should delete an existing session and return true', async () => {
    await store.save(makeEntry('s1'));
    const deleted = await store.delete('s1');
    expect(deleted).toBe(true);
    expect(await store.get('s1')).toBeNull();
  });

  it('should return false when deleting non-existent session', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('should list all session IDs', async () => {
    await store.save(makeEntry('s1'));
    await store.save(makeEntry('s2'));
    await store.save(makeEntry('s3'));

    const ids = await store.listIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids).toContain('s3');
  });

  it('should clear all sessions', async () => {
    await store.save(makeEntry('s1'));
    await store.save(makeEntry('s2'));
    store.clear();
    expect(store.size).toBe(0);
    expect(await store.listIds()).toHaveLength(0);
  });

  it('should report correct size', async () => {
    expect(store.size).toBe(0);
    await store.save(makeEntry('s1'));
    expect(store.size).toBe(1);
    await store.save(makeEntry('s2'));
    expect(store.size).toBe(2);
    await store.delete('s1');
    expect(store.size).toBe(1);
  });
});
