import { describe, it, expect } from 'vitest';
import { computeVt } from '../src/utility/v-time.js';
import { adjustVpForCompetition } from '../src/utility/competition.js';
import { compareSessions } from '../src/batch/comparator.js';
import { computeUtility } from '../src/utility/index.js';
import type { TimeContext, HoldContext, CompetitionContext, NegotiationContext } from '../src/types.js';
import type { SessionSnapshot } from '../src/batch/types.js';

// ─── Fixtures ────────────────────────────────────────────

function makeTime(overrides?: Partial<TimeContext>): TimeContext {
  return {
    t_elapsed: 30,
    t_deadline: 120,
    alpha: 1.0,
    v_t_floor: 0.05,
    ...overrides,
  };
}

function makeHold(overrides?: Partial<HoldContext>): HoldContext {
  return {
    is_held: true,
    hold_kind: 'SOFT_HOLD',
    held_price_minor: 5000,
    hold_remaining_ms: 30000,
    hold_total_ms: 60000,
    resume_reprice_required: false,
    ...overrides,
  };
}

function makeComp(overrides?: Partial<CompetitionContext>): CompetitionContext {
  return {
    n_competitors: 2,
    market_position: 0.5,
    best_alternative: 0,
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<SessionSnapshot>): SessionSnapshot {
  return {
    session_id: 'session-1',
    utility: { u_total: 0.7, v_p: 0.7, v_t: 0.8, v_r: 0.6, v_s: 0.5 },
    thresholds: { u_threshold: 0.4, u_aspiration: 0.8 },
    ...overrides,
  };
}

// ─── V_t with Hold ──────────────────────────────────────

describe('computeVt with hold', () => {
  it('without hold: unchanged behavior', () => {
    const vt = computeVt(makeTime());
    expect(vt).toBeCloseTo(0.75); // (1 - 30/120)^1 = 0.75
  });

  it('without hold param: same as no hold', () => {
    const vtNoHold = computeVt(makeTime());
    const vtUndefined = computeVt(makeTime(), undefined);
    expect(vtNoHold).toBe(vtUndefined);
  });

  it('hold not active: no effect', () => {
    const vt = computeVt(makeTime(), makeHold({ is_held: false }));
    const vtNoHold = computeVt(makeTime());
    expect(vt).toBe(vtNoHold);
  });

  it('hold with full remaining time: minimal effect', () => {
    const hold = makeHold({ hold_remaining_ms: 60000, hold_total_ms: 60000 });
    const vt = computeVt(makeTime(), hold);
    const vtNoHold = computeVt(makeTime());
    // hold_urgency = 0, so effective_alpha = alpha * 1 = alpha
    expect(vt).toBeCloseTo(vtNoHold);
  });

  it('hold almost expired: stronger time pressure', () => {
    const hold = makeHold({ hold_remaining_ms: 6000, hold_total_ms: 60000 });
    const vt = computeVt(makeTime(), hold);
    const vtNoHold = computeVt(makeTime());
    // hold_urgency = 0.9, effective_alpha = 1 * 1.27
    expect(vt).toBeLessThan(vtNoHold);
  });

  it('hold fully expired: maximum time pressure', () => {
    const hold = makeHold({ hold_remaining_ms: 0, hold_total_ms: 60000 });
    const vt = computeVt(makeTime(), hold);
    const vtNoHold = computeVt(makeTime());
    // hold_urgency = 1.0, effective_alpha = 1 * 1.3
    expect(vt).toBeLessThan(vtNoHold);
  });

  it('hold with missing total_ms: no effect', () => {
    const hold = makeHold({ hold_total_ms: undefined });
    const vt = computeVt(makeTime(), hold);
    const vtNoHold = computeVt(makeTime());
    expect(vt).toBe(vtNoHold);
  });

  it('hold with zero total_ms: no effect', () => {
    const hold = makeHold({ hold_total_ms: 0 });
    const vt = computeVt(makeTime(), hold);
    const vtNoHold = computeVt(makeTime());
    expect(vt).toBe(vtNoHold);
  });
});

// ─── Competition with Hold Competitors ──────────────────

describe('adjustVpForCompetition with n_hold_competitors', () => {
  it('without hold competitors: unchanged', () => {
    const vp = adjustVpForCompetition(0.5, makeComp());
    const vpNoHoldComp = adjustVpForCompetition(0.5, makeComp({ n_hold_competitors: 0 }));
    expect(vp).toBeCloseTo(vpNoHoldComp);
  });

  it('with hold competitors: increases effective competition', () => {
    const vpBase = adjustVpForCompetition(0.5, makeComp({ n_hold_competitors: 0 }));
    const vpWithHold = adjustVpForCompetition(0.5, makeComp({ n_hold_competitors: 3 }));
    // More competitors → higher adjustment → higher adjusted V_p
    expect(vpWithHold).toBeGreaterThan(vpBase);
  });

  it('n_hold_competitors defaults to 0 when undefined', () => {
    const vpUndefined = adjustVpForCompetition(0.5, makeComp());
    const vpZero = adjustVpForCompetition(0.5, makeComp({ n_hold_competitors: 0 }));
    expect(vpUndefined).toBeCloseTo(vpZero);
  });

  it('hold competitors add to effective_n', () => {
    // n_competitors=0 + n_hold_competitors=2 should behave like n_competitors=2
    const vpHoldOnly = adjustVpForCompetition(
      0.5,
      makeComp({ n_competitors: 0, n_hold_competitors: 2 }),
    );
    const vpRegular = adjustVpForCompetition(
      0.5,
      makeComp({ n_competitors: 2, n_hold_competitors: 0 }),
    );
    expect(vpHoldOnly).toBeCloseTo(vpRegular);
  });
});

// ─── compareSessions with Hold ──────────────────────────

describe('compareSessions with hold_status', () => {
  it('without hold_status: unchanged behavior', () => {
    const result = compareSessions([makeSnapshot()]);
    expect(result.rankings[0].u_total).toBeCloseTo(0.7);
  });

  it('SELLER_RESERVED gets +0.02 bonus', () => {
    const snapshot = makeSnapshot({
      hold_status: { hold_kind: 'SELLER_RESERVED' },
    });
    const result = compareSessions([snapshot]);
    expect(result.rankings[0].u_total).toBeCloseTo(0.72);
  });

  it('SOFT_HOLD with reprice gets -0.02 penalty', () => {
    const snapshot = makeSnapshot({
      hold_status: { hold_kind: 'SOFT_HOLD', resume_reprice_required: true },
    });
    const result = compareSessions([snapshot]);
    expect(result.rankings[0].u_total).toBeCloseTo(0.68);
  });

  it('SOFT_HOLD without reprice: no adjustment', () => {
    const snapshot = makeSnapshot({
      hold_status: { hold_kind: 'SOFT_HOLD', resume_reprice_required: false },
    });
    const result = compareSessions([snapshot]);
    expect(result.rankings[0].u_total).toBeCloseTo(0.7);
  });

  it('hold bonus can change ranking order', () => {
    const s1 = makeSnapshot({
      session_id: 'low-base',
      utility: { u_total: 0.70, v_p: 0.7, v_t: 0.8, v_r: 0.6, v_s: 0.5 },
      hold_status: { hold_kind: 'SELLER_RESERVED' },
    });
    const s2 = makeSnapshot({
      session_id: 'high-base',
      utility: { u_total: 0.71, v_p: 0.7, v_t: 0.8, v_r: 0.6, v_s: 0.5 },
    });
    const result = compareSessions([s1, s2]);
    // s1: 0.70 + 0.02 = 0.72 > s2: 0.71
    expect(result.rankings[0].session_id).toBe('low-base');
  });

  it('hold penalty can push session below threshold', () => {
    const snapshot = makeSnapshot({
      utility: { u_total: 0.41, v_p: 0.4, v_t: 0.5, v_r: 0.3, v_s: 0.3 },
      thresholds: { u_threshold: 0.4, u_aspiration: 0.8 },
      hold_status: { hold_kind: 'SOFT_HOLD', resume_reprice_required: true },
    });
    const result = compareSessions([snapshot]);
    // 0.41 - 0.02 = 0.39 < threshold 0.4
    expect(result.recommended_action).toBe('ESCALATE');
  });
});

// ─── computeUtility with hold passthrough ───────────────

describe('computeUtility with hold', () => {
  function makeCtx(overrides?: Partial<NegotiationContext>): NegotiationContext {
    return {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 50, p_target: 30, p_limit: 100 },
      time: { t_elapsed: 30, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
      risk: { r_score: 0.8, i_completeness: 0.9, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 5, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.3 },
      ...overrides,
    };
  }

  it('without hold: same as before', () => {
    const result = computeUtility(makeCtx());
    expect(result.error).toBeUndefined();
    expect(result.u_total).toBeGreaterThan(0);
  });

  it('with hold: V_t is affected', () => {
    const noHold = computeUtility(makeCtx());
    const withHold = computeUtility(makeCtx({
      hold: makeHold({ hold_remaining_ms: 6000, hold_total_ms: 60000 }),
    }));
    // V_t should be lower with hold urgency → lower u_total
    expect(withHold.v_t).toBeLessThan(noHold.v_t);
    expect(withHold.u_total).toBeLessThan(noHold.u_total);
  });
});

// ─── computeUtility with term_space ─────────────────────

describe('computeUtility with term_space', () => {
  it('uses multi-term path when term_space provided', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 50, p_target: 30, p_limit: 100 },
      time: { t_elapsed: 30, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
      risk: { r_score: 0.8, i_completeness: 0.9, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 5, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.3 },
      term_space: {
        terms: [{
          id: 'price', type: 'NEGOTIABLE', layer: 'GLOBAL', weight: 1.0,
          domain: { min: 0, max: 100, direction: 'lower_is_better' },
        }],
        current_values: { price: 25 },
      },
    };
    const result = computeUtility(ctx);
    expect(result.error).toBeUndefined();
    // v_p, v_t, v_r, v_s should be 0 in multi-term path
    expect(result.v_p).toBe(0);
    expect(result.v_t).toBe(0);
    expect(result.v_r).toBe(0);
    expect(result.v_s).toBe(0);
    expect(result.u_total).toBeGreaterThan(0);
  });

  it('returns error for invalid term_space', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 50, p_target: 30, p_limit: 100 },
      time: { t_elapsed: 30, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
      risk: { r_score: 0.8, i_completeness: 0.9, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 5, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.3 },
      term_space: { terms: [], current_values: {} },
    };
    const result = computeUtility(ctx);
    expect(result.error).toBeDefined();
    expect(result.u_total).toBe(0);
  });

  it('without term_space: classic path unchanged', () => {
    const ctx: NegotiationContext = {
      weights: { w_p: 0.4, w_t: 0.3, w_r: 0.2, w_s: 0.1 },
      price: { p_effective: 50, p_target: 30, p_limit: 100 },
      time: { t_elapsed: 30, t_deadline: 120, alpha: 1.0, v_t_floor: 0.05 },
      risk: { r_score: 0.8, i_completeness: 0.9, w_rep: 0.6, w_info: 0.4 },
      relationship: { n_success: 5, n_dispute_losses: 0, n_threshold: 10, v_s_base: 0.3 },
    };
    const result = computeUtility(ctx);
    expect(result.v_p).toBeGreaterThan(0);
    expect(result.v_t).toBeGreaterThan(0);
    expect(result.u_total).toBeGreaterThan(0);
  });
});
