import { describe, it, expect } from 'vitest';
import {
  validateOffer,
  validateWeights,
  ELECTRONICS_SHIPPING_V1,
  computeAcceptanceThreshold,
  computeMultiIssueCounterOffer,
} from '../src/index.js';
import type { IssueValues, IssueSchema, IssueWeight, IssueDefinition } from '../src/index.js';

// ---------------------------------------------------------------------------
// Offer Validation
// ---------------------------------------------------------------------------

describe('validateOffer', () => {
  const schema = ELECTRONICS_SHIPPING_V1;

  it('valid offer passes', () => {
    const values: IssueValues = {
      price: 500,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing required negotiable issue', () => {
    const values: IssueValues = {
      price: 500,
      // missing ship_within_hours, shipping_method, warranty_days
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING')).toBe(true);
  });

  it('type mismatch: string where number expected', () => {
    const values: IssueValues = {
      price: 'not a number' as any,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('TYPE_MISMATCH');
    expect(result.errors[0].issue_name).toBe('price');
  });

  it('out of range: price exceeds max', () => {
    const values: IssueValues = {
      price: 99999,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('OUT_OF_RANGE');
  });

  it('invalid enum value', () => {
    const values: IssueValues = {
      price: 500,
      ship_within_hours: 24,
      shipping_method: 'teleportation',
      warranty_days: 30,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_ENUM');
  });

  it('unknown issue in offer', () => {
    const values: IssueValues = {
      price: 500,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
      magic_field: 42,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('UNKNOWN_ISSUE');
  });

  it('NaN value is rejected as type mismatch', () => {
    const values: IssueValues = {
      price: NaN,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('TYPE_MISMATCH');
  });

  it('Infinity value is rejected as type mismatch', () => {
    const values: IssueValues = {
      price: Infinity,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('TYPE_MISMATCH');
  });

  it('informational values validated if present', () => {
    // battery_health and condition_grade are informational in schema
    const values: IssueValues = {
      price: 500,
      ship_within_hours: 24,
      shipping_method: 'priority',
      warranty_days: 30,
      battery_health: 0.95,
      condition_grade: 'A',
    };
    const result = validateOffer(values, schema);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Weight Validation
// ---------------------------------------------------------------------------

describe('validateWeights', () => {
  const defs: IssueDefinition[] = [
    { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 1000 },
    { name: 'warranty', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 0, max: 365 },
  ];

  it('valid weights pass', () => {
    const weights: IssueWeight[] = [
      { issue_name: 'price', weight: 0.7 },
      { issue_name: 'warranty', weight: 0.3 },
    ];
    const result = validateWeights(weights, defs);
    expect(result.valid).toBe(true);
    expect(result.weight_sum).toBeCloseTo(1.0);
  });

  it('weights not summing to 1.0', () => {
    const weights: IssueWeight[] = [
      { issue_name: 'price', weight: 0.7 },
      { issue_name: 'warranty', weight: 0.1 },
    ];
    const result = validateWeights(weights, defs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'WEIGHT_SUM')).toBe(true);
  });

  it('missing weight for an issue', () => {
    const weights: IssueWeight[] = [
      { issue_name: 'price', weight: 1.0 },
    ];
    const result = validateWeights(weights, defs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_WEIGHT')).toBe(true);
  });

  it('negative weight', () => {
    const weights: IssueWeight[] = [
      { issue_name: 'price', weight: 1.5 },
      { issue_name: 'warranty', weight: -0.5 },
    ];
    const result = validateWeights(weights, defs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'NEGATIVE_WEIGHT')).toBe(true);
  });

  it('NaN weight', () => {
    const weights: IssueWeight[] = [
      { issue_name: 'price', weight: NaN },
      { issue_name: 'warranty', weight: 0.5 },
    ];
    const result = validateWeights(weights, defs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'NON_FINITE_WEIGHT')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL: Numerical stability edge cases
// ---------------------------------------------------------------------------

describe('Numerical stability - counter-offer', () => {
  const issue_params = [
    {
      definition: { name: 'price', type: 'scalar' as const, category: 'negotiable' as const, direction: 'lower_better' as const, min: 0, max: 1000 },
      start_value: 100,
      limit_value: 800,
    },
  ];
  const weights = [{ issue_name: 'price', weight: 1.0 }];

  it('beta=0 → step function (no concession before deadline)', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params, weights, t: 5, T: 10, beta: 0,
    });
    // Before deadline: no concession
    expect(result.values.price).toBe(100); // start value
    expect(result.u_target).toBe(1);
  });

  it('beta=0 at deadline → full concession', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params, weights, t: 10, T: 10, beta: 0,
    });
    expect(result.values.price).toBe(800); // limit value
    expect(result.u_target).toBe(0);
  });

  it('T=0 → full concession immediately', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params, weights, t: 0, T: 0, beta: 1,
    });
    expect(result.values.price).toBe(800); // limit value
  });

  it('T negative → full concession', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params, weights, t: 0, T: -5, beta: 1,
    });
    expect(result.values.price).toBe(800);
  });
});

describe('Numerical stability - acceptance threshold', () => {
  it('negative tau → treated as tau=0 (full aspiration)', () => {
    const R = computeAcceptanceThreshold({
      u_batna: 0.3, u_min: 0.4, u_0: 0.9, tau: -0.5, beta: 1,
    });
    expect(Number.isFinite(R)).toBe(true);
    expect(R).toBe(0.9); // tau=0 → aspiration = u_0
  });

  it('beta=0 before deadline → R = u_0', () => {
    const R = computeAcceptanceThreshold({
      u_batna: 0.3, u_min: 0.4, u_0: 0.9, tau: 0.5, beta: 0,
    });
    expect(R).toBe(0.9);
  });

  it('beta=0 at deadline → R = max(u_batna, u_min)', () => {
    const R = computeAcceptanceThreshold({
      u_batna: 0.3, u_min: 0.4, u_0: 0.9, tau: 1.0, beta: 0,
    });
    expect(R).toBe(0.4); // u_min > u_batna
  });

  it('tau > 1 → clamped to 1', () => {
    const R = computeAcceptanceThreshold({
      u_batna: 0.3, u_min: 0.4, u_0: 0.9, tau: 5.0, beta: 1,
    });
    expect(R).toBe(0.4); // tau=1 → aspiration = u_min
  });
});
