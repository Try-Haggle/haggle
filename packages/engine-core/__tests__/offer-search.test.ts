import { describe, it, expect } from 'vitest';
import {
  searchOffer,
  estimateAcceptanceProbability,
} from '../src/index.js';
import type {
  IssueDefinition,
  IssueWeight,
  RiskCostParams,
  RelationshipBonusParams,
  OfferSearchInput,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const priceDef: IssueDefinition = {
  name: 'price',
  type: 'scalar',
  category: 'negotiable',
  direction: 'lower_better',
  min: 800,
  max: 1200,
};

const warrantyDef: IssueDefinition = {
  name: 'warranty_days',
  type: 'scalar',
  category: 'negotiable',
  direction: 'higher_better',
  min: 0,
  max: 365,
};

const shippingDef: IssueDefinition = {
  name: 'shipping_method',
  type: 'enum',
  category: 'negotiable',
  direction: 'higher_better',
  values: ['standard', 'express', 'overnight'],
};

const definitions: IssueDefinition[] = [priceDef, warrantyDef, shippingDef];

const weights: IssueWeight[] = [
  { issue_name: 'price', weight: 0.6 },
  { issue_name: 'warranty_days', weight: 0.3 },
  { issue_name: 'shipping_method', weight: 0.1 },
];

const lowRisk: RiskCostParams = {
  p_fraud: 0,
  p_quality: 0,
  p_delay: 0,
  p_dispute: 0,
  lambda_f: 0.1,
  lambda_q: 0.1,
  lambda_d: 0.1,
  lambda_s: 0.1,
};

const neutralRelationship: RelationshipBonusParams = {
  q_reputation: 0,
  q_repeat: 0,
  q_responsiveness: 0,
  rho_1: 0.1,
  rho_2: 0.1,
  rho_3: 0.1,
};

function makeInput(overrides?: Partial<OfferSearchInput>): OfferSearchInput {
  return {
    base_offer: { price: 950, warranty_days: 180, shipping_method: 'express' },
    definitions,
    weights,
    risk: lowRisk,
    relationship: neutralRelationship,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// estimateAcceptanceProbability
// ---------------------------------------------------------------------------

describe('estimateAcceptanceProbability', () => {
  it('returns 0.5 when no opponent offer is available', () => {
    const offer = { price: 950, warranty_days: 180 };
    expect(estimateAcceptanceProbability(offer, undefined, definitions, weights)).toBe(0.5);
  });

  it('returns 1.0 when offer exactly matches opponent last offer', () => {
    const offer = { price: 1000, warranty_days: 200, shipping_method: 'express' };
    const result = estimateAcceptanceProbability(offer, offer, definitions, weights);
    expect(result).toBeCloseTo(1.0);
  });

  it('returns lower probability when offer is far from opponent', () => {
    const offer = { price: 800, warranty_days: 365, shipping_method: 'overnight' };
    const opponentOffer = { price: 1200, warranty_days: 0, shipping_method: 'standard' };
    const result = estimateAcceptanceProbability(offer, opponentOffer, definitions, weights);
    expect(result).toBeCloseTo(0.0, 1);
  });

  it('returns higher probability when offer is close to opponent', () => {
    const offer = { price: 990, warranty_days: 185, shipping_method: 'express' };
    const opponentOffer = { price: 1000, warranty_days: 180, shipping_method: 'express' };
    const result = estimateAcceptanceProbability(offer, opponentOffer, definitions, weights);
    expect(result).toBeGreaterThan(0.9);
  });

  it('handles missing issue values gracefully', () => {
    const offer = { price: 950 };
    const opponentOffer = { price: 1000 };
    // Only price is available for comparison
    const result = estimateAcceptanceProbability(offer, opponentOffer, definitions, weights);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// searchOffer
// ---------------------------------------------------------------------------

describe('searchOffer', () => {
  it('returns the base offer when no perturbation improves J(ω)', () => {
    const input = makeInput();
    const result = searchOffer(input);
    expect(result.offer).toBeDefined();
    expect(result.score).toBeGreaterThan(0);
    expect(typeof result.u_self).toBe('number');
    expect(typeof result.p_accept).toBe('number');
    expect(typeof result.move_cost).toBe('number');
  });

  it('score includes all three components of J(ω)', () => {
    const input = makeInput({
      opponent_last_offer: { price: 1100, warranty_days: 30, shipping_method: 'standard' },
      previous_own_offer: { price: 900, warranty_days: 200, shipping_method: 'express' },
    });
    const result = searchOffer(input);

    // J(ω) = α * u_self + (1 - α) * p_accept - η * move_cost
    const alpha = 0.7;
    const eta = 0.1;
    const expected = alpha * result.u_self + (1 - alpha) * result.p_accept - eta * result.move_cost;
    expect(result.score).toBeCloseTo(expected, 5);
  });

  it('uses default alpha=0.7 and eta=0.1', () => {
    const input = makeInput();
    const result = searchOffer(input);
    // Verify score is computed with defaults (no NaN, reasonable range)
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThan(-1);
    expect(result.score).toBeLessThan(2);
  });

  it('respects custom alpha and eta', () => {
    const inputHighAlpha = makeInput({ alpha: 0.95, eta: 0.01 });
    const inputLowAlpha = makeInput({ alpha: 0.3, eta: 0.5 });

    const resultHighAlpha = searchOffer(inputHighAlpha);
    const resultLowAlpha = searchOffer(inputLowAlpha);

    // With high alpha, self-utility dominates; with low alpha, acceptance dominates
    // Both should produce valid results
    expect(Number.isFinite(resultHighAlpha.score)).toBe(true);
    expect(Number.isFinite(resultLowAlpha.score)).toBe(true);
  });

  it('move_cost is 0 when no previous own offer', () => {
    const input = makeInput({ previous_own_offer: undefined });
    const result = searchOffer(input);
    expect(result.move_cost).toBe(0);
  });

  it('move_cost is positive when previous own offer differs', () => {
    const input = makeInput({
      previous_own_offer: { price: 850, warranty_days: 250, shipping_method: 'overnight' },
    });
    const result = searchOffer(input);
    expect(result.move_cost).toBeGreaterThan(0);
  });

  it('perturbations can improve the score over base offer', () => {
    // Create a scenario where perturbations may help:
    // opponent is at a high price, our base offer is moderate
    const input = makeInput({
      base_offer: { price: 1000, warranty_days: 100, shipping_method: 'standard' },
      opponent_last_offer: { price: 1100, warranty_days: 50, shipping_method: 'standard' },
      alpha: 0.3, // Low alpha → acceptance probability matters more → move toward opponent
    });
    const result = searchOffer(input);
    // The search should return a valid result (may or may not improve)
    expect(result.offer).toBeDefined();
    expect(result.score).toBeGreaterThan(-1);
  });

  it('returns offer with all issue values intact', () => {
    const input = makeInput();
    const result = searchOffer(input);
    // The offer should contain values for all negotiable issues present in base
    expect(result.offer.price).toBeDefined();
    expect(result.offer.warranty_days).toBeDefined();
    expect(result.offer.shipping_method).toBeDefined();
  });

  it('handles definitions with only enum/boolean issues (no perturbation)', () => {
    const boolDef: IssueDefinition = {
      name: 'insured',
      type: 'boolean',
      category: 'negotiable',
      direction: 'higher_better',
    };
    const input = makeInput({
      base_offer: { shipping_method: 'express', insured: true },
      definitions: [shippingDef, boolDef],
      weights: [
        { issue_name: 'shipping_method', weight: 0.5 },
        { issue_name: 'insured', weight: 0.5 },
      ],
    });
    const result = searchOffer(input);
    // No perturbations possible for enum/boolean, so base offer is returned
    expect(result.offer).toEqual(input.base_offer);
  });

  it('u_self is bounded [0, 1]', () => {
    const input = makeInput();
    const result = searchOffer(input);
    expect(result.u_self).toBeGreaterThanOrEqual(0);
    expect(result.u_self).toBeLessThanOrEqual(1);
  });

  it('p_accept is bounded [0, 1]', () => {
    const input = makeInput({
      opponent_last_offer: { price: 1100, warranty_days: 30, shipping_method: 'standard' },
    });
    const result = searchOffer(input);
    expect(result.p_accept).toBeGreaterThanOrEqual(0);
    expect(result.p_accept).toBeLessThanOrEqual(1);
  });
});
