import { describe, it, expect } from 'vitest';
import { validateMove } from '../negotiation/referee/validator.js';
import type {
  ProtocolDecision,
  CoreMemory,
  RefereeCoaching,
  NegotiationPhase,
} from '../negotiation/types.js';

// ─── Helpers ───

function makeMemory(overrides?: {
  role?: 'buyer' | 'seller';
  rounds_remaining?: number;
  my_floor?: number;
}): CoreMemory {
  const o = overrides ?? {};
  return {
    session: {
      session_id: 'test',
      phase: 'BARGAINING',
      round: 5,
      rounds_remaining: o.rounds_remaining ?? 10,
      role: o.role ?? 'buyer',
      max_rounds: 15,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 500,
      my_floor: o.my_floor ?? 700,
      current_offer: 550,
      opponent_offer: 650,
      gap: 100,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {} as CoreMemory['coaching'],
    buddy_dna: {
      style: 'balanced',
      preferred_tactic: 'reciprocal_concession',
      category_experience: 'electronics',
      condition_trade_success_rate: 0.7,
      best_timing: 'mid-round',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: '',
  };
}

function makeCoaching(recommended_price = 580): RefereeCoaching {
  return {
    recommended_price,
    acceptable_range: { min: 500, max: 700 },
    suggested_tactic: 'reciprocal_concession',
    hint: '',
    opponent_pattern: 'LINEAR',
    convergence_rate: 0.05,
    time_pressure: 0.3,
    utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
    strategic_hints: [],
    warnings: [],
  };
}

function makeMove(overrides?: Partial<ProtocolDecision>): ProtocolDecision {
  return {
    action: 'COUNTER',
    price: 560,
    reasoning: 'test',
    ...overrides,
  };
}

describe('validateMove', () => {
  // ─── V1: Price exceeds floor ───

  describe('V1 — floor violation', () => {
    it('PASS: buyer price within floor', () => {
      const result = validateMove(
        makeMove({ price: 600 }),
        makeMemory({ role: 'buyer', my_floor: 700 }),
        makeCoaching(),
        [],
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V1')).toHaveLength(0);
    });

    it('VIOLATION: buyer price exceeds floor', () => {
      const result = validateMove(
        makeMove({ price: 750 }),
        makeMemory({ role: 'buyer', my_floor: 700 }),
        makeCoaching(),
        [],
        'BARGAINING',
      );
      const v1 = result.violations.find((v) => v.rule === 'V1');
      expect(v1).toBeDefined();
      expect(v1!.severity).toBe('HARD');
    });

    it('VIOLATION: seller price below floor', () => {
      const result = validateMove(
        makeMove({ price: 300 }),
        makeMemory({ role: 'seller', my_floor: 400 }),
        makeCoaching(),
        [],
        'BARGAINING',
      );
      const v1 = result.violations.find((v) => v.rule === 'V1');
      expect(v1).toBeDefined();
      expect(v1!.severity).toBe('HARD');
    });
  });

  // ─── V2: Action not allowed in phase ───

  describe('V2 — phase action', () => {
    it('PASS: COUNTER allowed in BARGAINING', () => {
      const result = validateMove(
        makeMove({ action: 'COUNTER' }),
        makeMemory(),
        makeCoaching(),
        [],
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V2')).toHaveLength(0);
    });

    it('VIOLATION: COUNTER not allowed in DISCOVERY', () => {
      const result = validateMove(
        makeMove({ action: 'COUNTER' }),
        makeMemory(),
        makeCoaching(),
        [],
        'DISCOVERY',
      );
      const v2 = result.violations.find((v) => v.rule === 'V2');
      expect(v2).toBeDefined();
      expect(v2!.severity).toBe('HARD');
    });
  });

  // ─── V3: COUNTER with 0 rounds ───

  describe('V3 — no rounds remaining', () => {
    it('PASS: COUNTER with rounds remaining', () => {
      const result = validateMove(
        makeMove({ action: 'COUNTER' }),
        makeMemory({ rounds_remaining: 5 }),
        makeCoaching(),
        [],
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V3')).toHaveLength(0);
    });

    it('VIOLATION: COUNTER with 0 rounds remaining', () => {
      const result = validateMove(
        makeMove({ action: 'COUNTER' }),
        makeMemory({ rounds_remaining: 0 }),
        makeCoaching(),
        [],
        'BARGAINING',
      );
      const v3 = result.violations.find((v) => v.rule === 'V3');
      expect(v3).toBeDefined();
      expect(v3!.severity).toBe('HARD');
    });
  });

  // ─── V4: Direction reversal ───

  describe('V4 — concession direction reversal', () => {
    it('PASS: consistent concession direction', () => {
      const prev: ProtocolDecision[] = [
        makeMove({ price: 500 }),
        makeMove({ price: 520 }),
        makeMove({ price: 540 }),
      ];
      const result = validateMove(
        makeMove({ price: 560 }),
        makeMemory(),
        makeCoaching(),
        prev,
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V4')).toHaveLength(0);
    });

    it('VIOLATION: direction reversal detected', () => {
      const prev: ProtocolDecision[] = [
        makeMove({ price: 500 }),
        makeMove({ price: 520 }),
        makeMove({ price: 540 }),
      ];
      const result = validateMove(
        makeMove({ price: 530 }), // reversal: was going up, now going down
        makeMemory(),
        makeCoaching(),
        prev,
        'BARGAINING',
      );
      const v4 = result.violations.find((v) => v.rule === 'V4');
      expect(v4).toBeDefined();
      expect(v4!.severity).toBe('SOFT');
    });
  });

  // ─── V5: Stagnation ───

  describe('V5 — stagnation', () => {
    it('PASS: sufficient concession over window', () => {
      const prev: ProtocolDecision[] = [
        makeMove({ price: 500 }),
        makeMove({ price: 520 }),
        makeMove({ price: 540 }),
        makeMove({ price: 560 }),
      ];
      const result = validateMove(
        makeMove({ price: 580 }),
        makeMemory(),
        makeCoaching(),
        prev,
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V5')).toHaveLength(0);
    });

    it('VIOLATION: stagnation — minimal price change over 4 rounds', () => {
      const prev: ProtocolDecision[] = [
        makeMove({ price: 550 }),
        makeMove({ price: 550.5 }),
        makeMove({ price: 551 }),
        makeMove({ price: 551.2 }),
      ];
      const result = validateMove(
        makeMove({ price: 551.5 }),
        makeMemory(),
        makeCoaching(),
        prev,
        'BARGAINING',
      );
      const v5 = result.violations.find((v) => v.rule === 'V5');
      expect(v5).toBeDefined();
      expect(v5!.severity).toBe('SOFT');
    });
  });

  // ─── V6: One-sided concession ───

  describe('V6 — one-sided concession', () => {
    it('PASS: mixed direction in recent moves (no one-sided pattern)', () => {
      const prev: ProtocolDecision[] = [
        makeMove({ price: 500 }),
        makeMove({ price: 520 }),
        makeMove({ price: 510 }), // not a concession for buyer
      ];
      const result = validateMove(
        makeMove({ price: 530 }),
        makeMemory({ role: 'buyer' }),
        makeCoaching(),
        prev,
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V6')).toHaveLength(0);
    });

    it('VIOLATION: buyer continuously conceding (raising price) for 3+ rounds', () => {
      const prev: ProtocolDecision[] = [
        makeMove({ price: 500 }),
        makeMove({ price: 520 }),
        makeMove({ price: 540 }),
      ];
      const result = validateMove(
        makeMove({ price: 560 }),
        makeMemory({ role: 'buyer' }),
        makeCoaching(),
        prev,
        'BARGAINING',
      );
      const v6 = result.violations.find((v) => v.rule === 'V6');
      expect(v6).toBeDefined();
      expect(v6!.severity).toBe('SOFT');
    });
  });

  // ─── V7: Concession too large ───

  describe('V7 — large concession', () => {
    it('PASS: concession within 2x of recommended step', () => {
      const prev: ProtocolDecision[] = [makeMove({ price: 550 })];
      // recommended = 580, so recommended step = |580 - 550| = 30
      // move price = 575, actual step = |575 - 550| = 25, within 2x of 30
      const result = validateMove(
        makeMove({ price: 575 }),
        makeMemory(),
        makeCoaching(580),
        prev,
        'BARGAINING',
      );
      expect(result.violations.filter((v) => v.rule === 'V7')).toHaveLength(0);
    });

    it('VIOLATION: concession > 2x recommended step', () => {
      const prev: ProtocolDecision[] = [makeMove({ price: 550 })];
      // recommended = 580, recommended step = 30, 2x = 60
      // move price = 650, actual step = |650 - 550| = 100, exceeds 60
      const result = validateMove(
        makeMove({ price: 650 }),
        makeMemory(),
        makeCoaching(580),
        prev,
        'BARGAINING',
      );
      const v7 = result.violations.find((v) => v.rule === 'V7');
      expect(v7).toBeDefined();
      expect(v7!.severity).toBe('SOFT');
    });
  });
});
