import { describe, it, expect } from 'vitest';
import { DefaultEngineSkill } from '../default-engine-skill.js';
import type { CoreMemory, BuddyDNA } from '../../types.js';

const BUDDY: BuddyDNA = {
  style: 'balanced',
  preferred_tactic: 'reciprocal_concession',
  category_experience: 'electronics',
  condition_trade_success_rate: 0.7,
  best_timing: 'mid-bargaining',
  tone: { style: 'professional', formality: 'neutral', emoji_use: false },
};

function makeMemory(phase: string, overrides: Record<string, unknown> = {}): CoreMemory {
  return {
    session: {
      session_id: 'test', phase, round: 5, rounds_remaining: 10,
      role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 500, my_floor: 650, current_offer: 520, opponent_offer: 620, gap: 100,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 530, acceptable_range: { min: 480, max: 650 },
      suggested_tactic: 'anchoring', hint: '', opponent_pattern: 'UNKNOWN',
      convergence_rate: 0, time_pressure: 0.3,
      utility_snapshot: { u_price: 0, u_time: 0, u_risk: 0, u_quality: 0, u_total: 0 },
      strategic_hints: [], warnings: [],
    },
    buddy_dna: BUDDY,
    skill_summary: 'test',
    ...overrides,
  } as CoreMemory;
}

describe('DefaultEngineSkill', () => {
  const skill = new DefaultEngineSkill();

  it('should have correct id and version', () => {
    expect(skill.id).toBe('electronics-iphone-pro-v1');
    expect(skill.version).toBe('1.0.0');
  });

  it('should return LLM context', () => {
    const ctx = skill.getLLMContext();
    expect(ctx).toContain('Electronics');
    expect(ctx).toContain('iPhone');
  });

  it('should return tactics', () => {
    const tactics = skill.getTactics();
    expect(tactics).toContain('anchoring');
    expect(tactics).toContain('reciprocal_concession');
    expect(tactics.length).toBeGreaterThan(3);
  });

  it('should return constraints', () => {
    const constraints = skill.getConstraints();
    expect(constraints.some((c) => c.rule === 'IMEI_REQUIRED')).toBe(true);
    expect(constraints.some((c) => c.rule === 'FIND_MY_REQUIRED')).toBe(true);
  });

  it('should return term declaration with all electronics terms', () => {
    const decl = skill.getTermDeclaration();
    expect(decl.supported_terms.length).toBe(12);
    expect(decl.category_terms.length).toBe(12);
    expect(decl.custom_term_handling).toBe('basic');
  });

  it('should DISCOVER in DISCOVERY phase', async () => {
    const decision = await skill.generateMove(makeMemory('DISCOVERY'), [], null, 'DISCOVERY');
    expect(decision.action).toBe('DISCOVER');
  });

  it('should COUNTER with anchor in OPENING phase', async () => {
    const decision = await skill.generateMove(makeMemory('OPENING'), [], null, 'OPENING');
    expect(decision.action).toBe('COUNTER');
    expect(decision.price).toBeDefined();
    // Buyer holds at their target during OPENING (anchoring below target would
    // mean countering below the buyer's own initial offer).
    expect(decision.price).toBe(500);
    expect(decision.tactic_used).toBe('anchoring');
  });

  it('should CONFIRM in CLOSING phase', async () => {
    const decision = await skill.generateMove(makeMemory('CLOSING'), [], null, 'CLOSING');
    expect(decision.action).toBe('CONFIRM');
  });

  it('should COUNTER with Faratin in BARGAINING phase', async () => {
    const decision = await skill.generateMove(makeMemory('BARGAINING'), [], null, 'BARGAINING');
    expect(decision.action).toBe('COUNTER');
    expect(decision.price).toBeDefined();
    expect(decision.price!).toBeGreaterThan(0);
  });

  it('should ACCEPT near-deal offers', async () => {
    const memory = makeMemory('BARGAINING', {
      boundaries: {
        my_target: 500, my_floor: 650, current_offer: 590, opponent_offer: 595, gap: 5,
      },
    });
    const decision = await skill.generateMove(memory as CoreMemory, [], null, 'BARGAINING');
    expect(decision.action).toBe('ACCEPT');
  });

  it('should evaluate offer at target as ACCEPT', async () => {
    const decision = await skill.evaluateOffer(
      makeMemory('BARGAINING'),
      { price: 480 }, // below buyer target (500) = good deal
      [], 'BARGAINING',
    );
    expect(decision.action).toBe('ACCEPT');
  });

  it('should counter-anchor when offer is beyond floor with rounds remaining', async () => {
    // New contract: do not immediately REJECT — real negotiations counter back
    // toward target. REJECT is reserved for the last round or extreme prices.
    const decision = await skill.evaluateOffer(
      makeMemory('BARGAINING'),
      { price: 700 }, // above buyer floor (650) = too expensive
      [], 'BARGAINING',
    );
    expect(decision.action).toBe('COUNTER');
  });

  it('should REJECT beyond-floor offer when no rounds remaining', async () => {
    const decision = await skill.evaluateOffer(
      makeMemory('BARGAINING', {
        session: {
          session_id: 'test', phase: 'BARGAINING', round: 14, rounds_remaining: 1,
          role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO',
        },
      }),
      { price: 700 },
      [], 'BARGAINING',
    );
    expect(decision.action).toBe('REJECT');
  });

  it('should REJECT extreme beyond-floor offer (>2× range)', async () => {
    // target=500, floor=650 → range=150. 2× range=300. 1000 is 350 above floor → extreme.
    const decision = await skill.evaluateOffer(
      makeMemory('BARGAINING'),
      { price: 1000 },
      [], 'BARGAINING',
    );
    expect(decision.action).toBe('REJECT');
  });

  it('should counter-offer for intermediate prices', async () => {
    const decision = await skill.evaluateOffer(
      makeMemory('BARGAINING'),
      { price: 580 }, // between target and floor
      [], 'BARGAINING',
    );
    expect(decision.action).toBe('COUNTER');
  });
});
