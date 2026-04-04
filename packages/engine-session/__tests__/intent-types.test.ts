import { describe, it, expect } from 'vitest';
import { defaultIntentConfig } from '../src/intent/types.js';
import type { WaitingIntent, IntentConfig, IntentRole, IntentStatus, MatchCandidate, MatchResult } from '../src/intent/types.js';
import type { MasterStrategy } from '../src/strategy/types.js';

function makeStrategy(overrides?: Partial<MasterStrategy>): MasterStrategy {
  return {
    id: 'strat-1',
    user_id: 'user-1',
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    p_target: 80,
    p_limit: 120,
    alpha: 1,
    beta: 1,
    t_deadline: 3600,
    v_t_floor: 0.1,
    n_threshold: 5,
    v_s_base: 0.5,
    w_rep: 0.6,
    w_info: 0.4,
    u_threshold: 0.3,
    u_aspiration: 0.8,
    persona: 'balanced',
    created_at: Date.now(),
    expires_at: Date.now() + 86400000,
    ...overrides,
  };
}

describe('defaultIntentConfig', () => {
  it('returns expected default values', () => {
    const config = defaultIntentConfig();
    expect(config.defaultMinUtotal).toBe(0.3);
    expect(config.defaultMaxActiveSessions).toBe(5);
    expect(config.defaultExpiryDays).toBe(30);
  });

  it('returns a new object each call', () => {
    const a = defaultIntentConfig();
    const b = defaultIntentConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('WaitingIntent type shape', () => {
  it('can construct a valid WaitingIntent', () => {
    const intent: WaitingIntent = {
      intentId: 'intent-1',
      userId: 'user-1',
      role: 'BUYER',
      category: 'electronics',
      keywords: ['laptop', 'macbook'],
      strategy: makeStrategy(),
      minUtotal: 0.3,
      maxActiveSessions: 5,
      currentActiveSessions: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      status: 'ACTIVE',
    };
    expect(intent.intentId).toBe('intent-1');
    expect(intent.role).toBe('BUYER');
    expect(intent.status).toBe('ACTIVE');
    expect(intent.keywords).toHaveLength(2);
  });

  it('supports SELLER role', () => {
    const intent: WaitingIntent = {
      intentId: 'intent-2',
      userId: 'user-2',
      role: 'SELLER',
      category: 'furniture',
      keywords: ['desk'],
      strategy: makeStrategy(),
      minUtotal: 0.5,
      maxActiveSessions: 3,
      currentActiveSessions: 1,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      status: 'MATCHED',
    };
    expect(intent.role).toBe('SELLER');
    expect(intent.status).toBe('MATCHED');
  });
});

describe('MatchCandidate and MatchResult shapes', () => {
  it('can construct MatchCandidate with optional fields', () => {
    const candidate: MatchCandidate = {
      intent: {
        intentId: 'intent-1',
        userId: 'user-1',
        role: 'BUYER',
        category: 'electronics',
        keywords: [],
        strategy: makeStrategy(),
        minUtotal: 0.3,
        maxActiveSessions: 5,
        currentActiveSessions: 0,
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        status: 'ACTIVE',
      },
      utotal: 0.75,
      listingId: 'listing-42',
    };
    expect(candidate.utotal).toBe(0.75);
    expect(candidate.listingId).toBe('listing-42');
    expect(candidate.counterIntentId).toBeUndefined();
  });

  it('can construct empty MatchResult', () => {
    const result: MatchResult = {
      matched: [],
      rejected: [],
      totalEvaluated: 0,
    };
    expect(result.totalEvaluated).toBe(0);
  });
});
