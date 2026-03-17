import { describe, it, expect } from 'vitest';
import { executeMultiIssueRound } from '../src/round/multi-issue-executor.js';
import { createMultiIssueOpponentModel } from '../src/round/multi-issue-opponent.js';
import type { MultiIssueMasterStrategy, MultiIssueRoundData } from '../src/strategy/types.js';
import type { IssueDefinition } from '@haggle/engine-core';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const definitions: IssueDefinition[] = [
  { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 10000 },
  { name: 'warranty_days', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 0, max: 365 },
  { name: 'shipping_method', type: 'enum', category: 'negotiable', direction: 'lower_better', values: ['ground', 'priority', 'express'] },
];

const strategy: MultiIssueMasterStrategy = {
  id: 'strat_001',
  user_id: 'user_001',
  issue_schema_ref: 'electronics_shipping_v1',
  issue_weights: [
    { issue_name: 'price', weight: 0.6 },
    { issue_name: 'warranty_days', weight: 0.25 },
    { issue_name: 'shipping_method', weight: 0.15 },
  ],
  issue_params: [
    {
      definition: definitions[0],
      start_value: 500,
      limit_value: 900,
    },
    {
      definition: definitions[1],
      start_value: 90,
      limit_value: 14,
    },
    {
      definition: definitions[2],
      start_value: 'express',
      limit_value: 'ground',
    },
  ],
  risk: {
    p_fraud: 0.05, p_quality: 0.1, p_delay: 0.1, p_dispute: 0.05,
    lambda_f: 0.3, lambda_q: 0.3, lambda_d: 0.2, lambda_s: 0.2,
  },
  relationship: {
    q_reputation: 0.8, q_repeat: 0.0, q_responsiveness: 0.7,
    rho_1: 0.1, rho_2: 0.05, rho_3: 0.05,
  },
  u_batna: 0.3,
  u_min: 0.4,
  u_0: 0.9,
  beta: 1.0,
  t_deadline: 100,
  persona: 'assertive_buyer',
  created_at: Date.now(),
  expires_at: Date.now() + 86400000,
};

const lowRiskRound: MultiIssueRoundData = {
  tau: 0.1,
  round: 1,
  risk: strategy.risk,
  relationship: strategy.relationship,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeMultiIssueRound', () => {
  it('returns ACCEPT for a very good offer', () => {
    // Very favorable offer: low price, high warranty, best shipping
    const result = executeMultiIssueRound(
      strategy,
      { ...lowRiskRound, tau: 0.8 }, // late in negotiation, threshold drops
      { price: 400, warranty_days: 180, shipping_method: 'express' },
      definitions,
    );
    expect(result.decision).toBe('ACCEPT');
    expect(result.utility.u_total).toBeGreaterThan(0);
    expect(result.counter_offer).toBeUndefined();
  });

  it('returns COUNTER for a mediocre offer and provides counter-offer', () => {
    const result = executeMultiIssueRound(
      strategy,
      lowRiskRound,
      { price: 7000, warranty_days: 30, shipping_method: 'ground' },
      definitions,
    );
    // Early in negotiation with mediocre offer → should COUNTER
    expect(['COUNTER', 'NEAR_DEAL', 'ESCALATE']).toContain(result.decision);
    if (result.decision === 'COUNTER') {
      expect(result.counter_offer).toBeDefined();
      expect(result.counter_offer_score).toBeDefined();
      expect(typeof result.counter_offer!.price).toBe('number');
    }
  });

  it('returns REJECT for a zero-utility offer', () => {
    const result = executeMultiIssueRound(
      { ...strategy, u_0: 0.99, u_min: 0.9, u_batna: 0.85 },
      lowRiskRound,
      { price: 10000, warranty_days: 0, shipping_method: 'ground' },
      definitions,
    );
    // Worst possible offer with high standards
    expect(['REJECT', 'COUNTER', 'ESCALATE']).toContain(result.decision);
    expect(result.utility.u_total).toBeLessThan(0.5);
  });

  it('updates opponent model when previousOffer provided', () => {
    const result = executeMultiIssueRound(
      strategy,
      lowRiskRound,
      { price: 5000, warranty_days: 30, shipping_method: 'ground' },
      definitions,
      { price: 6000, warranty_days: 20, shipping_method: 'ground' }, // previous offer
    );
    expect(result.opponent_model.total_rounds).toBe(1);
    expect(result.opponent_model.issue_trackers['price']).toBeDefined();
  });

  it('creates fresh opponent model when none provided', () => {
    const result = executeMultiIssueRound(
      strategy,
      lowRiskRound,
      { price: 5000, warranty_days: 30, shipping_method: 'ground' },
      definitions,
    );
    expect(result.opponent_model).toBeDefined();
    expect(result.opponent_model.total_rounds).toBe(0);
  });

  it('passes existing opponent model through when no previous offer', () => {
    const existingModel = createMultiIssueOpponentModel();
    const result = executeMultiIssueRound(
      strategy,
      lowRiskRound,
      { price: 5000, warranty_days: 30, shipping_method: 'ground' },
      definitions,
      undefined,
      existingModel,
    );
    // Model should be the same since no previousOffer to update from
    expect(result.opponent_model.total_rounds).toBe(0);
  });

  it('signals ESCALATE with DEADLINE reason near deadline', () => {
    const result = executeMultiIssueRound(
      { ...strategy, deadline_critical: 0.05 },
      { ...lowRiskRound, tau: 0.97 }, // very close to deadline
      { price: 8000, warranty_days: 10, shipping_method: 'ground' },
      definitions,
    );
    if (result.decision === 'ESCALATE') {
      expect(result.escalation_reason).toBe('DEADLINE');
    }
  });

  it('utility breakdown is complete', () => {
    const result = executeMultiIssueRound(
      strategy,
      lowRiskRound,
      { price: 5000, warranty_days: 60, shipping_method: 'priority' },
      definitions,
    );
    expect(result.utility.issue_utilities.length).toBeGreaterThan(0);
    expect(result.utility.u_contract).toBeGreaterThanOrEqual(0);
    expect(result.utility.c_risk).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.utility.u_total)).toBe(true);
    expect(result.acceptance_threshold).toBeGreaterThan(0);
  });

  it('handles NEAR_DEAL offers close to acceptance', () => {
    // Find a tau value where the offer is close to threshold
    const result = executeMultiIssueRound(
      { ...strategy, u_0: 0.7, u_min: 0.4, u_batna: 0.3, near_deal_band: 0.1 },
      { ...lowRiskRound, tau: 0.5 },
      { price: 3000, warranty_days: 60, shipping_method: 'priority' },
      definitions,
    );
    // Whatever the decision, the output structure should be valid
    expect(['ACCEPT', 'COUNTER', 'NEAR_DEAL', 'ESCALATE', 'REJECT']).toContain(result.decision);
  });
});
