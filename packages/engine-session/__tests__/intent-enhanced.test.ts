import { describe, it, expect } from 'vitest';
import { evaluateMatch, evaluateIntents } from '../src/intent/matcher.js';
import type { MatchOptions } from '../src/intent/matcher.js';
import { shouldRematchIntent, defaultRematchPolicy } from '../src/intent/rematch-policy.js';
import type { RematchPolicy, SessionTerminalStatus } from '../src/intent/rematch-policy.js';
import type { WaitingIntent } from '../src/intent/types.js';
import type { NegotiationContext } from '@haggle/engine-core';

// ─── Fixtures ────────────────────────────────────────────

function makeStrategy() {
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
  };
}

function makeIntent(overrides?: Partial<WaitingIntent>): WaitingIntent {
  return {
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
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    status: 'ACTIVE',
    ...overrides,
  };
}

function makeHighUtilityContext(): NegotiationContext {
  return {
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    price: { p_effective: 35, p_target: 30, p_limit: 100 },
    time: { t_elapsed: 10, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
    risk: { r_score: 0.9, i_completeness: 0.95, w_rep: 0.6, w_info: 0.4 },
    relationship: { n_success: 10, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.3 },
  };
}

// ─── evaluateMatch with MatchOptions ────────────────────

describe('evaluateMatch with MatchOptions', () => {
  it('without options: same as before', () => {
    const result = evaluateMatch(makeIntent(), makeHighUtilityContext());
    expect(result.utotal).toBeGreaterThan(0);
  });

  it('matching category: allows match', () => {
    const opts: MatchOptions = { listing_category: 'electronics' };
    const result = evaluateMatch(makeIntent(), makeHighUtilityContext(), opts);
    expect(result.utotal).toBeGreaterThan(0);
  });

  it('mismatched category: sets utotal to 0', () => {
    const opts: MatchOptions = { listing_category: 'clothing' };
    const result = evaluateMatch(makeIntent(), makeHighUtilityContext(), opts);
    expect(result.utotal).toBe(0);
  });

  it('category match is case-insensitive', () => {
    const opts: MatchOptions = { listing_category: 'ELECTRONICS' };
    const result = evaluateMatch(makeIntent(), makeHighUtilityContext(), opts);
    expect(result.utotal).toBeGreaterThan(0);
  });

  it('keyword match adds bonus', () => {
    const opts: MatchOptions = {
      listing_category: 'electronics',
      listing_keywords: ['laptop', 'apple'],
    };
    const resultWithKw = evaluateMatch(makeIntent(), makeHighUtilityContext(), opts);
    const resultNoKw = evaluateMatch(makeIntent(), makeHighUtilityContext(), {
      listing_category: 'electronics',
    });
    // 1 keyword match ('laptop') → +0.05
    expect(resultWithKw.utotal).toBeGreaterThan(resultNoKw.utotal);
  });

  it('multiple keyword matches add cumulative bonus', () => {
    // Use moderate context so cumulative bonus difference is visible
    const moderateCtx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 70, p_target: 30, p_limit: 100 },
      time: { t_elapsed: 60, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
      risk: { r_score: 0.5, i_completeness: 0.5, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 2, n_dispute_losses: 1, n_threshold: 10, v_s_base: 0.3 },
    };
    const opts1: MatchOptions = {
      listing_category: 'electronics',
      listing_keywords: ['laptop'],
    };
    const opts2: MatchOptions = {
      listing_category: 'electronics',
      listing_keywords: ['laptop', 'macbook'],
    };
    const r1 = evaluateMatch(makeIntent(), moderateCtx, opts1);
    const r2 = evaluateMatch(makeIntent(), moderateCtx, opts2);
    expect(r2.utotal).toBeGreaterThan(r1.utotal);
  });

  it('keyword bonus capped at 1.0', () => {
    const opts: MatchOptions = {
      listing_keywords: ['laptop', 'macbook'],
      keyword_bonus: 5.0, // extreme bonus
    };
    const result = evaluateMatch(makeIntent(), makeHighUtilityContext(), opts);
    expect(result.utotal).toBeLessThanOrEqual(1.0);
  });

  it('custom keyword_bonus value', () => {
    // Use a context with moderate utility so bonus differences are visible
    const moderateCtx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 70, p_target: 30, p_limit: 100 },
      time: { t_elapsed: 60, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
      risk: { r_score: 0.5, i_completeness: 0.5, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 2, n_dispute_losses: 1, n_threshold: 10, v_s_base: 0.3 },
    };
    const opts: MatchOptions = {
      listing_category: 'electronics',
      listing_keywords: ['laptop'],
      keyword_bonus: 0.1,
    };
    const resultCustom = evaluateMatch(makeIntent(), moderateCtx, opts);
    const resultDefault = evaluateMatch(makeIntent(), moderateCtx, {
      listing_category: 'electronics',
      listing_keywords: ['laptop'],
    });
    // Custom bonus 0.1 vs default 0.05
    expect(resultCustom.utotal).toBeGreaterThan(resultDefault.utotal);
  });
});

