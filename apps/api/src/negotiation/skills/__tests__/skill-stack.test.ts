/**
 * Skill v2 Architecture Tests
 *
 * Tests:
 * 1. Skill registration & tag-based resolution
 * 2. Hook dispatch & result merging
 * 3. Electronics knowledge skill correctness
 * 4. Faratin coaching skill correctness
 * 5. RefereeBriefing (facts-only, no recommendations)
 * 6. Coaching is advisory (not prescriptive)
 * 7. SkillStack composition (multiple skills)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSkill,
  clearRegistry,
  SkillStack,
} from '../skill-stack.js';
import { ElectronicsKnowledgeSkill } from '../electronics-knowledge.js';
import { FaratinCoachingSkill } from '../faratin-coaching.js';
import { computeBriefing } from '../../referee/briefing.js';
import type { CoreMemory, RoundFact, OpponentPattern } from '../../types.js';
import type { HookContext, DecideHookResult } from '../skill-types.js';

// ─── Test Fixtures ──────────────────────────────────────────────

function makeMemory(overrides?: Partial<CoreMemory>): CoreMemory {
  return {
    session: {
      phase: 'BARGAINING',
      round: 3,
      max_rounds: 15,
      rounds_remaining: 12,
      role: 'buyer',
      ...(overrides?.session ?? {}),
    },
    boundaries: {
      my_target: 80000,    // $800
      my_floor: 90000,     // $900 (buyer: max willingness)
      current_offer: 84000, // $840
      opponent_offer: 86000, // $860
      gap: 2000,           // $20
      ...(overrides?.boundaries ?? {}),
    },
  } as CoreMemory;
}

function makeFacts(count: number): RoundFact[] {
  const facts: RoundFact[] = [];
  for (let i = 0; i < count; i++) {
    facts.push({
      round_number: i + 1,
      buyer_offer: 75000 + i * 3000,
      seller_offer: 95000 - i * 3000,
      gap: 20000 - i * 6000,
      decision: 'COUNTER',
      timestamp: Date.now(),
    } as RoundFact);
  }
  return facts;
}

function makeOpponent(): OpponentPattern {
  return {
    aggression: 0.5,
    concession_rate: 0.03,
    pattern_history: [],
  } as OpponentPattern;
}

function makeHookContext(stage: string, overrides?: Partial<HookContext>): HookContext {
  return {
    stage: stage as HookContext['stage'],
    memory: makeMemory(),
    recentFacts: makeFacts(3),
    opponentPattern: makeOpponent(),
    phase: 'BARGAINING',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Skill Registration & Resolution', () => {
  beforeEach(() => clearRegistry());

  it('registers skills and resolves by tag', () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const coaching = new FaratinCoachingSkill();
    registerSkill(knowledge);
    registerSkill(coaching);

    const stack = SkillStack.fromTags(['electronics/phones/iphone']);

    // electronics-knowledge matches "electronics" prefix
    // faratin-coaching matches "*" (all categories)
    expect(stack.getSkills()).toHaveLength(2);
    expect(stack.getSkills().map(s => s.manifest.id)).toContain('electronics-knowledge-v1');
    expect(stack.getSkills().map(s => s.manifest.id)).toContain('faratin-coaching-v1');
  });

  it('does not duplicate on re-registration', () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    registerSkill(knowledge);
    registerSkill(knowledge);

    const stack = SkillStack.fromTags(['electronics']);
    expect(stack.getSkills().filter(s => s.manifest.id === 'electronics-knowledge-v1')).toHaveLength(1);
  });

  it('resolves only matching skills for non-electronics tags', () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const coaching = new FaratinCoachingSkill();
    registerSkill(knowledge);
    registerSkill(coaching);

    const stack = SkillStack.fromTags(['sneakers/nike']);

    // Only faratin-coaching (*) matches, not electronics-knowledge
    expect(stack.getSkills()).toHaveLength(1);
    expect(stack.getSkills()[0]!.manifest.id).toBe('faratin-coaching-v1');
  });
});

describe('Hook Dispatch & Merging', () => {
  beforeEach(() => clearRegistry());

  it('dispatches decide hook to all registered skills', async () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const coaching = new FaratinCoachingSkill();
    const stack = SkillStack.of(knowledge, coaching);

    const ctx = makeHookContext('decide');
    const result = await stack.dispatchHook(ctx);

    // Both skills responded
    expect(Object.keys(result.bySkill)).toHaveLength(2);

    // Merged decide content
    expect(result.decide).toBeDefined();
    expect(result.decide!.categoryBrief).toContain('Electronics');
    expect(result.decide!.valuationRules.length).toBeGreaterThan(0);
    expect(result.decide!.tactics.length).toBeGreaterThan(0);

    // Coaching is in advisories, not in main content
    expect(result.decide!.advisories).toHaveLength(1);
    expect(result.decide!.advisories[0]!.skillId).toBe('faratin-coaching-v1');
    expect(result.decide!.advisories[0]!.recommendedPrice).toBeGreaterThan(0);
  });

  it('dispatches validate hook only to knowledge skill', async () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const coaching = new FaratinCoachingSkill();
    const stack = SkillStack.of(knowledge, coaching);

    const ctx = makeHookContext('validate');
    const result = await stack.dispatchHook(ctx);

    // Only knowledge skill has validate hook
    expect(Object.keys(result.bySkill)).toHaveLength(1);
    expect(result.validate).toBeDefined();
    expect(result.validate!.hardRules.length).toBeGreaterThan(0);
    expect(result.validate!.hardRules.some(r => r.rule === 'IMEI_REQUIRED')).toBe(true);
  });

  it('filters skills by stage', () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const coaching = new FaratinCoachingSkill();
    const stack = SkillStack.of(knowledge, coaching);

    // understand: only knowledge
    expect(stack.getSkillsForStage('understand')).toHaveLength(1);
    // decide: both
    expect(stack.getSkillsForStage('decide')).toHaveLength(2);
    // validate: only knowledge
    expect(stack.getSkillsForStage('validate')).toHaveLength(1);
    // respond: only knowledge
    expect(stack.getSkillsForStage('respond')).toHaveLength(1);
    // context: neither
    expect(stack.getSkillsForStage('context')).toHaveLength(0);
  });
});

describe('Electronics Knowledge Skill', () => {
  const skill = new ElectronicsKnowledgeSkill();

  it('provides term hints for understand stage', async () => {
    const result = await skill.onHook(makeHookContext('understand'));
    const hints = result.content.termHints as Array<{ id: string }>;

    expect(hints).toBeDefined();
    expect(hints.length).toBeGreaterThan(5);
    expect(hints.some(h => h.id === 'battery_health')).toBe(true);
    expect(hints.some(h => h.id === 'carrier_lock')).toBe(true);
    expect(hints.some(h => h.id === 'imei_verification')).toBe(true);
  });

  it('provides valuation rules for decide stage', async () => {
    const result = await skill.onHook(makeHookContext('decide'));
    const content = result.content as DecideHookResult['content'];

    expect(content.categoryBrief).toContain('Electronics');
    expect(content.categoryBrief).toContain('Swappa');
    expect(content.valuationRules!.some(r => r.includes('Battery'))).toBe(true);
    expect(content.valuationRules!.some(r => r.includes('IMEI'))).toBe(true);

    // Knowledge skill should NOT provide recommendations
    expect(content.recommendedPrice).toBeUndefined();
    expect(content.acceptableRange).toBeUndefined();
    expect(content.suggestedTactic).toBeUndefined();
  });

  it('provides hard/soft validation rules', async () => {
    const result = await skill.onHook(makeHookContext('validate'));
    const content = result.content as { hardRules: unknown[]; softRules: unknown[] };

    expect(content.hardRules).toHaveLength(2); // IMEI, Find My
    expect(content.softRules).toHaveLength(2); // Battery, Cosmetic
  });

  it('provides respond guidance', async () => {
    const result = await skill.onHook(makeHookContext('respond'));
    expect(result.content.toneGuidance).toBeDefined();
    expect(result.content.terminology).toBeDefined();
  });
});

describe('Faratin Coaching Skill', () => {
  it('provides advisory price recommendation for BARGAINING', async () => {
    const skill = new FaratinCoachingSkill({ buddyStyle: 'balanced' });
    const result = await skill.onHook(makeHookContext('decide'));
    const content = result.content as DecideHookResult['content'];

    expect(content.recommendedPrice).toBeDefined();
    expect(content.recommendedPrice).toBeGreaterThan(0);
    expect(content.acceptableRange).toBeDefined();
    expect(content.suggestedTactic).toBeDefined();
  });

  it('aggressive style produces lower opening bid (buyer)', async () => {
    const aggressive = new FaratinCoachingSkill({ buddyStyle: 'aggressive' });
    const defensive = new FaratinCoachingSkill({ buddyStyle: 'defensive' });

    const ctx = makeHookContext('decide', {
      memory: makeMemory({ session: { phase: 'OPENING', round: 1, max_rounds: 15, rounds_remaining: 14, role: 'buyer' } as CoreMemory['session'] }),
      phase: 'OPENING',
    });

    const aggResult = (await aggressive.onHook(ctx)).content as DecideHookResult['content'];
    const defResult = (await defensive.onHook(ctx)).content as DecideHookResult['content'];

    // Aggressive buyer starts lower (more margin)
    expect(aggResult.recommendedPrice!).toBeLessThan(defResult.recommendedPrice!);
  });

  it('does not hook into validate/understand/respond', async () => {
    const skill = new FaratinCoachingSkill();

    // These stages should return empty content
    const understand = await skill.onHook(makeHookContext('understand'));
    const validate = await skill.onHook(makeHookContext('validate'));
    const respond = await skill.onHook(makeHookContext('respond'));

    expect(Object.keys(understand.content)).toHaveLength(0);
    expect(Object.keys(validate.content)).toHaveLength(0);
    expect(Object.keys(respond.content)).toHaveLength(0);
  });

  it('concedes more as rounds progress (Faratin curve)', async () => {
    const skill = new FaratinCoachingSkill({ buddyStyle: 'balanced' });

    const earlyCtx = makeHookContext('decide', {
      memory: makeMemory({ session: { phase: 'BARGAINING', round: 2, max_rounds: 15, rounds_remaining: 13, role: 'buyer' } as CoreMemory['session'] }),
    });
    const lateCtx = makeHookContext('decide', {
      memory: makeMemory({ session: { phase: 'BARGAINING', round: 12, max_rounds: 15, rounds_remaining: 3, role: 'buyer' } as CoreMemory['session'] }),
    });

    const earlyPrice = ((await skill.onHook(earlyCtx)).content as DecideHookResult['content']).recommendedPrice!;
    const latePrice = ((await skill.onHook(lateCtx)).content as DecideHookResult['content']).recommendedPrice!;

    // Later rounds: buyer offers higher (closer to floor) = more concession
    expect(latePrice).toBeGreaterThan(earlyPrice);
  });
});

describe('RefereeBriefing (Facts Only)', () => {
  it('provides facts without recommendations', () => {
    const memory = makeMemory();
    const facts = makeFacts(4);
    const opponent = makeOpponent();

    const briefing = computeBriefing(memory, facts, opponent);

    // Has factual data
    expect(briefing.opponentPattern).toBe('LINEAR');
    expect(briefing.timePressure).toBeGreaterThanOrEqual(0);
    expect(briefing.timePressure).toBeLessThanOrEqual(1);
    expect(briefing.gapTrend).toHaveLength(4);
    expect(briefing.opponentMoves.length).toBeGreaterThan(0);
    expect(typeof briefing.stagnation).toBe('boolean');
    expect(briefing.utilitySnapshot.u_total).toBeGreaterThan(0);

    // Does NOT have recommendations
    const briefingAny = briefing as Record<string, unknown>;
    expect(briefingAny.recommended_price).toBeUndefined();
    expect(briefingAny.acceptable_range).toBeUndefined();
    expect(briefingAny.suggested_tactic).toBeUndefined();
    expect(briefingAny.strategic_hints).toBeUndefined();
  });

  it('detects stagnation when gap barely moves', () => {
    const memory = makeMemory();
    // Facts with barely changing gap
    const stalledFacts: RoundFact[] = [
      { round_number: 1, buyer_offer: 84000, seller_offer: 86000, gap: 2000 } as RoundFact,
      { round_number: 2, buyer_offer: 84050, seller_offer: 85950, gap: 1900 } as RoundFact,
      { round_number: 3, buyer_offer: 84100, seller_offer: 85900, gap: 1800 } as RoundFact,
    ];

    const briefing = computeBriefing(memory, stalledFacts, null);
    expect(briefing.stagnation).toBe(true);
    expect(briefing.warnings.some(w => w.includes('barely moved'))).toBe(true);
  });

  it('warns when rounds are running low', () => {
    const memory = makeMemory({
      session: { phase: 'BARGAINING', round: 13, max_rounds: 15, rounds_remaining: 2, role: 'buyer' } as CoreMemory['session'],
    });

    const briefing = computeBriefing(memory, makeFacts(3), null);
    expect(briefing.warnings.some(w => w.includes('2 rounds remaining'))).toBe(true);
  });

  it('classifies opponent correctly', () => {
    const boulware: OpponentPattern = { aggression: 0.85, concession_rate: 0.005 } as OpponentPattern;
    const conceder: OpponentPattern = { aggression: 0.2, concession_rate: 0.08 } as OpponentPattern;

    const b1 = computeBriefing(makeMemory(), makeFacts(3), boulware);
    const b2 = computeBriefing(makeMemory(), makeFacts(3), conceder);

    expect(b1.opponentPattern).toBe('BOULWARE');
    expect(b2.opponentPattern).toBe('CONCEDER');
  });
});

describe('Coaching is Advisory (Integration)', () => {
  beforeEach(() => clearRegistry());

  it('coaching recommendation appears in advisories, not as fact', async () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const coaching = new FaratinCoachingSkill();
    const stack = SkillStack.of(knowledge, coaching);

    const ctx = makeHookContext('decide');
    const result = await stack.dispatchHook(ctx);

    // Coaching is clearly labeled as advisory
    expect(result.decide!.advisories.length).toBe(1);
    expect(result.decide!.advisories[0]!.skillId).toBe('faratin-coaching-v1');

    // Knowledge content is separate — no recommendations
    expect(result.decide!.categoryBrief).not.toContain('recommend');
    expect(result.decide!.valuationRules.every(r => !r.includes('recommend'))).toBe(true);
  });

  it('stack works without coaching skill', async () => {
    const knowledge = new ElectronicsKnowledgeSkill();
    const stack = SkillStack.of(knowledge);  // NO coaching

    const ctx = makeHookContext('decide');
    const result = await stack.dispatchHook(ctx);

    // Still has knowledge
    expect(result.decide!.categoryBrief).toContain('Electronics');
    expect(result.decide!.valuationRules.length).toBeGreaterThan(0);

    // No advisories
    expect(result.decide!.advisories).toHaveLength(0);
  });
});
