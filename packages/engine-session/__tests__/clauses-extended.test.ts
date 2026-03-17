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
// Helpers
// ---------------------------------------------------------------------------

function makeShippingTerms(
  overrides?: Partial<ShippingTerms>,
): ShippingTerms {
  return {
    base_price: 500,
    tracking_upload_deadline_hours: 4,
    carrier_acceptance_deadline_hours: 24,
    shipping_method: 'priority',
    late_acceptance_rebate_per_24h: 15,
    late_acceptance_rebate_cap: 45,
    cancel_if_no_acceptance_after_hours: 72,
    inspection_window_hours: 48,
    condition_proof_bundle_required: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Extension & Replacement Right Remedies
// ---------------------------------------------------------------------------

describe('evaluateClause — extension remedy', () => {
  const extensionClause: ContingentClause = {
    trigger: 'delivery_delay',
    threshold: 12,
    remedy: {
      type: 'extension',
      params: { hours: 48 },
    },
  };

  it('triggers extension remedy with correct hours', () => {
    const event: ClauseEvent = {
      event_name: 'delivery_delay',
      observed_value: 20,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(extensionClause, event);
    expect(result.triggered).toBe(true);
    expect(result.remedy_result?.type).toBe('extension');
    expect(result.remedy_result?.extension_hours).toBe(48);
  });

  it('does not trigger extension when below threshold', () => {
    const event: ClauseEvent = {
      event_name: 'delivery_delay',
      observed_value: 10,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(extensionClause, event);
    expect(result.triggered).toBe(false);
  });
});

describe('evaluateClause — replacement_right remedy', () => {
  const replacementClause: ContingentClause = {
    trigger: 'condition_mismatch',
    threshold: 0.5,
    remedy: {
      type: 'replacement_right',
      params: {},
    },
  };

  it('triggers replacement_right remedy', () => {
    const event: ClauseEvent = {
      event_name: 'condition_mismatch',
      observed_value: 0.8,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(replacementClause, event);
    expect(result.triggered).toBe(true);
    expect(result.remedy_result?.type).toBe('replacement_right');
  });

  it('does not trigger replacement_right when below threshold', () => {
    const event: ClauseEvent = {
      event_name: 'condition_mismatch',
      observed_value: 0.3,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(replacementClause, event);
    expect(result.triggered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Boundary Conditions
// ---------------------------------------------------------------------------

describe('evaluateClause — boundary conditions', () => {
  const clause: ContingentClause = {
    trigger: 'test_event',
    threshold: 10,
    remedy: {
      type: 'cancel_right',
      params: {},
    },
  };

  it('exactly at threshold is NOT triggered (uses >)', () => {
    const event: ClauseEvent = {
      event_name: 'test_event',
      observed_value: 10,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(clause, event);
    expect(result.triggered).toBe(false);
    expect(result.remedy_result).toBeNull();
  });

  it('just above threshold IS triggered', () => {
    const event: ClauseEvent = {
      event_name: 'test_event',
      observed_value: 10.01,
      timestamp: '2026-03-16T12:00:00Z',
    };
    const result = evaluateClause(clause, event);
    expect(result.triggered).toBe(true);
    expect(result.remedy_result?.cancel_right).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateClauses — batch edge cases
// ---------------------------------------------------------------------------

describe('evaluateClauses — batch edge cases', () => {
  const rebateClause: ContingentClause = {
    trigger: 'carrier_acceptance_after_hours',
    threshold: 24,
    remedy: {
      type: 'price_rebate',
      params: { amount_per_24h: 15, cap: 45 },
    },
  };

  it('multiple events triggering same clause (deduplication)', () => {
    const events: ClauseEvent[] = [
      {
        event_name: 'carrier_acceptance_after_hours',
        observed_value: 50,
        timestamp: '2026-03-16T10:00:00Z',
      },
      {
        event_name: 'carrier_acceptance_after_hours',
        observed_value: 80,
        timestamp: '2026-03-16T14:00:00Z',
      },
    ];

    const results = evaluateClauses([rebateClause], events);
    // Both events trigger the same clause, producing 2 triggered results
    const triggered = results.filter((r) => r.triggered);
    expect(triggered).toHaveLength(2);
    // The clause should NOT appear again as non-triggered
    const nonTriggered = results.filter((r) => !r.triggered);
    expect(nonTriggered).toHaveLength(0);
  });

  it('no matching events — all clauses non-triggered', () => {
    const events: ClauseEvent[] = [
      {
        event_name: 'unrelated_event',
        observed_value: 100,
        timestamp: '2026-03-16T12:00:00Z',
      },
      {
        event_name: 'another_event',
        observed_value: 200,
        timestamp: '2026-03-16T12:00:00Z',
      },
    ];

    const results = evaluateClauses([rebateClause], events);
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(false);
  });

  it('empty clauses array', () => {
    const events: ClauseEvent[] = [
      {
        event_name: 'carrier_acceptance_after_hours',
        observed_value: 50,
        timestamp: '2026-03-16T12:00:00Z',
      },
    ];
    const results = evaluateClauses([], events);
    expect(results).toHaveLength(0);
  });

  it('empty events array', () => {
    const results = evaluateClauses([rebateClause], []);
    expect(results).toHaveLength(1);
    expect(results[0].triggered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shipping Verification — boundary & base_price
// ---------------------------------------------------------------------------

describe('verifyShipping — boundary conditions', () => {
  const terms = makeShippingTerms();

  it('exactly at deadline is fulfilled', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 24,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('fulfilled');
    expect(result.rebate_amount).toBe(0);
    expect(result.cancel_right_activated).toBe(false);
    expect(result.delay_hours).toBe(0);
  });

  it('cancel right exactly at threshold (hours === cancel_if_no_acceptance_after_hours)', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 72,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('late');
    expect(result.cancel_right_activated).toBe(true);
  });

  it('cancel right just below threshold (hours < cancel_if_no_acceptance_after_hours)', () => {
    const event: ShippingEvent = {
      carrier_acceptance_hours: 71,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('late');
    expect(result.cancel_right_activated).toBe(false);
  });
});

describe('verifyShipping — with base_price', () => {
  it('works correctly with different base_price values', () => {
    const terms = makeShippingTerms({ base_price: 1200 });
    const event: ShippingEvent = {
      carrier_acceptance_hours: 50,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('late');
    expect(result.delay_hours).toBe(26);
    // ceil(26/24) = 2 days * $15 = $30
    expect(result.rebate_amount).toBe(30);
  });

  it('fulfilled event with base_price', () => {
    const terms = makeShippingTerms({ base_price: 250 });
    const event: ShippingEvent = {
      carrier_acceptance_hours: 20,
      tracking_uploaded: true,
    };
    const result = verifyShipping(terms, event);
    expect(result.obligation).toBe('fulfilled');
    expect(result.rebate_amount).toBe(0);
  });
});