// ─── evaluateIntents with MatchOptions ──────────────────

describe('evaluateIntents with MatchOptions', () => {
  it('category filter rejects mismatched intents', () => {
    const intents = [
      makeIntent({ intentId: 'i1', category: 'electronics' }),
      makeIntent({ intentId: 'i2', category: 'clothing' }),
    ];
    const result = evaluateIntents(
      intents,
      () => makeHighUtilityContext(),
      { listing_category: 'electronics' },
    );
    expect(result.matched.length).toBe(1);
    expect(result.matched[0].intent.intentId).toBe('i1');
    expect(result.rejected.length).toBe(1);
  });
});

// ─── shouldRematchIntent ────────────────────────────────

describe('shouldRematchIntent', () => {
  it('default policy: rematch on REJECTED', () => {
    const result = shouldRematchIntent(makeIntent(), 'REJECTED', 0);
    expect(result.should_rematch).toBe(true);
  });

  it('default policy: rematch on EXPIRED', () => {
    const result = shouldRematchIntent(makeIntent(), 'EXPIRED', 0);
    expect(result.should_rematch).toBe(true);
  });

  it('default policy: rematch on SUPERSEDED', () => {
    const result = shouldRematchIntent(makeIntent(), 'SUPERSEDED', 0);
    expect(result.should_rematch).toBe(true);
  });

  it('respects rematch_on_rejected=false', () => {
    const policy: RematchPolicy = { ...defaultRematchPolicy(), rematch_on_rejected: false };
    const result = shouldRematchIntent(makeIntent(), 'REJECTED', 0, policy);
    expect(result.should_rematch).toBe(false);
    expect(result.reason).toContain('disabled');
  });

  it('respects rematch_on_expired=false', () => {
    const policy: RematchPolicy = { ...defaultRematchPolicy(), rematch_on_expired: false };
    const result = shouldRematchIntent(makeIntent(), 'EXPIRED', 0, policy);
    expect(result.should_rematch).toBe(false);
  });

  it('rejects when max_rematch_count reached', () => {
    const result = shouldRematchIntent(makeIntent(), 'REJECTED', 3);
    expect(result.should_rematch).toBe(false);
    expect(result.reason).toContain('max_rematch_count');
  });

  it('rejects when intent is FULFILLED', () => {
    const result = shouldRematchIntent(
      makeIntent({ status: 'FULFILLED' }),
      'REJECTED',
      0,
    );
    expect(result.should_rematch).toBe(false);
    expect(result.reason).toContain('not eligible');
  });

  it('rejects when intent is CANCELLED', () => {
    const result = shouldRematchIntent(
      makeIntent({ status: 'CANCELLED' }),
      'REJECTED',
      0,
    );
    expect(result.should_rematch).toBe(false);
  });

  it('rejects when max active sessions reached', () => {
    const result = shouldRematchIntent(
      makeIntent({ currentActiveSessions: 5, maxActiveSessions: 5 }),
      'REJECTED',
      0,
    );
    expect(result.should_rematch).toBe(false);
    expect(result.reason).toContain('max active sessions');
  });

  it('allows rematch when intent is MATCHED', () => {
    const result = shouldRematchIntent(
      makeIntent({ status: 'MATCHED' }),
      'REJECTED',
      0,
    );
    expect(result.should_rematch).toBe(true);
  });
});

describe('defaultRematchPolicy', () => {
  it('has sensible defaults', () => {
    const policy = defaultRematchPolicy();
    expect(policy.rematch_on_rejected).toBe(true);
    expect(policy.rematch_on_expired).toBe(true);
    expect(policy.max_rematch_count).toBe(3);
    expect(policy.rematch_cooldown_ms).toBe(60_000);
  });
});
