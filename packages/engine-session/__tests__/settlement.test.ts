import { describe, it, expect } from 'vitest';
import {
  buildSettlementConditions,
  createSmartContractHook,
  createEscrowHook,
  computeAgreementHash,
  transitionSettlement,
  settlementToSessionState,
} from '../src/settlement/index.js';
import type { OfferPayload, ContingentClause } from '../src/protocol/hnp-types.js';

// ---------------------------------------------------------------------------
// Test data (Apple Electronics v1 example from Section 18)
// ---------------------------------------------------------------------------

const sampleClauses: ContingentClause[] = [
  {
    trigger: 'carrier_acceptance_after_hours',
    threshold: 24,
    remedy: { type: 'price_rebate', params: { amount_per_24h: 15, cap: 45 } },
  },
  {
    trigger: 'carrier_acceptance_after_hours',
    threshold: 72,
    remedy: { type: 'cancel_right', params: {} },
  },
];

const sampleOffer: OfferPayload = {
  issues: {
    price: 930,
    ship_within_hours: 24,
    shipping_method: 'priority',
    warranty_days: 30,
  },
  info_snapshot: {
    battery_health: 0.91,
    condition_grade: 'A',
  },
  clauses: sampleClauses,
  currency: 'USD',
  valid_until: '2026-03-16T12:06:00Z',
};

// ---------------------------------------------------------------------------
// buildSettlementConditions
// ---------------------------------------------------------------------------

describe('buildSettlementConditions', () => {
  it('builds conditions from agreed offer with no rebate', () => {
    const cond = buildSettlementConditions('cond_001', sampleOffer);
    expect(cond.condition_id).toBe('cond_001');
    expect(cond.agreed_price).toBe(930);
    expect(cond.currency).toBe('USD');
    expect(cond.rebate_amount).toBe(0);
    expect(cond.net_amount).toBe(930);
    expect(cond.active_clauses).toHaveLength(2);
    expect(cond.buyer_cancel_right).toBe(false);
  });

  it('applies rebate to net amount', () => {
    const cond = buildSettlementConditions('cond_002', sampleOffer, 30);
    expect(cond.agreed_price).toBe(930);
    expect(cond.rebate_amount).toBe(30);
    expect(cond.net_amount).toBe(900);
  });

  it('net amount never goes below 0', () => {
    const cond = buildSettlementConditions('cond_003', sampleOffer, 2000);
    expect(cond.net_amount).toBe(0);
  });

  it('records cancel right', () => {
    const cond = buildSettlementConditions('cond_004', sampleOffer, 0, true);
    expect(cond.buyer_cancel_right).toBe(true);
  });

  it('handles offer without clauses', () => {
    const noClauses: OfferPayload = { ...sampleOffer, clauses: undefined };
    const cond = buildSettlementConditions('cond_005', noClauses);
    expect(cond.active_clauses).toHaveLength(0);
  });

  it('handles offer without price', () => {
    const noPrice: OfferPayload = {
      ...sampleOffer,
      issues: { shipping_method: 'ground' },
    };
    const cond = buildSettlementConditions('cond_006', noPrice);
    expect(cond.agreed_price).toBe(0);
    expect(cond.net_amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hook Builders
// ---------------------------------------------------------------------------

describe('createSmartContractHook', () => {
  it('creates correct hook structure', () => {
    const hook = createSmartContractHook('base', 'USDC', '0xabc', 'cond_001');
    expect(hook.settlement_method).toBe('smart_contract');
    expect(hook.chain).toBe('base');
    expect(hook.payment_token).toBe('USDC');
    expect(hook.agreement_hash).toBe('0xabc');
    expect(hook.settlement_conditions_ref).toBe('cond_001');
  });
});

describe('createEscrowHook', () => {
  it('creates correct hook structure', () => {
    const hook = createEscrowHook('USDC', 'cond_001');
    expect(hook.settlement_method).toBe('escrow');
    expect(hook.payment_token).toBe('USDC');
    expect(hook.chain).toBeUndefined();
    expect(hook.settlement_conditions_ref).toBe('cond_001');
  });
});

// ---------------------------------------------------------------------------
// Agreement Hashing
// ---------------------------------------------------------------------------

describe('computeAgreementHash', () => {
  it('returns deterministic hash', () => {
    const cond = buildSettlementConditions('cond_001', sampleOffer, 30);
    const hash1 = computeAgreementHash('sess_001', sampleOffer, cond);
    const hash2 = computeAgreementHash('sess_001', sampleOffer, cond);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it('different sessions produce different hashes', () => {
    const cond = buildSettlementConditions('cond_001', sampleOffer);
    const hash1 = computeAgreementHash('sess_001', sampleOffer, cond);
    const hash2 = computeAgreementHash('sess_002', sampleOffer, cond);
    expect(hash1).not.toBe(hash2);
  });

  it('different prices produce different hashes', () => {
    const cond1 = buildSettlementConditions('c', sampleOffer);
    const offer2: OfferPayload = {
      ...sampleOffer,
      issues: { ...sampleOffer.issues, price: 900 },
    };
    const cond2 = buildSettlementConditions('c', offer2);
    const hash1 = computeAgreementHash('s', sampleOffer, cond1);
    const hash2 = computeAgreementHash('s', offer2, cond2);
    expect(hash1).not.toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Settlement State Machine
// ---------------------------------------------------------------------------

describe('transitionSettlement', () => {
  it('PROPOSED → READY on ready event', () => {
    expect(transitionSettlement('PROPOSED', 'ready')).toBe('READY');
  });

  it('PROPOSED → FAILED on fail event', () => {
    expect(transitionSettlement('PROPOSED', 'fail')).toBe('FAILED');
  });

  it('PROPOSED → CANCELLED on cancel event', () => {
    expect(transitionSettlement('PROPOSED', 'cancel')).toBe('CANCELLED');
  });

  it('READY → CONFIRMED on confirm event', () => {
    expect(transitionSettlement('READY', 'confirm')).toBe('CONFIRMED');
  });

  it('READY → FAILED on fail event', () => {
    expect(transitionSettlement('READY', 'fail')).toBe('FAILED');
  });

  it('returns null for terminal state transitions', () => {
    expect(transitionSettlement('CONFIRMED', 'ready')).toBeNull();
    expect(transitionSettlement('FAILED', 'ready')).toBeNull();
    expect(transitionSettlement('CANCELLED', 'confirm')).toBeNull();
  });

  it('returns null for invalid transitions', () => {
    expect(transitionSettlement('PROPOSED', 'confirm')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Settlement ↔ Session State Mapping
// ---------------------------------------------------------------------------

describe('settlementToSessionState', () => {
  it('maps PROPOSED to SETTLEMENT_PENDING', () => {
    expect(settlementToSessionState('PROPOSED')).toBe('SETTLEMENT_PENDING');
  });

  it('maps READY to SETTLEMENT_PENDING', () => {
    expect(settlementToSessionState('READY')).toBe('SETTLEMENT_PENDING');
  });

  it('maps CONFIRMED to SETTLED', () => {
    expect(settlementToSessionState('CONFIRMED')).toBe('SETTLED');
  });

  it('maps FAILED to DISPUTED', () => {
    expect(settlementToSessionState('FAILED')).toBe('DISPUTED');
  });

  it('maps CANCELLED to CANCELLED', () => {
    expect(settlementToSessionState('CANCELLED')).toBe('CANCELLED');
  });
});
