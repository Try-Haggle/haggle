import { describe, it, expect } from 'vitest';
import type { IssueDefinition } from '@haggle/engine-core';
import {
  createMultiIssueOpponentModel,
  updateMultiIssueOpponentModel,
} from '../src/round/multi-issue-opponent.js';

// ---------------------------------------------------------------------------
// Direction-aware concession classification
// ---------------------------------------------------------------------------

describe('Direction-aware opponent tracking', () => {
  const priceDef: IssueDefinition = {
    name: 'price',
    type: 'scalar',
    category: 'negotiable',
    direction: 'lower_better',
    min: 0,
    max: 10000,
  };

  const warrantyDef: IssueDefinition = {
    name: 'warranty_days',
    type: 'scalar',
    category: 'negotiable',
    direction: 'higher_better',
    min: 0,
    max: 365,
  };

  it('SELLER lowering price = concession for lower_better issue', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { price: 1000 },
        current: { price: 800 },
        sender_role: 'SELLER',
      },
      [priceDef],
    );

    // Seller lowering price on a lower_better issue = concession (positive)
    expect(updated.issue_trackers['price'].concession_rate).toBeGreaterThan(0);
  });

  it('SELLER raising price = selfish for lower_better issue', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { price: 1000 },
        current: { price: 1200 },
        sender_role: 'SELLER',
      },
      [priceDef],
    );

    // Seller raising price on a lower_better issue = selfish (negative)
    expect(updated.issue_trackers['price'].concession_rate).toBeLessThan(0);
  });

  it('BUYER raising price = concession for lower_better issue', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { price: 800 },
        current: { price: 900 },
        sender_role: 'BUYER',
      },
      [priceDef],
    );

    // Buyer raising price = moving toward seller's preference = concession
    expect(updated.issue_trackers['price'].concession_rate).toBeGreaterThan(0);
  });

  it('SELLER raising warranty = concession for higher_better issue', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { warranty_days: 30 },
        current: { warranty_days: 60 },
        sender_role: 'SELLER',
      },
      [warrantyDef],
    );

    // Seller raising warranty on higher_better = conceding to buyer's preference
    expect(updated.issue_trackers['warranty_days'].concession_rate).toBeGreaterThan(0);
  });

  it('BUYER lowering warranty = concession for higher_better issue', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { warranty_days: 90 },
        current: { warranty_days: 60 },
        sender_role: 'BUYER',
      },
      [warrantyDef],
    );

    // Buyer lowering warranty on higher_better = conceding to seller
    expect(updated.issue_trackers['warranty_days'].concession_rate).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Enum issue tracking
// ---------------------------------------------------------------------------

describe('Enum issue opponent tracking', () => {
  const shippingDef: IssueDefinition = {
    name: 'shipping_method',
    type: 'enum',
    category: 'negotiable',
    direction: 'lower_better',
    values: ['ground', 'priority', 'express'],
  };

  it('tracks enum value changes', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { shipping_method: 'ground' },
        current: { shipping_method: 'priority' },
        sender_role: 'SELLER',
      },
      [shippingDef],
    );

    expect(updated.issue_trackers['shipping_method']).toBeDefined();
    expect(updated.issue_trackers['shipping_method'].move_count).toBe(1);
  });

  it('no change in enum = silent (concession_rate = 0)', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { shipping_method: 'priority' },
        current: { shipping_method: 'priority' },
        sender_role: 'SELLER',
      },
      [shippingDef],
    );

    // Same value → observed = 0, tracker is created but with 0 rate
    expect(updated.issue_trackers['shipping_method'].concession_rate).toBe(0);
  });

  it('enum value not in list is skipped', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { shipping_method: 'teleportation' },
        current: { shipping_method: 'priority' },
        sender_role: 'SELLER',
      },
      [shippingDef],
    );

    // Unknown enum value → skipped
    expect(updated.issue_trackers['shipping_method']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Boolean issue tracking
// ---------------------------------------------------------------------------

describe('Boolean issue opponent tracking', () => {
  const boolDef: IssueDefinition = {
    name: 'include_accessories',
    type: 'boolean',
    category: 'negotiable',
    direction: 'higher_better',
  };

  it('boolean change tracked as moderate concession', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { include_accessories: false },
        current: { include_accessories: true },
        sender_role: 'SELLER',
      },
      [boolDef],
    );

    expect(updated.issue_trackers['include_accessories']).toBeDefined();
    expect(updated.issue_trackers['include_accessories'].concession_rate).toBe(0.5);
  });

  it('boolean same value = silent (concession_rate = 0)', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(
      model,
      {
        previous: { include_accessories: true },
        current: { include_accessories: true },
        sender_role: 'SELLER',
      },
      [boolDef],
    );

    // Boolean same value → observed = 0, tracker is created but with 0 rate
    expect(updated.issue_trackers['include_accessories'].concession_rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Priorities preserved on silent rounds
// ---------------------------------------------------------------------------

describe('Priority preservation on silent rounds', () => {
  const defs: IssueDefinition[] = [
    { name: 'price', type: 'scalar', category: 'negotiable', direction: 'lower_better', min: 0, max: 10000 },
    { name: 'warranty', type: 'scalar', category: 'negotiable', direction: 'higher_better', min: 0, max: 365 },
  ];

  it('priorities preserved when all issues are silent', () => {
    let model = createMultiIssueOpponentModel();

    // Round 1: actual concession
    model = updateMultiIssueOpponentModel(
      model,
      {
        previous: { price: 1000, warranty: 30 },
        current: { price: 900, warranty: 30 },
        sender_role: 'SELLER',
      },
      defs,
    );

    const priorPriorities = { ...model.estimated_priorities };
    expect(Object.keys(priorPriorities).length).toBeGreaterThan(0);

    // Round 2: all silent (same values)
    model = updateMultiIssueOpponentModel(
      model,
      {
        previous: { price: 900, warranty: 30 },
        current: { price: 900, warranty: 30 },
        sender_role: 'SELLER',
      },
      defs,
    );

    // Priorities should be preserved, not wiped
    expect(model.estimated_priorities).toEqual(priorPriorities);
  });
});
