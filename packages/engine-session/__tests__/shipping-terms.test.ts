import { describe, expect, it } from 'vitest';
import {
  createHnpShippingTerms,
  validateHnpShippingTerms,
} from '../src/index.js';

describe('HNP shipping terms', () => {
  it('creates hash-bound carrier delivery terms', () => {
    const terms = createHnpShippingTerms({
      method: 'carrier_delivery',
      payer: 'BUYER',
      cost: { currency: 'USD', units_minor: 1_200 },
      carrier: 'USPS',
      service_level: 'Priority',
      insurance_required: true,
      tracking_required: true,
      delivery_sla_days: 3,
      created_at_ms: 1_777_000_000_000,
    });

    expect(terms.terms_id).toMatch(/^ship_[a-f0-9]{24}$/);
    expect(terms.risk_transfer).toBe('delivery_confirmed');
    expect(validateHnpShippingTerms(terms, { verifyHash: true })).toEqual({ ok: true, warnings: [] });
  });

  it('allows local pickup with a valid pickup window', () => {
    const terms = createHnpShippingTerms({
      method: 'local_pickup',
      payer: 'SELLER',
      pickup_window: {
        earliest_at_ms: 1_777_000_000_000,
        latest_at_ms: 1_777_003_600_000,
      },
      created_at_ms: 1_777_000_000_000,
    });

    expect(terms.risk_transfer).toBe('pickup_confirmed');
    expect(validateHnpShippingTerms(terms)).toEqual({ ok: true, warnings: [] });
  });

  it('requires carrier and tracking for carrier delivery', () => {
    const terms = createHnpShippingTerms({
      method: 'carrier_delivery',
      payer: 'BUYER',
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpShippingTerms(terms);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'CARRIER_REQUIRED' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'TRACKING_REQUIRED_FOR_CARRIER' }));
    }
  });

  it('rejects invalid pickup windows and negative costs', () => {
    const terms = createHnpShippingTerms({
      method: 'local_pickup',
      payer: 'SPLIT',
      cost: { currency: 'USD', units_minor: -1 },
      pickup_window: {
        earliest_at_ms: 1_777_003_600_000,
        latest_at_ms: 1_777_000_000_000,
      },
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpShippingTerms(terms);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'NEGATIVE_COST' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_PICKUP_WINDOW' }));
    }
  });

  it('rejects fractional shipping costs and invalid pickup timestamps', () => {
    const terms = createHnpShippingTerms({
      method: 'local_pickup',
      payer: 'BUYER',
      cost: { currency: 'USD', units_minor: 10.5 },
      pickup_window: {
        earliest_at_ms: Number.NaN,
        latest_at_ms: 1_777_000_000_000,
      },
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpShippingTerms(terms);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'NON_INTEGER_COST' }));
      expect(result.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_PICKUP_TIMESTAMP' }));
    }
  });

  it('detects tampered shipping terms', () => {
    const terms = createHnpShippingTerms({
      method: 'carrier_delivery',
      payer: 'BUYER',
      carrier: 'UPS',
      tracking_required: true,
      created_at_ms: 1_777_000_000_000,
    });

    const result = validateHnpShippingTerms({
      ...terms,
      carrier: 'FedEx',
    }, { verifyHash: true });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH' }));
  });
});
