import { describe, it, expect } from 'vitest';
import {
  createNegotiationExtension,
  NEGOTIATION_EXTENSION_KEY,
  NEGOTIATION_EXTENSION_SCHEMA,
} from '../src/index.js';

describe('createNegotiationExtension', () => {
  it('creates a pending extension with correct defaults', () => {
    const ext = createNegotiationExtension({
      sessionId: 'hnp_abc123',
      originalPrice: 25000, // $250.00 in minor units
      role: 'BUYER',
      priceFloor: 20000,
      priceCeiling: 25000,
      deadline: '2026-03-05T12:00:00Z',
    });

    expect(ext.session_id).toBe('hnp_abc123');
    expect(ext.status).toBe('pending');
    expect(ext.original_price).toBe(25000);
    expect(ext.current_offer).toBeNull();
    expect(ext.counter_offer).toBeNull();
    expect(ext.round).toBe(0);
    expect(ext.role).toBe('BUYER');
    expect(ext.utility_score).toBeNull();
    expect(ext.decision).toBeNull();
    expect(ext.constraints.price_floor).toBe(20000);
    expect(ext.constraints.price_ceiling).toBe(25000);
    expect(ext.constraints.deadline).toBe('2026-03-05T12:00:00Z');
  });

  it('creates seller-side extension', () => {
    const ext = createNegotiationExtension({
      sessionId: 'hnp_seller_1',
      originalPrice: 50000,
      role: 'SELLER',
      priceFloor: 40000,
      priceCeiling: 50000,
      deadline: '2026-04-01T00:00:00Z',
    });

    expect(ext.role).toBe('SELLER');
    expect(ext.original_price).toBe(50000);
  });
});

describe('NEGOTIATION_EXTENSION_KEY', () => {
  it('is ai.tryhaggle.negotiation', () => {
    expect(NEGOTIATION_EXTENSION_KEY).toBe('ai.tryhaggle.negotiation');
  });
});

describe('NEGOTIATION_EXTENSION_SCHEMA', () => {
  it('has required fields', () => {
    const required = NEGOTIATION_EXTENSION_SCHEMA.required;
    expect(required).toContain('session_id');
    expect(required).toContain('status');
    expect(required).toContain('original_price');
    expect(required).toContain('round');
    expect(required).toContain('role');
    expect(required).toContain('constraints');
  });

  it('defines valid status enum', () => {
    const statusEnum = NEGOTIATION_EXTENSION_SCHEMA.properties.status.enum;
    expect(statusEnum).toContain('pending');
    expect(statusEnum).toContain('active');
    expect(statusEnum).toContain('agreed');
    expect(statusEnum).toContain('rejected');
    expect(statusEnum).toContain('expired');
  });

  it('has the correct $id', () => {
    expect(NEGOTIATION_EXTENSION_SCHEMA.$id).toBe(
      'https://tryhaggle.ai/ucp/negotiation-schema.json',
    );
  });
});
