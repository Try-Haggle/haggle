import { describe, it, expect } from 'vitest';
import {
  computeScalarUtility,
  computeDeadlineUtility,
  computeEnumUtility,
  computeBooleanUtility,
  computeIssueUtility,
  computeContractUtility,
  computeRiskCost,
  computeRelationshipBonus,
  computeMultiIssueUtility,
  computeAcceptanceThreshold,
  ELECTRONICS_SHIPPING_V1,
} from '../src/index.js';
import type {
  IssueDefinition,
  RiskCostParams,
  RelationshipBonusParams,
  AcceptanceThresholdParams,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Scalar Utility
// ---------------------------------------------------------------------------

describe('computeScalarUtility', () => {
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

  it('lower_better: min value gives utility 1', () => {
    expect(computeScalarUtility(800, priceDef)).toBeCloseTo(1.0);
  });

  it('lower_better: max value gives utility 0', () => {
    expect(computeScalarUtility(1200, priceDef)).toBeCloseTo(0.0);
  });

  it('lower_better: midpoint gives utility 0.5', () => {
    expect(computeScalarUtility(1000, priceDef)).toBeCloseTo(0.5);
  });

  it('higher_better: max value gives utility 1', () => {
    expect(computeScalarUtility(365, warrantyDef)).toBeCloseTo(1.0);
  });

  it('higher_better: min value gives utility 0', () => {
    expect(computeScalarUtility(0, warrantyDef)).toBeCloseTo(0.0);
  });

  it('clamps values below min', () => {
    expect(computeScalarUtility(500, priceDef)).toBeCloseTo(1.0);
  });

  it('clamps values above max', () => {
    expect(computeScalarUtility(1500, priceDef)).toBeCloseTo(0.0);
  });

  it('returns 0 for zero range', () => {
    const zeroDef: IssueDefinition = {
      name: 'x', type: 'scalar', category: 'negotiable', min: 5, max: 5,
    };
    expect(computeScalarUtility(5, zeroDef)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Deadline Utility
// ---------------------------------------------------------------------------

describe('computeDeadlineUtility', () => {
  const shipDef: IssueDefinition = {
    name: 'ship_within_hours',
    type: 'deadline',
    category: 'negotiable',
    direction: 'lower_better',
    min: 1,
    max: 168,
  };

  it('fastest shipping (min) gives utility 1', () => {
    expect(computeDeadlineUtility(1, shipDef)).toBeCloseTo(1.0);
  });

  it('slowest shipping (max) gives utility 0', () => {
    expect(computeDeadlineUtility(168, shipDef)).toBeCloseTo(0.0);
  });

  it('defaults to lower_better if no direction', () => {
    const noDirDef: IssueDefinition = {
      name: 'deadline', type: 'deadline', category: 'negotiable', min: 0, max: 100,
    };
    // lower_better: value 0 → utility 1
    expect(computeDeadlineUtility(0, noDirDef)).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// Enum Utility
// ---------------------------------------------------------------------------

describe('computeEnumUtility', () => {
  const shippingDef: IssueDefinition = {
    name: 'shipping_method',
    type: 'enum',
    category: 'negotiable',
    direction: 'higher_better',
    values: ['ground', 'priority', 'express'],
  };

  it('higher_better: last value gives utility 1', () => {
    expect(computeEnumUtility('express', shippingDef)).toBeCloseTo(1.0);
  });

  it('higher_better: first value gives utility 0', () => {
    expect(computeEnumUtility('ground', shippingDef)).toBeCloseTo(0.0);
  });

  it('higher_better: middle value gives utility 0.5', () => {
    expect(computeEnumUtility('priority', shippingDef)).toBeCloseTo(0.5);
  });

  it('unknown value gives utility 0', () => {
    expect(computeEnumUtility('drone', shippingDef)).toBe(0);
  });

  it('lower_better: first value gives utility 1', () => {
    const lowerDef: IssueDefinition = {
      name: 'grade', type: 'enum', category: 'negotiable',
      direction: 'lower_better', values: ['A', 'B', 'C', 'D'],
    };
    expect(computeEnumUtility('A', lowerDef)).toBeCloseTo(1.0);
    expect(computeEnumUtility('D', lowerDef)).toBeCloseTo(0.0);
  });

  it('single-value enum gives utility 1', () => {
    const singleDef: IssueDefinition = {
      name: 'only', type: 'enum', category: 'negotiable', values: ['one'],
    };
    expect(computeEnumUtility('one', singleDef)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Boolean Utility
// ---------------------------------------------------------------------------

describe('computeBooleanUtility', () => {
  it('higher_better: true = 1, false = 0', () => {
    const def: IssueDefinition = {
      name: 'has_feature', type: 'boolean', category: 'negotiable', direction: 'higher_better',
    };
    expect(computeBooleanUtility(true, def)).toBe(1);
    expect(computeBooleanUtility(false, def)).toBe(0);
  });

  it('lower_better: true = 0, false = 1', () => {
    const def: IssueDefinition = {
      name: 'requires_deposit', type: 'boolean', category: 'negotiable', direction: 'lower_better',
    };
    expect(computeBooleanUtility(true, def)).toBe(0);
    expect(computeBooleanUtility(false, def)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeIssueUtility dispatch
// ---------------------------------------------------------------------------

describe('computeIssueUtility', () => {
  it('dispatches scalar correctly', () => {
    const def: IssueDefinition = {
      name: 'price', type: 'scalar', category: 'negotiable',
      direction: 'lower_better', min: 0, max: 100,
    };
    expect(computeIssueUtility(25, def)).toBeCloseTo(0.75);
  });

  it('dispatches enum correctly', () => {
    const def: IssueDefinition = {
      name: 'method', type: 'enum', category: 'negotiable',
      direction: 'higher_better', values: ['a', 'b'],
    };
    expect(computeIssueUtility('b', def)).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// Contract Utility
// ---------------------------------------------------------------------------

describe('computeContractUtility', () => {
  it('computes weighted sum of issue utilities', () => {
    const allDefs = [
      ...ELECTRONICS_SHIPPING_V1.negotiable_issues,
      ...ELECTRONICS_SHIPPING_V1.informational_issues,
    ];

    const result = computeContractUtility({
      definitions: allDefs,
      weights: [
        { issue_name: 'price', weight: 0.55 },
        { issue_name: 'ship_within_hours', weight: 0.10 },
        { issue_name: 'shipping_method', weight: 0.05 },
        { issue_name: 'warranty_days', weight: 0.15 },
        { issue_name: 'battery_health', weight: 0.10 },
        { issue_name: 'condition_grade', weight: 0.05 },
      ],
      negotiable_values: {
        price: 930,
        ship_within_hours: 24,
        shipping_method: 'priority',
        warranty_days: 30,
      },
      informational_values: {
        battery_health: 0.91,
        condition_grade: 'A',
      },
    });

    // Per-issue breakdowns should exist
    expect(result.issue_utilities).toHaveLength(6);
    expect(result.u_contract).toBeGreaterThan(0);
    expect(result.u_contract).toBeLessThanOrEqual(1);

    // price=930 in [0,10000] lower_better → (10000-930)/10000 = 0.907
    const priceUtility = result.issue_utilities.find((u) => u.issue_name === 'price');
    expect(priceUtility?.utility).toBeCloseTo(0.907, 2);
  });

  it('handles missing issue values gracefully', () => {
    const result = computeContractUtility({
      definitions: ELECTRONICS_SHIPPING_V1.negotiable_issues,
      weights: [{ issue_name: 'price', weight: 1.0 }],
      negotiable_values: { price: 500 },
    });
    expect(result.issue_utilities).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Risk Cost
// ---------------------------------------------------------------------------

describe('computeRiskCost', () => {
  it('computes weighted risk sum', () => {
    const params: RiskCostParams = {
      p_fraud: 0.05,
      p_quality: 0.10,
      p_delay: 0.15,
      p_dispute: 0.02,
      lambda_f: 0.3,
      lambda_q: 0.3,
      lambda_d: 0.3,
      lambda_s: 0.1,
    };
    // 0.3*0.05 + 0.3*0.10 + 0.3*0.15 + 0.1*0.02 = 0.015 + 0.03 + 0.045 + 0.002 = 0.092
    expect(computeRiskCost(params)).toBeCloseTo(0.092);
  });

  it('returns 0 when all probabilities are 0', () => {
    const params: RiskCostParams = {
      p_fraud: 0, p_quality: 0, p_delay: 0, p_dispute: 0,
      lambda_f: 0.25, lambda_q: 0.25, lambda_d: 0.25, lambda_s: 0.25,
    };
    expect(computeRiskCost(params)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Relationship Bonus
// ---------------------------------------------------------------------------

describe('computeRelationshipBonus', () => {
  it('computes weighted relationship sum', () => {
    const params: RelationshipBonusParams = {
      q_reputation: 0.9,
      q_repeat: 0.5,
      q_responsiveness: 0.8,
      rho_1: 0.5,
      rho_2: 0.3,
      rho_3: 0.2,
    };
    // 0.5*0.9 + 0.3*0.5 + 0.2*0.8 = 0.45 + 0.15 + 0.16 = 0.76
    expect(computeRelationshipBonus(params)).toBeCloseTo(0.76);
  });
});

// ---------------------------------------------------------------------------
// Multi-Issue Total Utility
// ---------------------------------------------------------------------------

describe('computeMultiIssueUtility', () => {
  it('computes U_total = clip(U_contract - C_risk + B_rel, 0, 1)', () => {
    const result = computeMultiIssueUtility({
      contract: {
        definitions: ELECTRONICS_SHIPPING_V1.negotiable_issues,
        weights: [
          { issue_name: 'price', weight: 0.55 },
          { issue_name: 'ship_within_hours', weight: 0.15 },
          { issue_name: 'shipping_method', weight: 0.10 },
          { issue_name: 'warranty_days', weight: 0.20 },
        ],
        negotiable_values: {
          price: 930,
          ship_within_hours: 24,
          shipping_method: 'priority',
          warranty_days: 30,
        },
      },
      risk: {
        p_fraud: 0.05, p_quality: 0.10, p_delay: 0.05, p_dispute: 0.02,
        lambda_f: 0.3, lambda_q: 0.3, lambda_d: 0.3, lambda_s: 0.1,
      },
      relationship: {
        q_reputation: 0.85, q_repeat: 0.3, q_responsiveness: 0.7,
        rho_1: 0.5, rho_2: 0.3, rho_3: 0.2,
      },
    });

    expect(result.u_total).toBeGreaterThan(0);
    expect(result.u_total).toBeLessThanOrEqual(1);
    expect(result.u_contract).toBeGreaterThan(0);
    expect(result.c_risk).toBeGreaterThan(0);
    expect(result.b_rel).toBeGreaterThan(0);
    expect(result.issue_utilities.length).toBe(4);
  });

  it('clamps u_total to [0, 1]', () => {
    // High risk, low contract → should clamp to 0
    const result = computeMultiIssueUtility({
      contract: {
        definitions: [
          { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 100 },
        ],
        weights: [{ issue_name: 'price', weight: 1.0 }],
        negotiable_values: { price: 100 }, // worst price → utility 0
      },
      risk: {
        p_fraud: 1.0, p_quality: 1.0, p_delay: 1.0, p_dispute: 1.0,
        lambda_f: 0.25, lambda_q: 0.25, lambda_d: 0.25, lambda_s: 0.25,
      },
      relationship: {
        q_reputation: 0, q_repeat: 0, q_responsiveness: 0,
        rho_1: 0.33, rho_2: 0.33, rho_3: 0.34,
      },
    });

    expect(result.u_total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Acceptance Threshold
// ---------------------------------------------------------------------------

describe('computeAcceptanceThreshold', () => {
  it('at tau=0, threshold equals u_0 (initial aspiration)', () => {
    const params: AcceptanceThresholdParams = {
      u_batna: 0.3, u_min: 0.4, u_0: 0.9, tau: 0, beta: 1.0,
    };
    expect(computeAcceptanceThreshold(params)).toBeCloseTo(0.9);
  });

  it('at tau=1, threshold drops to max(u_batna, u_min)', () => {
    const params: AcceptanceThresholdParams = {
      u_batna: 0.3, u_min: 0.4, tau: 1.0, u_0: 0.9, beta: 1.0,
    };
    expect(computeAcceptanceThreshold(params)).toBeCloseTo(0.4);
  });

  it('never drops below u_batna', () => {
    const params: AcceptanceThresholdParams = {
      u_batna: 0.6, u_min: 0.3, u_0: 0.9, tau: 1.0, beta: 1.0,
    };
    // u_min=0.3 but u_batna=0.6, so threshold = 0.6
    expect(computeAcceptanceThreshold(params)).toBeCloseTo(0.6);
  });

  it('higher beta means slower concession', () => {
    const base: Omit<AcceptanceThresholdParams, 'beta'> = {
      u_batna: 0.2, u_min: 0.3, u_0: 0.9, tau: 0.5,
    };
    const slowR = computeAcceptanceThreshold({ ...base, beta: 3.0 });
    const fastR = computeAcceptanceThreshold({ ...base, beta: 0.5 });
    // Higher beta → higher threshold at same time point
    expect(slowR).toBeGreaterThan(fastR);
  });
});

// ---------------------------------------------------------------------------
// Electronics Schema Smoke Test
// ---------------------------------------------------------------------------

describe('ELECTRONICS_SHIPPING_V1', () => {
  it('has 4 negotiable and 2 informational issues', () => {
    expect(ELECTRONICS_SHIPPING_V1.negotiable_issues).toHaveLength(4);
    expect(ELECTRONICS_SHIPPING_V1.informational_issues).toHaveLength(2);
  });

  it('supports conditional terms', () => {
    expect(ELECTRONICS_SHIPPING_V1.conditional_terms_supported).toBe(true);
  });

  it('has correct schema id', () => {
    expect(ELECTRONICS_SHIPPING_V1.schema_id).toBe('electronics_shipping_v1');
  });
});
