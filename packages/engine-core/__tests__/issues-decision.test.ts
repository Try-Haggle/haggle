import { describe, it, expect } from 'vitest';
import {
  makeMultiIssueDecision,
  computeMultiIssueCounterOffer,
  computeMoveCost,
  ELECTRONICS_SHIPPING_V1,
} from '../src/index.js';
import type {
  MultiIssueUtilityResult,
  AcceptanceThresholdParams,
  MultiIssueDecisionInput,
  IssueFaratinParams,
  IssueDefinition,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUtility(u_total: number): MultiIssueUtilityResult {
  return {
    issue_utilities: [],
    u_contract: u_total,
    c_risk: 0,
    b_rel: 0,
    u_total,
  };
}

function makeThreshold(overrides?: Partial<AcceptanceThresholdParams>): AcceptanceThresholdParams {
  return {
    u_batna: 0.3,
    u_min: 0.4,
    u_0: 0.9,
    tau: 0.5,
    beta: 1.0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Multi-Issue Decision
// ---------------------------------------------------------------------------

describe('makeMultiIssueDecision', () => {
  it('ACCEPT when utility >= threshold', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.85),
      threshold_params: makeThreshold({ tau: 0.5 }),
      // R(0.5) = max(0.3, 0.4 + 0.5 * (1 - 0.5^1)) = max(0.3, 0.65) = 0.65
      tau: 0.5,
      rounds_no_concession: 0,
    });
    expect(result.action).toBe('ACCEPT');
    expect(result.utility_gap).toBeGreaterThan(0);
  });

  it('COUNTER when utility < threshold but > 0', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.4),
      threshold_params: makeThreshold({ tau: 0.3 }),
      tau: 0.3,
      rounds_no_concession: 0,
    });
    expect(result.action).toBe('COUNTER');
    expect(result.utility_gap).toBeLessThan(0);
  });

  it('REJECT when utility is 0', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0),
      threshold_params: makeThreshold(),
      tau: 0.5,
      rounds_no_concession: 0,
    });
    expect(result.action).toBe('REJECT');
  });

  it('ESCALATE on stall (4+ rounds no concession)', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.3),
      threshold_params: makeThreshold(),
      tau: 0.5,
      rounds_no_concession: 4,
    });
    expect(result.action).toBe('ESCALATE');
  });

  it('ESCALATE near deadline with no deal', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.3),
      threshold_params: makeThreshold({ tau: 0.96 }),
      tau: 0.96,
      rounds_no_concession: 0,
    });
    expect(result.action).toBe('ESCALATE');
  });

  it('custom stall threshold', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.3),
      threshold_params: makeThreshold(),
      tau: 0.5,
      rounds_no_concession: 2,
      stall_threshold: 2,
    });
    expect(result.action).toBe('ESCALATE');
  });

  it('returns acceptance_threshold in result', () => {
    const result = makeMultiIssueDecision({
      utility: makeUtility(0.5),
      threshold_params: makeThreshold({ tau: 0.5 }),
      tau: 0.5,
      rounds_no_concession: 0,
    });
    expect(result.acceptance_threshold).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-Issue Counter-Offer
// ---------------------------------------------------------------------------

describe('computeMultiIssueCounterOffer', () => {
  const priceDef = ELECTRONICS_SHIPPING_V1.negotiable_issues[0]; // price
  const shipDef = ELECTRONICS_SHIPPING_V1.negotiable_issues[1]; // ship_within_hours
  const methodDef = ELECTRONICS_SHIPPING_V1.negotiable_issues[2]; // shipping_method
  const warrantyDef = ELECTRONICS_SHIPPING_V1.negotiable_issues[3]; // warranty_days

  const issueParams: IssueFaratinParams[] = [
    { definition: priceDef, start_value: 800, limit_value: 1000 },
    { definition: shipDef, start_value: 12, limit_value: 72 },
    { definition: methodDef, start_value: 'express', limit_value: 'ground' },
    { definition: warrantyDef, start_value: 90, limit_value: 14 },
  ];

  const weights = [
    { issue_name: 'price', weight: 0.55 },
    { issue_name: 'ship_within_hours', weight: 0.15 },
    { issue_name: 'shipping_method', weight: 0.10 },
    { issue_name: 'warranty_days', weight: 0.20 },
  ];

  it('at t=0, returns start values (no concession)', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params: issueParams,
      weights,
      t: 0,
      T: 100,
      beta: 1.0,
    });
    expect(result.values.price).toBe(800);
    expect(result.values.ship_within_hours).toBe(12);
    expect(result.values.shipping_method).toBe('express');
    expect(result.values.warranty_days).toBe(90);
    expect(result.u_target).toBeCloseTo(1.0);
  });

  it('at t=T, returns limit values (full concession)', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params: issueParams,
      weights,
      t: 100,
      T: 100,
      beta: 1.0,
    });
    expect(result.values.price).toBe(1000);
    expect(result.values.ship_within_hours).toBe(72);
    expect(result.values.shipping_method).toBe('ground');
    expect(result.values.warranty_days).toBe(14);
    expect(result.u_target).toBeCloseTo(0.0);
  });

  it('at midpoint with beta=1, concedes linearly', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params: issueParams,
      weights,
      t: 50,
      T: 100,
      beta: 1.0,
    });
    // With beta=1, concession_ratio = (50/100)^(1/1) = 0.5
    expect(result.values.price).toBeCloseTo(900); // 800 + 200*0.5
    expect(result.values.ship_within_hours).toBeCloseTo(42); // 12 + 60*0.5
    expect(result.values.warranty_days).toBeCloseTo(52); // 90 + (14-90)*0.5
  });

  it('beta < 1 (boulware) concedes slower than beta > 1 (conceder)', () => {
    const boulware = computeMultiIssueCounterOffer({
      issue_params: issueParams, weights, t: 50, T: 100, beta: 0.5,
    });
    const conceder = computeMultiIssueCounterOffer({
      issue_params: issueParams, weights, t: 50, T: 100, beta: 3.0,
    });
    // Boulware (beta<1): price closer to start (800), conceder: closer to limit (1000)
    expect(boulware.values.price as number).toBeLessThan(conceder.values.price as number);
  });

  it('handles t > T gracefully (clamps to limit)', () => {
    const result = computeMultiIssueCounterOffer({
      issue_params: issueParams, weights, t: 200, T: 100, beta: 1.0,
    });
    expect(result.values.price).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Move Cost
// ---------------------------------------------------------------------------

describe('computeMoveCost', () => {
  const defs: IssueDefinition[] = [
    { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 1000 },
    { name: 'method', type: 'enum', category: 'negotiable', direction: 'higher_better', values: ['a', 'b'] },
  ];
  const weights = [
    { issue_name: 'price', weight: 0.7 },
    { issue_name: 'method', weight: 0.3 },
  ];

  it('returns 0 for identical offers', () => {
    const offer = { price: 500, method: 'a' };
    expect(computeMoveCost(offer, offer, defs, weights)).toBe(0);
  });

  it('computes weighted normalized cost', () => {
    const current = { price: 600, method: 'a' };
    const previous = { price: 500, method: 'a' };
    // price move: 0.7 * (100/1000) = 0.07; enum: no change = 0
    expect(computeMoveCost(current, previous, defs, weights)).toBeCloseTo(0.07);
  });

  it('includes enum change cost', () => {
    const current = { price: 500, method: 'b' };
    const previous = { price: 500, method: 'a' };
    // price: 0; enum: 0.3 * 1 = 0.3
    expect(computeMoveCost(current, previous, defs, weights)).toBeCloseTo(0.3);
  });
});
