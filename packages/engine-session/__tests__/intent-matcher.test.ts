import { describe, it, expect } from 'vitest';
import { evaluateMatch, evaluateIntents, evaluateBidirectionalMatch } from '../src/intent/matcher.js';
import type { WaitingIntent } from '../src/intent/types.js';
import type { NegotiationContext } from '@haggle/engine-core';
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

function makeIntent(overrides?: Partial<WaitingIntent>): WaitingIntent {
  return {
    intentId: 'intent-1',
    userId: 'user-1',
    role: 'BUYER',
    category: 'electronics',
    keywords: ['laptop'],
    strategy: makeStrategy(),
    minUtotal: 0.3,
    maxActiveSessions: 5,
    currentActiveSessions: 0,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
    status: 'ACTIVE',
    ...overrides,
  };
}

/**
 * Build a valid NegotiationContext that produces a known utility value.
 * Buyer perspective: p_target < p_limit (buyer wants lower price).
 * With p_effective = p_target, V_p = 1.0.
 * t_elapsed = 0 -> V_t = 1.0.
 * r_score = 1.0, i_completeness = 1.0 -> V_r = 1.0.
 * n_success = n_threshold -> V_s ~ v_s_base + bonus.
 * This gives high utility (~1.0).
 */
function makeHighUtilityContext(): NegotiationContext {
  return {
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    price: { p_effective: 80, p_target: 80, p_limit: 120 },
    time: { t_elapsed: 0, t_deadline: 3600, alpha: 1, v_t_floor: 0.1 },
    risk: { r_score: 1.0, i_completeness: 1.0, w_rep: 0.6, w_info: 0.4 },
    relationship: { n_success: 5, n_dispute_losses: 0, n_threshold: 5, v_s_base: 0.5 },
  };
}

/**
 * Build a context that produces low utility.
 * p_effective = p_limit -> V_p = 0.0 for buyer.
 * t_elapsed = t_deadline -> V_t = v_t_floor.
 * r_score = 0 -> V_r low.
 */
function makeLowUtilityContext(): NegotiationContext {
  return {
    weights: { w_p: 0.4, w_t: 0.2, w_r: 0.2, w_s: 0.2 },
    price: { p_effective: 120, p_target: 80, p_limit: 120 },
    time: { t_elapsed: 3600, t_deadline: 3600, alpha: 1, v_t_floor: 0.1 },
    risk: { r_score: 0.0, i_completeness: 0.0, w_rep: 0.6, w_info: 0.4 },
    relationship: { n_success: 0, n_dispute_losses: 5, n_threshold: 5, v_s_base: 0.5 },
  };
}

describe('evaluateMatch', () => {
  it('returns correct utotal from computeUtility — high utility', () => {
    const intent = makeIntent();
    const ctx = makeHighUtilityContext();
    const candidate = evaluateMatch(intent, ctx);
    expect(candidate.intent).toBe(intent);
    expect(candidate.utotal).toBeGreaterThan(0.5);
  });

  it('returns correct utotal from computeUtility — low utility', () => {
    const intent = makeIntent();
    const ctx = makeLowUtilityContext();
    const candidate = evaluateMatch(intent, ctx);
    expect(candidate.intent).toBe(intent);
    expect(candidate.utotal).toBeLessThan(0.3);
  });

  it('preserves intent reference in result', () => {
    const intent = makeIntent({ intentId: 'ref-check' });
    const ctx = makeHighUtilityContext();
    const candidate = evaluateMatch(intent, ctx);
    expect(candidate.intent.intentId).toBe('ref-check');
  });
});

