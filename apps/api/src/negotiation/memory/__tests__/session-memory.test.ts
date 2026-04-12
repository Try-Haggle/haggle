import { describe, it, expect, beforeEach } from 'vitest';
import { SessionMemoryStore } from '../session-memory.js';
import type { RoundFact } from '../../types.js';

function makeFact(round: number, overrides: Partial<RoundFact> = {}): RoundFact {
  return {
    round,
    phase: 'BARGAINING',
    buyer_offer: 500 + round * 10,
    seller_offer: 700 - round * 10,
    gap: 200 - round * 20,
    conditions_changed: {},
    coaching_given: { recommended: 550, tactic: 'anchoring' },
    coaching_followed: true,
    human_intervened: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('SessionMemoryStore', () => {
  let store: SessionMemoryStore;

  beforeEach(() => {
    store = new SessionMemoryStore();
  });

  it('should save and retrieve round facts', async () => {
    await store.saveRoundFact('s1', makeFact(1));
    await store.saveRoundFact('s1', makeFact(2));

    const facts = await store.getRecentFacts('s1', 5);
    expect(facts).toHaveLength(2);
    expect(facts[0]!.round).toBe(1);
  });

  it('should limit recent facts', async () => {
    for (let i = 1; i <= 10; i++) {
      await store.saveRoundFact('s2', makeFact(i));
    }

    const facts = await store.getRecentFacts('s2', 3);
    expect(facts).toHaveLength(3);
    expect(facts[0]!.round).toBe(8);
  });

  it('should search by condition', async () => {
    await store.saveRoundFact('s3', makeFact(1, { conditions_changed: { battery_health: '85%' } }));
    await store.saveRoundFact('s3', makeFact(2, { conditions_changed: {} }));
    await store.saveRoundFact('s3', makeFact(3, { conditions_changed: { battery_health: '90%' } }));

    const results = await store.searchByCondition('s3', 'battery');
    expect(results).toHaveLength(2);
  });

  it('should filter by phase', async () => {
    await store.saveRoundFact('s4', makeFact(1, { phase: 'OPENING' }));
    await store.saveRoundFact('s4', makeFact(2, { phase: 'BARGAINING' }));
    await store.saveRoundFact('s4', makeFact(3, { phase: 'BARGAINING' }));

    const bargaining = await store.getFactsByPhase('s4', 'BARGAINING');
    expect(bargaining).toHaveLength(2);
  });

  it('should update opponent pattern from facts', async () => {
    const facts: RoundFact[] = [
      makeFact(1, { buyer_offer: 500, seller_offer: 700, gap: 200 }),
      makeFact(2, { buyer_offer: 520, seller_offer: 680, gap: 160 }),
      makeFact(3, { buyer_offer: 540, seller_offer: 660, gap: 120 }),
    ];

    const pattern = await store.updateOpponentPattern('s5', facts);
    expect(pattern.aggression).toBeGreaterThanOrEqual(0);
    expect(pattern.aggression).toBeLessThanOrEqual(1);
    expect(pattern.concession_rate).toBeGreaterThan(0);
    expect(pattern.estimated_floor).toBeGreaterThanOrEqual(0);
  });

  it('should return default pattern for empty facts', async () => {
    const pattern = await store.updateOpponentPattern('s6', []);
    expect(pattern.aggression).toBe(0.5);
    expect(pattern.concession_rate).toBe(0);
  });

  it('should get opponent pattern after update', async () => {
    const facts = [makeFact(1), makeFact(2)];
    await store.updateOpponentPattern('s7', facts);
    const pattern = await store.getOpponentPattern('s7');
    expect(pattern).not.toBeNull();
  });

  it('should return null pattern for unknown session', async () => {
    expect(await store.getOpponentPattern('unknown')).toBeNull();
  });

  it('should get relevant context', async () => {
    for (let i = 1; i <= 6; i++) {
      await store.saveRoundFact('s8', makeFact(i, {
        conditions_changed: i % 2 === 0 ? { screen_condition: 'minor_scratches' } : {},
      }));
    }

    const ctx = await store.getRelevantContext('s8', 6, ['screen'], 0);
    expect(ctx.facts.length).toBeGreaterThanOrEqual(3);
  });

  it('should include more facts when stalled', async () => {
    for (let i = 1; i <= 6; i++) {
      await store.saveRoundFact('s9', makeFact(i));
    }

    const normal = await store.getRelevantContext('s9', 6, [], 0);
    const stalled = await store.getRelevantContext('s9', 6, [], 3);
    expect(stalled.facts.length).toBeGreaterThanOrEqual(normal.facts.length);
  });
});
