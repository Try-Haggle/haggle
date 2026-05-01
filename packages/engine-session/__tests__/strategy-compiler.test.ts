import { describe, expect, it } from 'vitest';
import {
  assembleContext,
  compileStrategySnapshot,
  executeRound,
  type MasterStrategy,
  type NegotiationSession,
} from '../src/index.js';
import type { HnpMessage } from '../src/protocol/types.js';

const listedAtMs = Date.UTC(2026, 3, 25, 12);

describe('compileStrategySnapshot', () => {
  it('compiles seller playbooks into engine-native strategy parameters', () => {
    const gatekeeper = compileStrategySnapshot({
      role: 'SELLER',
      preset: 'gatekeeper',
      listing: {
        targetPriceMinor: 50_000,
        floorPriceMinor: 43_000,
        listedAtMs,
        deadlineAtMs: listedAtMs + 7 * 24 * 60 * 60 * 1000,
      },
    });

    const dealmaker = compileStrategySnapshot({
      role: 'SELLER',
      preset: 'dealmaker',
      listing: {
        targetPriceMinor: 50_000,
        floorPriceMinor: 43_000,
        listedAtMs,
        deadlineAtMs: listedAtMs + 7 * 24 * 60 * 60 * 1000,
      },
    });

    expect(gatekeeper.role).toBe('SELLER');
    expect(gatekeeper.p_target).toBe(50_000);
    expect(gatekeeper.p_limit).toBe(43_000);
    expect(gatekeeper.weights.w_p).toBeGreaterThan(dealmaker.weights.w_p);
    expect(gatekeeper.u_aspiration).toBeGreaterThan(dealmaker.u_aspiration);
    expect(gatekeeper.beta).toBeLessThan(dealmaker.beta);
    expect(gatekeeper.compiler.selected_playbook).toBe('gatekeeper');
    expect(dealmaker.compiler.selected_playbook).toBe('dealmaker');
  });

  it('produces engine-valid weights for every seller playbook', () => {
    for (const preset of ['gatekeeper', 'diplomat', 'storyteller', 'dealmaker']) {
      const snapshot = compileStrategySnapshot({
        role: 'SELLER',
        preset,
        listing: {
          targetPriceMinor: 50_000,
          floorPriceMinor: 43_000,
          listedAtMs,
          deadlineAtMs: listedAtMs + 5 * 24 * 60 * 60 * 1000,
        },
      });
      const weightSum = snapshot.weights.w_p + snapshot.weights.w_t + snapshot.weights.w_r + snapshot.weights.w_s;
      const ctx = assembleContext(snapshot, {
        p_effective: 47_000,
        r_score: 0.8,
        i_completeness: 0.9,
        t_elapsed: snapshot.t_deadline * 0.4,
        n_success: 1,
        n_dispute_losses: 0,
      });

      expect(weightSum).toBeCloseTo(1, 10);
      expect(ctx.weights).toEqual(snapshot.weights);
      expect(ctx.time.t_deadline).toBe(snapshot.t_deadline);
    }
  });

  it('makes the same listing behave differently under different seller strategies', () => {
    const gatekeeper = compileStrategySnapshot({
      role: 'SELLER',
      preset: 'gatekeeper',
      listing: {
        targetPriceMinor: 50_000,
        floorPriceMinor: 43_000,
        listedAtMs,
        deadlineAtMs: listedAtMs + 7 * 24 * 60 * 60 * 1000,
      },
    });
    const dealmaker = compileStrategySnapshot({
      role: 'SELLER',
      preset: 'dealmaker',
      listing: {
        targetPriceMinor: 50_000,
        floorPriceMinor: 43_000,
        listedAtMs,
        deadlineAtMs: listedAtMs + 7 * 24 * 60 * 60 * 1000,
      },
    });

    const gatekeeperRound = executeRound(
      makeSellerSession(gatekeeper),
      forceCounter(gatekeeper),
      makeBuyerOffer(45_000),
      makeRoundData(gatekeeper, 0.25, 45_000),
    );
    const dealmakerRound = executeRound(
      makeSellerSession(dealmaker),
      forceCounter(dealmaker),
      makeBuyerOffer(45_000),
      makeRoundData(dealmaker, 0.25, 45_000),
    );

    expect(gatekeeperRound.decision).toBe('COUNTER');
    expect(dealmakerRound.decision).toBe('COUNTER');
    expect(gatekeeperRound.message.price).toBeGreaterThan(dealmakerRound.message.price);
    expect(gatekeeperRound.message.price).toBeLessThanOrEqual(gatekeeper.p_target);
    expect(dealmakerRound.message.price).toBeGreaterThanOrEqual(dealmaker.p_limit);
  });

  it('reuses preference shape across products but recompiles product-specific prices', () => {
    const sharedStats = {
      priceAggression: 70,
      patienceLevel: 65,
      riskTolerance: 35,
      speedBias: 40,
      detailFocus: 80,
    };
    const phone = compileStrategySnapshot({
      role: 'SELLER',
      agentStats: sharedStats,
      listing: {
        targetPriceMinor: 50_000,
        floorPriceMinor: 43_000,
        listedAtMs,
        deadlineAtMs: listedAtMs + 4 * 24 * 60 * 60 * 1000,
      },
    });
    const laptop = compileStrategySnapshot({
      role: 'SELLER',
      agentStats: sharedStats,
      listing: {
        targetPriceMinor: 120_000,
        floorPriceMinor: 100_000,
        listedAtMs,
        deadlineAtMs: listedAtMs + 4 * 24 * 60 * 60 * 1000,
      },
    });

    expect(laptop.p_target).toBe(120_000);
    expect(laptop.p_limit).toBe(100_000);
    expect(phone.p_target).toBe(50_000);
    expect(phone.p_limit).toBe(43_000);
    expect(laptop.weights).toEqual(phone.weights);
    expect(laptop.thresholds).toEqual(phone.thresholds);
    expect(laptop.concession).toEqual(phone.concession);
  });

  it('increases time weight when the same seller strategy has a short listing deadline', () => {
    const base = {
      role: 'SELLER' as const,
      preset: 'diplomat',
      listing: {
        targetPriceMinor: 50_000,
        floorPriceMinor: 43_000,
        listedAtMs,
      },
    };
    const shortDeadline = compileStrategySnapshot({
      ...base,
      listing: { ...base.listing, deadlineAtMs: listedAtMs + 12 * 60 * 60 * 1000 },
    });
    const longDeadline = compileStrategySnapshot({
      ...base,
      listing: { ...base.listing, deadlineAtMs: listedAtMs + 14 * 24 * 60 * 60 * 1000 },
    });

    expect(shortDeadline.weights.w_t).toBeGreaterThan(longDeadline.weights.w_t);
    expect(shortDeadline.t_deadline).toBeLessThan(longDeadline.t_deadline);
  });

  it('keeps deadline math as absolute epoch milliseconds', () => {
    const deadlineAtMs = listedAtMs + 36 * 60 * 60 * 1000;
    const snapshot = compileStrategySnapshot({
      role: 'SELLER',
      preset: 'diplomat',
      listing: {
        id: 'listing-1',
        category: 'electronics',
        condition: 'good',
        targetPriceMinor: 50_000,
        floorPriceMinor: 44_000,
        listedAtMs,
        deadlineAtMs,
      },
    });

    expect(snapshot.created_at).toBe(listedAtMs);
    expect(snapshot.expires_at).toBe(deadlineAtMs);
    expect(snapshot.t_deadline).toBe(deadlineAtMs - listedAtMs);
    expect(snapshot.time_value).toMatchObject({
      listed_at_ms: listedAtMs,
      deadline_at_ms: deadlineAtMs,
      t_total_ms: deadlineAtMs - listedAtMs,
      source: 'listing_selling_deadline',
    });
    expect(snapshot.listing_context).toMatchObject({
      id: 'listing-1',
      category: 'electronics',
      condition: 'good',
    });
  });
});

function forceCounter(strategy: MasterStrategy): MasterStrategy {
  return {
    ...strategy,
    u_threshold: 0.99,
    u_aspiration: 1.01,
  };
}

function makeSellerSession(strategy: MasterStrategy): NegotiationSession {
  return {
    session_id: 'seller-session',
    strategy_id: strategy.id,
    role: 'SELLER',
    status: 'ACTIVE',
    counterparty_id: 'buyer-1',
    rounds: [],
    current_round: 1,
    rounds_no_concession: 0,
    last_offer_price: strategy.p_target,
    last_utility: null,
    created_at: strategy.created_at,
    updated_at: strategy.created_at,
  };
}

function makeBuyerOffer(price: number): HnpMessage {
  return {
    session_id: 'seller-session',
    round: 2,
    type: 'OFFER',
    price,
    sender_role: 'BUYER',
    timestamp: listedAtMs,
  };
}

function makeRoundData(strategy: MasterStrategy, progress: number, offerPrice: number) {
  return {
    p_effective: offerPrice,
    r_score: 0.8,
    i_completeness: 0.9,
    t_elapsed: strategy.t_deadline * progress,
    n_success: 0,
    n_dispute_losses: 0,
  };
}