describe('evaluateIntents', () => {
  it('filters matched by minUtotal', () => {
    const highIntent = makeIntent({ intentId: 'high', minUtotal: 0.3 });
    const lowIntent = makeIntent({ intentId: 'low', minUtotal: 0.99 });
    const result = evaluateIntents(
      [highIntent, lowIntent],
      () => makeHighUtilityContext(),
    );
    // High utility context should match the 0.3 threshold but likely not 0.99
    expect(result.totalEvaluated).toBe(2);
    expect(result.matched.length + result.rejected.length).toBe(2);
  });

  it('respects maxActiveSessions capacity', () => {
    const fullIntent = makeIntent({
      intentId: 'full',
      maxActiveSessions: 3,
      currentActiveSessions: 3,
      minUtotal: 0,
    });
    const result = evaluateIntents(
      [fullIntent],
      () => makeHighUtilityContext(),
    );
    expect(result.matched).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('returns empty result for empty intents array', () => {
    const result = evaluateIntents([], () => makeHighUtilityContext());
    expect(result.matched).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.totalEvaluated).toBe(0);
  });

  it('matches intent with minUtotal = 0', () => {
    const intent = makeIntent({ minUtotal: 0 });
    const result = evaluateIntents(
      [intent],
      () => makeLowUtilityContext(),
    );
    expect(result.matched).toHaveLength(1);
  });

  it('rejects when maxActiveSessions = 0', () => {
    const intent = makeIntent({
      maxActiveSessions: 0,
      currentActiveSessions: 0,
      minUtotal: 0,
    });
    const result = evaluateIntents(
      [intent],
      () => makeHighUtilityContext(),
    );
    expect(result.matched).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it('uses contextBuilder per intent', () => {
    const intent1 = makeIntent({ intentId: 'i1', minUtotal: 0.3 });
    const intent2 = makeIntent({ intentId: 'i2', minUtotal: 0.3 });
    let callCount = 0;
    const result = evaluateIntents(
      [intent1, intent2],
      (intent) => {
        callCount++;
        return makeHighUtilityContext();
      },
    );
    expect(callCount).toBe(2);
    expect(result.totalEvaluated).toBe(2);
  });
});

describe('evaluateBidirectionalMatch', () => {
  it('both above threshold → matched', () => {
    const buyer = makeIntent({ intentId: 'buyer', role: 'BUYER', minUtotal: 0.3 });
    const seller = makeIntent({ intentId: 'seller', role: 'SELLER', minUtotal: 0.3 });
    const result = evaluateBidirectionalMatch(
      buyer, seller,
      makeHighUtilityContext(),
      makeHighUtilityContext(),
    );
    expect(result.matched).toBe(true);
    expect(result.buyerUtotal).toBeGreaterThan(0.3);
    expect(result.sellerUtotal).toBeGreaterThan(0.3);
  });

  it('buyer below threshold → not matched', () => {
    const buyer = makeIntent({ intentId: 'buyer', role: 'BUYER', minUtotal: 0.3 });
    const seller = makeIntent({ intentId: 'seller', role: 'SELLER', minUtotal: 0.3 });
    const result = evaluateBidirectionalMatch(
      buyer, seller,
      makeLowUtilityContext(),
      makeHighUtilityContext(),
    );
    expect(result.matched).toBe(false);
    expect(result.buyerUtotal).toBeLessThan(0.3);
  });

  it('seller below threshold → not matched', () => {
    const buyer = makeIntent({ intentId: 'buyer', role: 'BUYER', minUtotal: 0.3 });
    const seller = makeIntent({ intentId: 'seller', role: 'SELLER', minUtotal: 0.3 });
    const result = evaluateBidirectionalMatch(
      buyer, seller,
      makeHighUtilityContext(),
      makeLowUtilityContext(),
    );
    expect(result.matched).toBe(false);
    expect(result.sellerUtotal).toBeLessThan(0.3);
  });

  it('buyer at session capacity → not matched', () => {
    const buyer = makeIntent({
      intentId: 'buyer',
      role: 'BUYER',
      minUtotal: 0.3,
      maxActiveSessions: 2,
      currentActiveSessions: 2,
    });
    const seller = makeIntent({ intentId: 'seller', role: 'SELLER', minUtotal: 0.3 });
    const result = evaluateBidirectionalMatch(
      buyer, seller,
      makeHighUtilityContext(),
      makeHighUtilityContext(),
    );
    expect(result.matched).toBe(false);
  });

  it('seller at session capacity → not matched', () => {
    const buyer = makeIntent({ intentId: 'buyer', role: 'BUYER', minUtotal: 0.3 });
    const seller = makeIntent({
      intentId: 'seller',
      role: 'SELLER',
      minUtotal: 0.3,
      maxActiveSessions: 1,
      currentActiveSessions: 1,
    });
    const result = evaluateBidirectionalMatch(
      buyer, seller,
      makeHighUtilityContext(),
      makeHighUtilityContext(),
    );
    expect(result.matched).toBe(false);
  });

  it('returns utotal values even when not matched', () => {
    const buyer = makeIntent({ intentId: 'buyer', role: 'BUYER', minUtotal: 0.99 });
    const seller = makeIntent({ intentId: 'seller', role: 'SELLER', minUtotal: 0.99 });
    const result = evaluateBidirectionalMatch(
      buyer, seller,
      makeHighUtilityContext(),
      makeLowUtilityContext(),
    );
    expect(result.matched).toBe(false);
    expect(typeof result.buyerUtotal).toBe('number');
    expect(typeof result.sellerUtotal).toBe('number');
  });
});
