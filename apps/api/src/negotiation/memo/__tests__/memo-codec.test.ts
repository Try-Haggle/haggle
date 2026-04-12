import { describe, it, expect } from 'vitest';
import { encodeCompressed, encodeRaw, encodeMemo } from '../memo-codec.js';
import type { CoreMemory, RoundFact } from '../../types.js';
import { DEFAULT_BUDDY_DNA } from '../../config.js';

function makeMemory(): CoreMemory {
  return {
    session: {
      session_id: 'test-session',
      phase: 'BARGAINING',
      round: 3,
      rounds_remaining: 7,
      role: 'buyer',
      max_rounds: 10,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 83000,
      my_floor: 95000,
      current_offer: 85000,
      opponent_offer: 90000,
      gap: 5000,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 87000,
      acceptable_range: { min: 83000, max: 95000 },
      suggested_tactic: 'reciprocal_concession',
      hint: '',
      opponent_pattern: 'CONCEDER',
      convergence_rate: 0.72,
      time_pressure: 0.3,
      utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
  };
}

const sampleFacts: RoundFact[] = [
  {
    round: 1, phase: 'BARGAINING', buyer_offer: 85000, seller_offer: 92000, gap: 7000,
    conditions_changed: {}, coaching_given: { recommended: 87000, tactic: 'anchoring' },
    coaching_followed: true, human_intervened: false, timestamp: Date.now() - 3000,
  },
  {
    round: 2, phase: 'BARGAINING', buyer_offer: 86000, seller_offer: 91000, gap: 5000,
    conditions_changed: {}, coaching_given: { recommended: 87000, tactic: 'reciprocal_concession' },
    coaching_followed: true, human_intervened: false, timestamp: Date.now() - 2000,
  },
];

describe('memo-codec', () => {
  describe('encodeCompressed', () => {
    it('produces NS: line with session state', () => {
      const result = encodeCompressed(makeMemory());
      expect(result).toContain('NS:BARGAINING|R3/10|buyer|FULL_AUTO');
    });

    it('produces PT: line with price trajectory', () => {
      const result = encodeCompressed(makeMemory());
      expect(result).toContain('PT:85000→90000|gap:5000');
    });

    it('produces CL: line with coaching', () => {
      const result = encodeCompressed(makeMemory());
      expect(result).toContain('CL:rec:87000|tactic:reciprocal_concession|opp:CONCEDER|conv:0.72');
    });

    it('includes RM: line when facts are provided', () => {
      const result = encodeCompressed(makeMemory(), sampleFacts);
      expect(result).toContain('RM:');
      expect(result).toContain('R1:');
      expect(result).toContain('R2:');
    });

    it('includes private layer with SS: and OM:', () => {
      const result = encodeCompressed(makeMemory());
      expect(result).toContain('---');
      expect(result).toContain('SS:t:83000|f:95000');
      expect(result).toContain('OM:CONCEDER');
    });

    it('includes TA: line when terms are active', () => {
      const memory = makeMemory();
      memory.terms.active = [
        {
          term_id: 'warranty', category: 'WARRANTY', display_name: 'Warranty',
          status: 'proposed', value: '30d', proposed_by: 'buyer', round_introduced: 2,
        },
      ];
      const result = encodeCompressed(memory);
      expect(result).toContain('TA:warranty=proposed:30d');
    });

    it('includes TR: line when warnings exist', () => {
      const memory = makeMemory();
      memory.coaching.warnings = ['Running low on rounds'];
      const result = encodeCompressed(memory);
      expect(result).toContain('TR:Running low on rounds');
    });
  });

  describe('encodeRaw', () => {
    it('produces valid JSON', () => {
      const result = encodeRaw(makeMemory());
      const parsed = JSON.parse(result);
      expect(parsed.session.phase).toBe('BARGAINING');
      expect(parsed.boundaries.my_target).toBe(83000);
    });

    it('includes coaching data', () => {
      const result = encodeRaw(makeMemory());
      const parsed = JSON.parse(result);
      expect(parsed.coaching.recommended_price).toBe(87000);
    });
  });

  describe('encodeMemo', () => {
    it('uses compressed for codec encoding', () => {
      const result = encodeMemo(makeMemory(), 'codec');
      expect(result).toContain('NS:');
    });

    it('uses raw JSON for raw encoding', () => {
      const result = encodeMemo(makeMemory(), 'raw');
      JSON.parse(result); // should not throw
    });
  });
});
