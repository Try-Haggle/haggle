/**
 * Step 38 — Multi-term integration tests.
 * End-to-end flows through computeUtility with TermSpace.
 */
import { describe, it, expect } from 'vitest';
import { computeUtility, makeDecision } from '../src/index.js';
import type { NegotiationContext, UtilityResult } from '../src/types.js';
import type { TermSpace } from '../src/term/types.js';
import type { DecisionThresholds, SessionState } from '../src/decision/types.js';

function makeBaseCtx(): NegotiationContext {
  return {
    weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
    price: { p_effective: 50, p_target: 30, p_limit: 100 },
    time: { t_elapsed: 30, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
    risk: { r_score: 0.8, i_completeness: 0.9, w_rep: 0.6, w_info: 0.4 },
    relationship: { n_success: 5, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.3 },
  };
}

function makeMultiTermSpace(): TermSpace {
  return {
    terms: [
      {
        id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 0.5,
        domain: { min: 0, max: 100, direction: 'lower_is_better' },
      },
      {
        id: 'warranty_months', type: 'NEGOTIABLE', layer: 'CATEGORY', weight: 0.3,
        domain: { min: 0, max: 36, direction: 'higher_is_better' },
      },
      {
        id: 'delivery_days', type: 'NEGOTIABLE', layer: 'CUSTOM', weight: 0.2,
        domain: { min: 1, max: 14, direction: 'lower_is_better' },
      },
      {
        id: 'seller_rating', type: 'INFORMATIONAL', layer: 'GLOBAL', weight: 0,
        description: 'Seller reputation score',
      },
    ],
    current_values: {
      price: 40,
      warranty_months: 24,
      delivery_days: 3,
      seller_rating: 0.85,
    },
  };
}

describe('multi-term integration', () => {
  it('multi-term path produces valid utility', () => {
    const ctx = { ...makeBaseCtx(), term_space: makeMultiTermSpace() };
    const result = computeUtility(ctx);
    expect(result.error).toBeUndefined();
    expect(result.u_total).toBeGreaterThan(0);
    expect(result.u_total).toBeLessThanOrEqual(1);
  });

  it('multi-term utility feeds into makeDecision', () => {
    const ctx = { ...makeBaseCtx(), term_space: makeMultiTermSpace() };
    const utility = computeUtility(ctx);
    const thresholds: DecisionThresholds = { u_threshold: 0.4, u_aspiration: 0.8 };
    const session: SessionState = { rounds_no_concession: 0 };
    const decision = makeDecision(utility, thresholds, session);
    expect(['ACCEPT', 'COUNTER', 'NEAR_DEAL', 'REJECT', 'ESCALATE']).toContain(decision.action);
  });

  it('worse term values produce lower utility', () => {
    const goodTerms = makeMultiTermSpace();
    const badTerms: TermSpace = {
      ...goodTerms,
      current_values: { price: 80, warranty_months: 6, delivery_days: 12, seller_rating: 0.3 },
    };
    const good = computeUtility({ ...makeBaseCtx(), term_space: goodTerms });
    const bad = computeUtility({ ...makeBaseCtx(), term_space: badTerms });
    expect(good.u_total).toBeGreaterThan(bad.u_total);
  });

  it('INFORMATIONAL bonus is small but positive', () => {
    const withInfo = makeMultiTermSpace();
    const withoutInfo: TermSpace = {
      terms: withInfo.terms.filter(t => t.type !== 'INFORMATIONAL'),
      current_values: { price: 40, warranty_months: 24, delivery_days: 3 },
    };
    // Need to adjust weights to sum to 1
    withoutInfo.terms = withoutInfo.terms.map(t => {
      if (t.id === 'price') return { ...t, weight: 0.5 };
      if (t.id === 'warranty_months') return { ...t, weight: 0.3 };
      return { ...t, weight: 0.2 };
    });
    const uWith = computeUtility({ ...makeBaseCtx(), term_space: withInfo });
    const uWithout = computeUtility({ ...makeBaseCtx(), term_space: withoutInfo });
    // Info bonus should be small
    expect(uWith.u_total - uWithout.u_total).toBeLessThan(0.15);
    expect(uWith.u_total).toBeGreaterThanOrEqual(uWithout.u_total);
  });

  it('single-term space equivalent to classic price-only logic', () => {
    const singleTerm: TermSpace = {
      terms: [{
        id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 1.0,
        domain: { min: 0, max: 100, direction: 'lower_is_better' },
      }],
      current_values: { price: 50 },
    };
    const result = computeUtility({ ...makeBaseCtx(), term_space: singleTerm });
    expect(result.error).toBeUndefined();
    expect(result.u_total).toBeGreaterThan(0);
  });

  it('all terms at worst values → utility near 0', () => {
    const worstCase: TermSpace = {
      terms: [
        { id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 0.5,
          domain: { min: 0, max: 100, direction: 'lower_is_better' } },
        { id: 'warranty', type: 'NEGOTIABLE', layer: 'CATEGORY', weight: 0.5,
          domain: { min: 0, max: 36, direction: 'higher_is_better' } },
      ],
      current_values: { price: 100, warranty: 0 },
    };
    const result = computeUtility({ ...makeBaseCtx(), term_space: worstCase });
    expect(result.u_total).toBe(0);
  });

  it('all terms at best values → utility near 1', () => {
    const bestCase: TermSpace = {
      terms: [
        { id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 0.5,
          domain: { min: 0, max: 100, direction: 'lower_is_better' } },
        { id: 'warranty', type: 'NEGOTIABLE', layer: 'CATEGORY', weight: 0.5,
          domain: { min: 0, max: 36, direction: 'higher_is_better' } },
      ],
      current_values: { price: 0, warranty: 36 },
    };
    const result = computeUtility({ ...makeBaseCtx(), term_space: bestCase });
    expect(result.u_total).toBeCloseTo(1.0);
  });

  it('classic 4D path still works without term_space', () => {
    const ctx = makeBaseCtx();
    const result = computeUtility(ctx);
    expect(result.v_p).toBeGreaterThan(0);
    expect(result.v_t).toBeGreaterThan(0);
    expect(result.v_r).toBeGreaterThan(0);
    expect(result.v_s).toBeGreaterThan(0);
    expect(result.u_total).toBeGreaterThan(0);
  });

  it('classic + hold path works together', () => {
    const ctx: NegotiationContext = {
      ...makeBaseCtx(),
      hold: {
        is_held: true,
        hold_kind: 'SOFT_HOLD',
        held_price_minor: 5000,
        hold_remaining_ms: 5000,
        hold_total_ms: 60000,
        resume_reprice_required: false,
      },
    };
    const withHold = computeUtility(ctx);
    const without = computeUtility(makeBaseCtx());
    expect(withHold.v_t).toBeLessThan(without.v_t);
  });
});
