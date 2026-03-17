import { describe, it, expect } from 'vitest';
import {
  evaluateClause,
  evaluateClauses,
  verifyShipping,
} from '../src/clauses/index.js';
import type {
  ContingentClause,
  ShippingTerms,
} from '../src/protocol/hnp-types.js';
import type { ClauseEvent, ShippingEvent } from '../src/clauses/index.js';

// ---------------------------------------------------------------------------
// Apple Electronics v1 Example (Section 18)
// ---------------------------------------------------------------------------

const lateShipRebateClause: ContingentClause = {
  trigger: 'carrier_acceptance_after_hours',
  threshold: 24,
  remedy: {
    type: 'price_rebate',
    params: { amount_per_24h: 15, cap: 45 },
  },
};

const cancelRightClause: ContingentClause = {
  trigger: 'carrier_acceptance_after_hours',
  threshold: 72,
  remedy: {
    type: 'cancel_right',
    params: {},
  },
};

// ---------------------------------------------------------------------------
// evaluateClause
// ---------------------------------------------------------------------------

describe('evaluateClause', () => {
  it('does not trigger when event below threshold', () => {
    const event: ClauseEvent = {
      event_name: 'carrier_acceptance_after_hours',
      observed_value: 20,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(lateShipRebateClause, event);
    expect(result.triggered).toBe(false);
    expect(result.remedy_result).toBeNull();
  });

  it('does not trigger when event name does not match', () => {
    const event: ClauseEvent = {
      event_name: 'some_other_event',
      observed_value: 100,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(lateShipRebateClause, event);
    expect(result.triggered).toBe(false);
  });

  it('triggers price_rebate when over threshold', () => {
    const event: ClauseEvent = {
      event_name: 'carrier_acceptance_after_hours',
      observed_value: 50,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(lateShipRebateClause, event);
    expect(result.triggered).toBe(true);
    expect(result.remedy_result?.type).toBe('price_rebate');
    // 50 - 24 = 26 hours delay → ceil(26/24) = 2 days → 2 * 15 = $30
    expect(result.remedy_result?.amount).toBe(30);
  });

  it('caps rebate amount', () => {
    const event: ClauseEvent = {
      event_name: 'carrier_acceptance_after_hours',
      observed_value: 120,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(lateShipRebateClause, event);
    expect(result.triggered).toBe(true);
    // 120-24 = 96 hours → ceil(96/24) = 4 days → 4*15 = $60, capped at $45
    expect(result.remedy_result?.amount).toBe(45);
  });

  it('triggers cancel_right', () => {
    const event: ClauseEvent = {
      event_name: 'carrier_acceptance_after_hours',
      observed_value: 80,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(cancelRightClause, event);
    expect(result.triggered).toBe(true);
    expect(result.remedy_result?.cancel_right).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateClauses (batch)
// ---------------------------------------------------------------------------

describe('evaluateClauses', () => {
  it('evaluates all clauses against events', () => {
    const clauses = [lateShipRebateClause, cancelRightClause];
    const events: ClauseEvent[] = [
      {
        event_name: 'carrier_acceptance_after_hours',
        observed_value: 80,
        timestamp: '2026-03-16T12:00:00Z',
      },
    ];

    const results = evaluateClauses(clauses, events);

    // Both clauses should be triggered (80 > 24 and 80 > 72)
    const triggered = results.filter((r) => r.triggered);
    expect(triggered).toHaveLength(2);
  });

  it('includes non-triggered clauses', () => {
    const clauses = [lateShipRebateClause, cancelRightClause];
    const events: ClauseEvent[] = [
      {
        event_name: 'carrier_acceptance_after_hours',
        observed_value: 30,
        timestamp: '2026-03-16T12:00:00Z',
      },
    ];

    const results = evaluateClauses(clauses, events);
    // Rebate triggered (30 > 24), cancel not (30 < 72)
    const triggered = results.filter((r) => r.triggered);
    expect(triggered).toHaveLength(1);
    expect(triggered[0].remedy_result?.type).toBe('price_rebate');
  });
});

// ---------------------------------------------------------------------------
// Shipping Verification (Section 9)
// ---------------------------------------------------------------------------

describe('verifyShipping', () => {
  const terms: ShippingTerms = {
    base_price: 500,
    tracking_upload_deadline_hours: 4,
    carrier_acceptance_deadline_hours: 24,
    shipping_method: 'priority',
    late_acceptance_rebate_per_24h: 15,
    late_acceptance_rebate_cap: 45,
    cancel_if_no_acceptance_after_hours: 72,
    inspection_window_hours: 48,
    condition_proof_bundle_required: true,
  };

  it('returns fulfilled when on time', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 20,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('fulfilled');
    expect(result.rebate_amount).toBe(0);
    expect(result.cancel_right_activated).toBe(false);
    expect(result.delay_hours).toBe(0);
  });

  it('returns unverified when no carrier acceptance', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: null,
      tracking_uploaded: false,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('unverified');
  });

  it('computes rebate for late shipment', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 50,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('late');
    expect(result.delay_hours).toBe(26); // 50 - 24
    // ceil(26/24) = 2 days * $15 = $30
    expect(result.rebate_amount).toBe(30);
    expect(result.cancel_right_activated).toBe(false);
  });

  it('caps rebate at configured maximum', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 130,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('late');
    // ceil(106/24) = 5 days * $15 = $75, capped at $45
    expect(result.rebate_amount).toBe(45);
  });

  it('activates cancel right when extremely late', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 80,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('late');
    expect(result.cancel_right_activated).toBe(true);
  });

  it('fulfilled at exact deadline', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 24,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('fulfilled');
  });
});
