/**
 * E2E Integration Test: Apple Electronics v1
 *
 * Validates the full negotiation lifecycle from the Unified Model Document:
 * Listing → Session → Offer/Counter → Decision → Agreement → Clauses → Settlement
 *
 * Based on Section 18 (Appendix: Apple Electronics v1 Example).
 */

import { describe, it, expect } from 'vitest';
import {
  computeMultiIssueUtility,
  computeAcceptanceThreshold,
  makeMultiIssueDecision,
  computeMultiIssueCounterOffer,
  computeMoveCost,
  ELECTRONICS_SHIPPING_V1,
} from '@haggle/engine-core';
import type {
  IssueWeight,
  AcceptanceThresholdParams,
  IssueFaratinParams,
  MultiIssueUtilityInput,
} from '@haggle/engine-core';
import {
  transitionHnp,
  isTerminalState,
  getValidEvents,
  messageToEvent,
  createMultiIssueOpponentModel,
  updateMultiIssueOpponentModel,
  evaluateClauses,
  verifyShipping,
  buildSettlementConditions,
  createSmartContractHook,
  computeAgreementHash,
  transitionSettlement,
  settlementToSessionState,
} from '../src/index.js';
import type {
  HnpSessionState,
  OfferPayload,
  ContingentClause,
  ShippingTerms,
} from '../src/protocol/hnp-types.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const allDefs = [
  ...ELECTRONICS_SHIPPING_V1.negotiable_issues,
  ...ELECTRONICS_SHIPPING_V1.informational_issues,
];

const buyerWeights: IssueWeight[] = [
  { issue_name: 'price', weight: 0.55 },
  { issue_name: 'ship_within_hours', weight: 0.10 },
  { issue_name: 'shipping_method', weight: 0.05 },
  { issue_name: 'warranty_days', weight: 0.15 },
  { issue_name: 'battery_health', weight: 0.10 },
  { issue_name: 'condition_grade', weight: 0.05 },
];

const moderateRisk = {
  p_fraud: 0.15, p_quality: 0.20, p_delay: 0.15, p_dispute: 0.10,
  lambda_f: 0.4, lambda_q: 0.3, lambda_d: 0.2, lambda_s: 0.1,
};

const newRelationship = {
  q_reputation: 0.5, q_repeat: 0.0, q_responsiveness: 0.3,
  rho_1: 0.4, rho_2: 0.3, rho_3: 0.3,
};

function evalOffer(negotiable: Record<string, unknown>, info?: Record<string, unknown>) {
  const input: MultiIssueUtilityInput = {
    contract: {
      definitions: allDefs,
      weights: buyerWeights,
      negotiable_values: negotiable,
      informational_values: info,
    },
    risk: moderateRisk,
    relationship: newRelationship,
  };
  return computeMultiIssueUtility(input);
}

// ---------------------------------------------------------------------------
// E2E: Full Apple Resale Flow
// ---------------------------------------------------------------------------

