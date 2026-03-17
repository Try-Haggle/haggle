import { describe, it, expect } from 'vitest';
import { ELECTRONICS_SHIPPING_V1 } from '@haggle/engine-core';
import {
  createMultiIssueOpponentModel,
  updateMultiIssueOpponentModel,
  estimateReservation,
} from '../src/round/multi-issue-opponent.js';
import type { MultiIssueMoveObservation } from '../src/round/multi-issue-opponent.js';

const definitions = [
  ...ELECTRONICS_SHIPPING_V1.negotiable_issues,
  ...ELECTRONICS_SHIPPING_V1.informational_issues,
];

describe('createMultiIssueOpponentModel', () => {
  it('creates empty model', () => {
    const model = createMultiIssueOpponentModel();
    expect(model.total_rounds).toBe(0);
    expect(model.concession_style).toBe('moderate');
    expect(Object.keys(model.issue_trackers)).toHaveLength(0);
    expect(Object.keys(model.estimated_priorities)).toHaveLength(0);
  });
});

describe('updateMultiIssueOpponentModel', () => {
  it('tracks per-issue concession for seller moves', () => {
    const model = createMultiIssueOpponentModel();
    const obs: MultiIssueMoveObservation = {
      previous: { price: 1000, ship_within_hours: 48 },
      current: { price: 950, ship_within_hours: 36 },
      sender_role: 'SELLER',
    };

    const updated = updateMultiIssueOpponentModel(model, obs, definitions);

    expect(updated.total_rounds).toBe(1);
    // Seller lowering price = concession
    expect(updated.issue_trackers['price'].concession_rate).toBeGreaterThan(0);
    // Seller lowering ship hours = concession (lower is better for buyer)
    expect(updated.issue_trackers['ship_within_hours'].concession_rate).toBeGreaterThan(0);
  });

  it('tracks per-issue concession for buyer moves', () => {
    const model = createMultiIssueOpponentModel();
    const obs: MultiIssueMoveObservation = {
      previous: { price: 800, ship_within_hours: 24 },
      current: { price: 850, ship_within_hours: 24 },
      sender_role: 'BUYER',
    };

    const updated = updateMultiIssueOpponentModel(model, obs, definitions);

    // Buyer raising price = concession
    expect(updated.issue_trackers['price'].concession_rate).toBeGreaterThan(0);
    // Ship hours unchanged = silent (no tracker update or rate = 0)
    expect(updated.issue_trackers['ship_within_hours']?.concession_rate ?? 0).toBeCloseTo(0);
  });

  it('estimates priorities from cumulative concession', () => {
    let model = createMultiIssueOpponentModel();

    // Seller concedes a lot on price, little on shipping
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 1000, ship_within_hours: 48 },
      current: { price: 900, ship_within_hours: 47 },
      sender_role: 'SELLER',
    }, definitions);

    // Price has much higher concession → higher priority estimate
    const pricePriority = model.estimated_priorities['price'] ?? 0;
    const shipPriority = model.estimated_priorities['ship_within_hours'] ?? 0;
    expect(pricePriority).toBeGreaterThan(shipPriority);
  });

  it('classifies aggressive concession style', () => {
    let model = createMultiIssueOpponentModel();

    // Very large concession: 10000→4000 = 6000/10000 = 0.6 normalized
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 10000 },
      current: { price: 4000 },
      sender_role: 'SELLER',
    }, definitions);

    expect(model.concession_style).toBe('aggressive');
  });

  it('classifies slow concession style', () => {
    let model = createMultiIssueOpponentModel();

    // Tiny concession
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 1000 },
      current: { price: 999 },
      sender_role: 'SELLER',
    }, definitions);

    expect(model.concession_style).toBe('slow');
  });

  it('tracks response time via EMA', () => {
    let model = createMultiIssueOpponentModel();

    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 1000 },
      current: { price: 950 },
      sender_role: 'SELLER',
      response_time_ms: 5000,
    }, definitions);

    expect(model.avg_response_time_ms).toBe(5000);

    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 950 },
      current: { price: 920 },
      sender_role: 'SELLER',
      response_time_ms: 3000,
    }, definitions);

    // EMA: 0.3 * 3000 + 0.7 * 5000 = 4400
    expect(model.avg_response_time_ms).toBeCloseTo(4400);
  });

  it('ignores informational issues', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(model, {
      previous: { battery_health: 0.9 },
      current: { battery_health: 0.85 },
      sender_role: 'SELLER',
    }, definitions);

    // battery_health is informational, should not be tracked
    expect(updated.issue_trackers['battery_health']).toBeUndefined();
  });

  it('does not mutate input model', () => {
    const model = createMultiIssueOpponentModel();
    const updated = updateMultiIssueOpponentModel(model, {
      previous: { price: 1000 },
      current: { price: 950 },
      sender_role: 'SELLER',
    }, definitions);

    expect(model.total_rounds).toBe(0);
    expect(updated.total_rounds).toBe(1);
  });
});

describe('estimateReservation', () => {
  it('returns null with insufficient data', () => {
    const model = createMultiIssueOpponentModel();
    expect(estimateReservation(model, 'price', 900)).toBeNull();
  });

  it('returns current value when concession rate near zero', () => {
    let model = createMultiIssueOpponentModel();

    // Two rounds of tiny movement
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 950 },
      current: { price: 949 },
      sender_role: 'SELLER',
    }, definitions);
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 949 },
      current: { price: 949 },
      sender_role: 'SELLER',
    }, definitions);

    // Rate is very low → current value ≈ reservation
    const reservation = estimateReservation(model, 'price', 949);
    expect(reservation).toBe(949);
  });
});
