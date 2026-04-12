import { describe, it, expect, beforeEach } from 'vitest';
import { SessionMemoryStore } from './session-memory.js';
import type { RoundFact } from '../types.js';

function makeFact(overrides: Partial<RoundFact> = {}): RoundFact {
  return {
    round: 1,
    phase: 'BARGAINING',
    buyer_offer: 1300,
    seller_offer: 1450,
    gap: 150,
    conditions_changed: {},
    coaching_given: { recommended: 1350, tactic: 'concede' },
    coaching_followed: true,
    human_intervened: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('SessionMemoryStore', () => {
  let store: SessionMemoryStore;
  const sid = 'sess-1';

  beforeEach(() => {
    store = new SessionMemoryStore();
  });

  it('saveRoundFact + getRecentFacts roundtrip', async () => {
    await store.saveRoundFact(sid, makeFact({ round: 1 }));
    await store.saveRoundFact(sid, makeFact({ round: 2 }));
    await store.saveRoundFact(sid, makeFact({ round: 3 }));

    const recent = await store.getRecentFacts(sid, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.round).toBe(2);
    expect(recent[1]!.round).toBe(3);
  });

  it('getRecentFacts returns empty for unknown session', async () => {
    const facts = await store.getRecentFacts('unknown', 5);
    expect(facts).toHaveLength(0);
  });

  it('searchByCondition finds facts with matching condition keys', async () => {
    await store.saveRoundFact(sid, makeFact({ round: 1, conditions_changed: { warranty: '30d' } }));
    await store.saveRoundFact(sid, makeFact({ round: 2, conditions_changed: { shipping: 'free' } }));
    await store.saveRoundFact(sid, makeFact({ round: 3, conditions_changed: { warranty: '60d' } }));

    const results = await store.searchByCondition(sid, 'warranty');
    expect(results).toHaveLength(2);
    expect(results[0]!.round).toBe(1);
    expect(results[1]!.round).toBe(3);
  });

  it('searchByCondition finds facts with matching condition values', async () => {
    await store.saveRoundFact(sid, makeFact({ round: 1, conditions_changed: { delivery: 'express_shipping' } }));
    await store.saveRoundFact(sid, makeFact({ round: 2, conditions_changed: { payment: 'upfront' } }));

    const results = await store.searchByCondition(sid, 'express');
    expect(results).toHaveLength(1);
    expect(results[0]!.round).toBe(1);
  });

  it('getFactsByPhase filters by phase', async () => {
    await store.saveRoundFact(sid, makeFact({ round: 1, phase: 'OPENING' }));
    await store.saveRoundFact(sid, makeFact({ round: 2, phase: 'BARGAINING' }));
    await store.saveRoundFact(sid, makeFact({ round: 3, phase: 'BARGAINING' }));
    await store.saveRoundFact(sid, makeFact({ round: 4, phase: 'CLOSING' }));

    const bargaining = await store.getFactsByPhase(sid, 'BARGAINING');
    expect(bargaining).toHaveLength(2);
    expect(bargaining[0]!.round).toBe(2);
    expect(bargaining[1]!.round).toBe(3);
  });

  it('updateOpponentPattern computes pattern from facts', async () => {
    const facts = [
      makeFact({ round: 1, buyer_offer: 1200, seller_offer: 1500, gap: 300, seller_tactic: 'anchoring' }),
      makeFact({ round: 2, buyer_offer: 1250, seller_offer: 1450, gap: 200, seller_tactic: 'concede' }),
      makeFact({ round: 3, buyer_offer: 1300, seller_offer: 1400, gap: 100, seller_tactic: 'concede' }),
    ];

    const pattern = await store.updateOpponentPattern(sid, facts);

    expect(pattern.concession_rate).toBeGreaterThan(0);
    expect(pattern.preferred_tactics).toContain('anchoring');
    expect(pattern.preferred_tactics).toContain('concede');
    expect(pattern.aggression).toBeGreaterThanOrEqual(0);
    expect(pattern.aggression).toBeLessThanOrEqual(1);
    expect(pattern.condition_flexibility).toBeGreaterThanOrEqual(0);
    expect(pattern.estimated_floor).toBeGreaterThanOrEqual(0);
  });

  it('updateOpponentPattern with empty facts returns defaults', async () => {
    const pattern = await store.updateOpponentPattern(sid, []);
    expect(pattern.aggression).toBe(0.5);
    expect(pattern.concession_rate).toBe(0);
    expect(pattern.preferred_tactics).toEqual([]);
  });

  it('getOpponentPattern returns null for unknown session', async () => {
    const pattern = await store.getOpponentPattern('unknown');
    expect(pattern).toBeNull();
  });

  it('getOpponentPattern returns stored pattern after update', async () => {
    const facts = [
      makeFact({ round: 1, buyer_offer: 1200, seller_offer: 1500, gap: 300 }),
      makeFact({ round: 2, buyer_offer: 1300, seller_offer: 1400, gap: 100 }),
    ];
    await store.updateOpponentPattern(sid, facts);

    const pattern = await store.getOpponentPattern(sid);
    expect(pattern).not.toBeNull();
    expect(pattern!.concession_rate).toBeGreaterThan(0);
  });

  it('getRelevantContext returns more facts when stalled', async () => {
    for (let i = 1; i <= 8; i++) {
      await store.saveRoundFact(sid, makeFact({ round: i }));
    }

    // Normal: 3 recent facts
    const normal = await store.getRelevantContext(sid, 8, [], 0);
    expect(normal.facts).toHaveLength(3);

    // Stalled: 5 recent facts
    const stalled = await store.getRelevantContext(sid, 8, [], 3);
    expect(stalled.facts).toHaveLength(5);
  });

  it('getRelevantContext includes condition-related facts', async () => {
    await store.saveRoundFact(sid, makeFact({ round: 1, conditions_changed: { warranty: '30d' } }));
    await store.saveRoundFact(sid, makeFact({ round: 2, conditions_changed: {} }));
    await store.saveRoundFact(sid, makeFact({ round: 3, conditions_changed: {} }));
    await store.saveRoundFact(sid, makeFact({ round: 4, conditions_changed: {} }));
    await store.saveRoundFact(sid, makeFact({ round: 5, conditions_changed: {} }));

    // Without unresolved conditions: only last 3
    const noConditions = await store.getRelevantContext(sid, 5, [], 0);
    expect(noConditions.facts).toHaveLength(3);
    expect(noConditions.facts.map((f) => f.round)).toEqual([3, 4, 5]);

    // With unresolved warranty: includes round 1
    const withConditions = await store.getRelevantContext(sid, 5, ['warranty'], 0);
    expect(withConditions.facts.map((f) => f.round)).toContain(1);
    expect(withConditions.facts.length).toBeGreaterThan(3);
  });

  it('getRelevantContext includes pattern summary when available', async () => {
    await store.saveRoundFact(sid, makeFact({ round: 1, buyer_offer: 1200, seller_offer: 1500, gap: 300 }));
    await store.saveRoundFact(sid, makeFact({ round: 2, buyer_offer: 1300, seller_offer: 1400, gap: 100 }));

    await store.updateOpponentPattern(sid, [
      makeFact({ round: 1, buyer_offer: 1200, seller_offer: 1500, gap: 300 }),
      makeFact({ round: 2, buyer_offer: 1300, seller_offer: 1400, gap: 100 }),
    ]);

    const ctx = await store.getRelevantContext(sid, 2, [], 0);
    expect(ctx.patternSummary).toBeDefined();
    expect(ctx.patternSummary).toContain('aggression:');
    expect(ctx.patternSummary).toContain('concession:');
  });
});