describe('E2E: Apple Electronics v1 — Full Negotiation Lifecycle', () => {
  it('listing-based negotiation with 3 rounds, late shipment, and settlement', () => {
    // === 1. SESSION CREATION (Listing Entry) ===
    let sessionState: HnpSessionState = 'INIT';
    sessionState = transitionHnp(sessionState, 'session_create')!;
    expect(sessionState).toBe('OPEN');

    // === 2. ROUND 1: Seller's initial offer ===
    const sellerOffer1 = {
      price: 1050, ship_within_hours: 48,
      shipping_method: 'ground', warranty_days: 14,
    };
    const infoSnapshot = { battery_health: 0.91, condition_grade: 'A' };

    sessionState = transitionHnp(sessionState, 'offer')!;
    expect(sessionState).toBe('PENDING_RESPONSE');

    // Buyer evaluates seller's offer
    const util1 = evalOffer(sellerOffer1, infoSnapshot);
    expect(util1.u_total).toBeGreaterThan(0);
    expect(util1.u_total).toBeLessThan(1);

    // Buyer decides: COUNTER (aspiration is high at 0.95, threshold starts demanding)
    const thresholdParams: AcceptanceThresholdParams = {
      u_batna: 0.5, u_min: 0.7, u_0: 0.95, tau: 0.1, beta: 1.0,
    };
    const decision1 = makeMultiIssueDecision({
      utility: util1,
      threshold_params: thresholdParams,
      tau: 0.1,
      rounds_no_concession: 0,
    });
    // R(0.1) = max(0.5, 0.7 + 0.25*(1-0.1)) = max(0.5, 0.925) = 0.925
    // util1 = ~0.84 < 0.925 → COUNTER
    expect(decision1.action).toBe('COUNTER');

    // Buyer generates counter-offer
    const buyerFaratin: IssueFaratinParams[] = [
      { definition: allDefs[0], start_value: 850, limit_value: 1000 },
      { definition: allDefs[1], start_value: 12, limit_value: 48 },
      { definition: allDefs[2], start_value: 'express', limit_value: 'ground' },
      { definition: allDefs[3], start_value: 60, limit_value: 14 },
    ];
    const counter1 = computeMultiIssueCounterOffer({
      issue_params: buyerFaratin,
      weights: buyerWeights,
      t: 1, T: 10, beta: 1.2,
    });
    expect(counter1.values.price).toBeLessThan(1050);

    sessionState = transitionHnp(sessionState, 'counter_offer')!;
    expect(sessionState).toBe('OPEN');

    // === 3. ROUND 2: Seller counter-offers ===
    const sellerOffer2 = {
      price: 960, ship_within_hours: 36,
      shipping_method: 'priority', warranty_days: 21,
    };

    sessionState = transitionHnp(sessionState, 'offer')!;
    expect(sessionState).toBe('PENDING_RESPONSE');

    // Track opponent model
    let opponentModel = createMultiIssueOpponentModel();
    opponentModel = updateMultiIssueOpponentModel(
      opponentModel,
      {
        previous: sellerOffer1,
        current: sellerOffer2,
        sender_role: 'SELLER',
      },
      allDefs,
    );
    expect(opponentModel.total_rounds).toBe(1);
    // Seller conceded on price (1050→960)
    expect(opponentModel.issue_trackers['price']?.concession_rate).toBeGreaterThan(0);

    const util2 = evalOffer(sellerOffer2, infoSnapshot);
    expect(util2.u_total).toBeGreaterThan(util1.u_total); // Better offer

    const decision2 = makeMultiIssueDecision({
      utility: util2,
      threshold_params: { ...thresholdParams, tau: 0.3 },
      tau: 0.3,
      rounds_no_concession: 0,
    });

    // Generate buyer counter
    const counter2 = computeMultiIssueCounterOffer({
      issue_params: buyerFaratin,
      weights: buyerWeights,
      t: 3, T: 10, beta: 1.2,
    });

    // Verify move cost from round 1 to round 2
    const moveCost = computeMoveCost(
      counter2.values,
      counter1.values,
      allDefs.filter((d) => d.category === 'negotiable'),
      buyerWeights,
    );
    expect(moveCost).toBeGreaterThan(0); // Should have moved

    sessionState = transitionHnp(sessionState, 'counter_offer')!;
    expect(sessionState).toBe('OPEN');

    // === 4. ROUND 3: Seller's final offer (Section 18 example) ===
    const sellerFinalOffer = {
      price: 930, ship_within_hours: 24,
      shipping_method: 'priority', warranty_days: 30,
    };

    sessionState = transitionHnp(sessionState, 'offer')!;
    expect(sessionState).toBe('PENDING_RESPONSE');

    opponentModel = updateMultiIssueOpponentModel(
      opponentModel,
      {
        previous: sellerOffer2,
        current: sellerFinalOffer,
        sender_role: 'SELLER',
      },
      allDefs,
    );
    expect(opponentModel.total_rounds).toBe(2);

    const util3 = evalOffer(sellerFinalOffer, infoSnapshot);
    expect(util3.u_total).toBeGreaterThan(util2.u_total); // Even better

    const decision3 = makeMultiIssueDecision({
      utility: util3,
      threshold_params: { ...thresholdParams, tau: 0.5 },
      tau: 0.5,
      rounds_no_concession: 0,
    });

    // At this point the offer should be good enough
    // (If not ACCEPT, at least not REJECT)
    expect(['ACCEPT', 'COUNTER', 'NEAR_DEAL']).toContain(decision3.action);

    // === 5. AGREEMENT ===
    sessionState = transitionHnp(sessionState, 'accept')!;
    expect(sessionState).toBe('AGREED');

    // Verify no negotiation events accepted after agreement
    expect(transitionHnp(sessionState, 'offer')).toBeNull();
    expect(transitionHnp(sessionState, 'counter_offer')).toBeNull();

    // === 6. CLAUSE EVALUATION (Shipping Verification) ===
    const clauses: ContingentClause[] = [
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

    // Simulate: carrier acceptance at 50 hours (late!)
    const clauseResults = evaluateClauses(clauses, [{
      event_name: 'carrier_acceptance_after_hours',
      observed_value: 50,
      timestamp: '2026-03-17T14:00:00Z',
    }]);

    const triggeredClauses = clauseResults.filter((r) => r.triggered);
    expect(triggeredClauses).toHaveLength(1); // Only rebate (50 < 72)
    expect(triggeredClauses[0].remedy_result?.type).toBe('price_rebate');
    expect(triggeredClauses[0].remedy_result?.amount).toBe(30); // 2 days * $15

    // Verify shipping obligation
    const shippingTerms: ShippingTerms = {
      tracking_upload_deadline_hours: 4,
      carrier_acceptance_deadline_hours: 24,
      shipping_method: 'priority',
      late_acceptance_rebate_per_24h: 15,
      late_acceptance_rebate_cap: 45,
      cancel_if_no_acceptance_after_hours: 72,
      inspection_window_hours: 48,
      condition_proof_bundle_required: true,
    };

    const shipVerify = verifyShipping(shippingTerms, {
      carrier_acceptance_hours: 50,
      tracking_uploaded: true,
    });
    expect(shipVerify.obligation).toBe('late');
    expect(shipVerify.rebate_amount).toBe(30);
    expect(shipVerify.cancel_right_activated).toBe(false);

    // === 7. SETTLEMENT ===
    const agreedOffer: OfferPayload = {
      issues: sellerFinalOffer,
      info_snapshot: infoSnapshot,
      clauses,
      currency: 'USD',
      valid_until: '2026-03-16T12:06:00Z',
    };

    const conditions = buildSettlementConditions(
      'cond_001',
      agreedOffer,
      shipVerify.rebate_amount,
      shipVerify.cancel_right_activated,
    );
    expect(conditions.agreed_price).toBe(930);
    expect(conditions.rebate_amount).toBe(30);
    expect(conditions.net_amount).toBe(900); // 930 - 30
    expect(conditions.buyer_cancel_right).toBe(false);

    // Create settlement hook
    const hash = computeAgreementHash('sess_001', agreedOffer, conditions);
    expect(hash).toMatch(/^0x[0-9a-f]{8}$/);

    const hook = createSmartContractHook('base', 'USDC', hash, 'cond_001');
    expect(hook.settlement_method).toBe('smart_contract');
    expect(hook.chain).toBe('base');

    // Settlement lifecycle
    sessionState = transitionHnp(sessionState, 'settlement_propose')!;
    expect(sessionState).toBe('SETTLEMENT_PENDING');

    let settlementStatus = transitionSettlement('PROPOSED', 'ready')!;
    expect(settlementStatus).toBe('READY');

    settlementStatus = transitionSettlement(settlementStatus, 'confirm')!;
    expect(settlementStatus).toBe('CONFIRMED');

    // Map back to session
    const finalSessionState = settlementToSessionState(settlementStatus);
    expect(finalSessionState).toBe('SETTLED');

    sessionState = transitionHnp(sessionState, 'settlement_confirmed')!;
    expect(sessionState).toBe('SETTLED');

    sessionState = transitionHnp(sessionState, 'close')!;
    expect(sessionState).toBe('CLOSED');
    expect(isTerminalState(sessionState)).toBe(true);
  });

  it('negotiation with stall → escalation path', () => {
    let state: HnpSessionState = 'INIT';
    state = transitionHnp(state, 'session_create')!;
    state = transitionHnp(state, 'offer')!;

    // Bad offer + 4 rounds no concession → should ESCALATE
    const badUtil = evalOffer({
      price: 5000, ship_within_hours: 168,
      shipping_method: 'ground', warranty_days: 0,
    });

    const stalledDecision = makeMultiIssueDecision({
      utility: badUtil,
      threshold_params: {
        u_batna: 0.3, u_min: 0.5, u_0: 0.85, tau: 0.5, beta: 1.0,
      },
      tau: 0.5,
      rounds_no_concession: 4, // Stalled!
    });

    expect(stalledDecision.action).toBe('ESCALATE');
  });

  it('negotiation with deadline pressure → escalation', () => {
    // Mediocre offer near deadline → ESCALATE
    const medUtil = evalOffer({
      price: 5000, ship_within_hours: 100,
      shipping_method: 'ground', warranty_days: 7,
    });

    const deadlineDecision = makeMultiIssueDecision({
      utility: medUtil,
      threshold_params: {
        u_batna: 0.3, u_min: 0.5, u_0: 0.85, tau: 0.97, beta: 1.0,
      },
      tau: 0.97,
      rounds_no_concession: 1,
    });

    expect(deadlineDecision.action).toBe('ESCALATE');
  });

  it('shipping verification with cancel right activation', () => {
    const terms: ShippingTerms = {
      tracking_upload_deadline_hours: 4,
      carrier_acceptance_deadline_hours: 24,
      shipping_method: 'priority',
      late_acceptance_rebate_per_24h: 15,
      late_acceptance_rebate_cap: 45,
      cancel_if_no_acceptance_after_hours: 72,
      inspection_window_hours: 48,
      condition_proof_bundle_required: true,
    };

    const result = verifyShipping(terms, {
      carrier_acceptance_hours: 80,
      tracking_uploaded: true,
    });

    expect(result.obligation).toBe('late');
    expect(result.cancel_right_activated).toBe(true);
    expect(result.rebate_amount).toBe(45); // capped
  });

  it('settlement failure → dispute → resolution', () => {
    let state: HnpSessionState = 'AGREED';
    state = transitionHnp(state, 'settlement_propose')!;
    expect(state).toBe('SETTLEMENT_PENDING');

    state = transitionHnp(state, 'settlement_failed')!;
    expect(state).toBe('DISPUTED');

    state = transitionHnp(state, 'dispute_resolved')!;
    expect(state).toBe('SETTLED');

    state = transitionHnp(state, 'close')!;
    expect(state).toBe('CLOSED');
  });

  it('opponent model tracks concession priority across rounds', () => {
    let model = createMultiIssueOpponentModel();

    // Round 1: seller concedes mostly on price
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 1100, ship_within_hours: 48 },
      current: { price: 1000, ship_within_hours: 47 },
      sender_role: 'SELLER',
    }, allDefs);

    // Round 2: seller concedes more on price
    model = updateMultiIssueOpponentModel(model, {
      previous: { price: 1000, ship_within_hours: 47 },
      current: { price: 950, ship_within_hours: 46 },
      sender_role: 'SELLER',
    }, allDefs);

    // Price should have higher estimated priority
    expect(model.estimated_priorities['price']).toBeGreaterThan(
      model.estimated_priorities['ship_within_hours'] ?? 0,
    );
    expect(model.total_rounds).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Cross-module consistency checks
// ---------------------------------------------------------------------------

describe('Cross-module Consistency', () => {
  it('acceptance threshold decreases over time', () => {
    const base = { u_batna: 0.3, u_min: 0.4, u_0: 0.85, beta: 1.0 };
    const early = computeAcceptanceThreshold({ ...base, tau: 0.1 });
    const mid = computeAcceptanceThreshold({ ...base, tau: 0.5 });
    const late = computeAcceptanceThreshold({ ...base, tau: 0.9 });

    expect(early).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(late);
  });

  it('multi-issue utility improves with better offer values', () => {
    const bad = evalOffer({
      price: 1200, ship_within_hours: 168,
      shipping_method: 'ground', warranty_days: 0,
    });
    const good = evalOffer({
      price: 800, ship_within_hours: 12,
      shipping_method: 'express', warranty_days: 90,
    });

    expect(good.u_total).toBeGreaterThan(bad.u_total);
  });

  it('counter-offer values are bounded between start and limit', () => {
    const params: IssueFaratinParams[] = [
      { definition: allDefs[0], start_value: 850, limit_value: 1000 },
      { definition: allDefs[3], start_value: 60, limit_value: 14 },
    ];

    for (let t = 0; t <= 10; t++) {
      const result = computeMultiIssueCounterOffer({
        issue_params: params,
        weights: buyerWeights,
        t, T: 10, beta: 1.0,
      });
      const price = result.values.price as number;
      const warranty = result.values.warranty_days as number;

      expect(price).toBeGreaterThanOrEqual(850);
      expect(price).toBeLessThanOrEqual(1000);
      expect(warranty).toBeGreaterThanOrEqual(14);
      expect(warranty).toBeLessThanOrEqual(60);
    }
  });

  it('HNP lifecycle events map correctly from message types', () => {
    const messagePairs: [string, string][] = [
      ['OFFER', 'offer'],
      ['COUNTER_OFFER', 'counter_offer'],
      ['ACCEPT', 'accept'],
      ['REJECT', 'reject'],
      ['SESSION_CREATE', 'session_create'],
      ['SETTLEMENT_CONFIRMED', 'settlement_confirmed'],
    ];

    for (const [msg, event] of messagePairs) {
      expect(messageToEvent(msg as any)).toBe(event);
    }
  });

  it('settlement state machine aligns with HNP session states', () => {
    expect(settlementToSessionState('PROPOSED')).toBe('SETTLEMENT_PENDING');
    expect(settlementToSessionState('READY')).toBe('SETTLEMENT_PENDING');
    expect(settlementToSessionState('CONFIRMED')).toBe('SETTLED');
    expect(settlementToSessionState('FAILED')).toBe('DISPUTED');
    expect(settlementToSessionState('CANCELLED')).toBe('CANCELLED');
  });
});
