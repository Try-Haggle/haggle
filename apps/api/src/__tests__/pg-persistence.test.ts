/**
 * Unit tests for DB persistence layer (Step 73).
 *
 * Mocks the DB — no real Postgres required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Checkpoint, RoundFact, NegotiationPhase, CoreMemory } from '../negotiation/types.js';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const SESSION_ID = 'session-abc-123';

function makeCheckpoint(phase: NegotiationPhase, version: number): Checkpoint {
  return {
    id: `cp-${phase}-${version}`,
    session_id: SESSION_ID,
    phase,
    version,
    total_rounds_at_checkpoint: version * 3,
    core_memory_snapshot: {
      session: { session_id: SESSION_ID, phase, round: version * 3, rounds_remaining: 12, role: 'buyer', max_rounds: 15, intervention_mode: 'FULL_AUTO' },
      boundaries: { my_target: 80000, my_floor: 70000, current_offer: 85000, opponent_offer: 90000, gap: 10000 },
      terms: { active: [], resolved_summary: '' },
      coaching: { recommended_price: 82000, acceptable_range: { min: 78000, max: 86000 }, suggested_tactic: 'anchor', hint: '', opponent_pattern: 'LINEAR' as const, convergence_rate: 0.3, time_pressure: 0.5, utility_snapshot: { u_price: 0.6, u_time: 0.4, u_risk: 0.8, u_quality: 0.7, u_total: 0.625 }, strategic_hints: [], warnings: [] },
      buddy_dna: { style: 'balanced' as const, preferred_tactic: 'anchor', category_experience: 'electronics', condition_trade_success_rate: 0.7, best_timing: 'early', tone: { style: 'professional' as const, formality: 'neutral' as const, emoji_use: false } },
      skill_summary: 'electronics-v1',
    } as unknown as CoreMemory,
    conditions_state: {},
    both_agreed: false,
    created_at: Date.now(),
  };
}

function makeRoundFact(round: number): RoundFact {
  return {
    round,
    phase: 'BARGAINING',
    buyer_offer: 80000,
    seller_offer: 90000,
    gap: 10000,
    buyer_tactic: 'anchor',
    seller_tactic: undefined,
    conditions_changed: {},
    coaching_given: { recommended: 83000, tactic: 'concede-slowly' },
    coaching_followed: false,
    human_intervened: false,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// PgCheckpointPersistence tests
// ---------------------------------------------------------------------------

describe('PgCheckpointPersistence', () => {
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockSelect: ReturnType<typeof vi.fn>;
  let mockSelectResult: unknown[];
  let persistence: import('../negotiation/memory/pg-checkpoint-persistence.js').PgCheckpointPersistence;

  beforeEach(async () => {
    mockInsert = vi.fn().mockResolvedValue(undefined);
    mockSelectResult = [];

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockImplementation(() => Promise.resolve(mockSelectResult)),
    };
    mockSelect = vi.fn().mockReturnValue(selectChain);

    const mockDb = {
      insert: vi.fn().mockReturnValue({ values: mockInsert }),
      select: mockSelect,
    } as unknown as import('@haggle/db').Database;

    const { PgCheckpointPersistence } = await import('../negotiation/memory/pg-checkpoint-persistence.js');
    persistence = new PgCheckpointPersistence(mockDb);
  });

  it('save() inserts a checkpoint row', async () => {
    const cp = makeCheckpoint('BARGAINING', 1);
    await persistence.save(SESSION_ID, cp);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedValues = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues.sessionId).toBe(SESSION_ID);
    expect(insertedValues.phase).toBe('BARGAINING');
    expect(insertedValues.version).toBe(1);
  });

  it('save() maps total_rounds_at_checkpoint to roundAtCheckpoint', async () => {
    const cp = makeCheckpoint('OPENING', 2);
    await persistence.save(SESSION_ID, cp);
    const vals = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(vals.roundAtCheckpoint).toBe(cp.total_rounds_at_checkpoint);
  });

  it('save() includes memo_hash when present', async () => {
    const cp = makeCheckpoint('CLOSING', 3);
    cp.memo_hash = 'abc123hash';
    await persistence.save(SESSION_ID, cp);
    const vals = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(vals.memoHash).toBe('abc123hash');
  });

  it('load() returns empty array when no rows', async () => {
    const result = await persistence.load(SESSION_ID);
    expect(result).toEqual([]);
  });

  it('load() maps DB rows back to Checkpoint shape', async () => {
    const now = new Date();
    mockSelectResult = [
      {
        id: 'cp-uuid-1',
        sessionId: SESSION_ID,
        phase: 'BARGAINING',
        version: 1,
        roundAtCheckpoint: 3,
        coreMemorySnapshot: { session: { session_id: SESSION_ID } },
        conditionsState: { shipping: 'agreed' },
        memoHash: 'hash123',
        createdAt: now,
        reverted: false,
        revertedAt: null,
        revertReason: null,
      },
    ];

    const result = await persistence.load(SESSION_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('cp-uuid-1');
    expect(result[0]!.session_id).toBe(SESSION_ID);
    expect(result[0]!.phase).toBe('BARGAINING');
    expect(result[0]!.version).toBe(1);
    expect(result[0]!.total_rounds_at_checkpoint).toBe(3);
    expect(result[0]!.memo_hash).toBe('hash123');
    expect(result[0]!.created_at).toBe(now.getTime());
  });

  it('load() handles null conditionsState as empty object', async () => {
    mockSelectResult = [
      {
        id: 'cp-2', sessionId: SESSION_ID, phase: 'OPENING', version: 1,
        roundAtCheckpoint: 1, coreMemorySnapshot: {}, conditionsState: null,
        memoHash: null, createdAt: new Date(), reverted: false, revertedAt: null, revertReason: null,
      },
    ];
    const result = await persistence.load(SESSION_ID);
    expect(result[0]!.conditions_state).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PgRoundFactSink tests
// ---------------------------------------------------------------------------

describe('PgRoundFactSink', () => {
  let mockInsert: ReturnType<typeof vi.fn>;
  let mockDb: import('@haggle/db').Database;
  let sink: import('../negotiation/memory/pg-round-fact-sink.js').PgRoundFactSink;

  beforeEach(async () => {
    mockInsert = vi.fn().mockResolvedValue(undefined);
    mockDb = {
      insert: vi.fn().mockReturnValue({ values: mockInsert }),
    } as unknown as import('@haggle/db').Database;

    const { PgRoundFactSink } = await import('../negotiation/memory/pg-round-fact-sink.js');
    sink = new PgRoundFactSink();
  });

  it('flush() with no pending facts returns empty map', async () => {
    const result = await sink.flush(mockDb);
    expect(result.size).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('flush() inserts one row per pending fact', async () => {
    sink.add(SESSION_ID, 1, makeRoundFact(1));
    sink.add(SESSION_ID, 2, makeRoundFact(2));

    await sink.flush(mockDb);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('flush() returns a map with session fact_hash', async () => {
    sink.add(SESSION_ID, 1, makeRoundFact(1));
    const hashes = await sink.flush(mockDb);
    expect(hashes.has(SESSION_ID)).toBe(true);
    expect(typeof hashes.get(SESSION_ID)).toBe('string');
    expect(hashes.get(SESSION_ID)!.length).toBe(64); // SHA-256 hex
  });

  it('flush() links chain: round 2 prevFactHash === round 1 factHash', async () => {
    sink.add(SESSION_ID, 1, makeRoundFact(1));
    sink.add(SESSION_ID, 2, makeRoundFact(2));

    await sink.flush(mockDb);

    const round1Values = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    const round2Values = mockInsert.mock.calls[1][0] as Record<string, unknown>;

    expect(round1Values.prevFactHash).toBeNull();
    expect(round2Values.prevFactHash).toBe(round1Values.factHash);
  });

  it('flush() clears pending facts after successful flush', async () => {
    sink.add(SESSION_ID, 1, makeRoundFact(1));
    await sink.flush(mockDb);
    mockInsert.mockClear();

    // Second flush should insert nothing
    const hashes2 = await sink.flush(mockDb);
    expect(hashes2.size).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('getLastHash() returns null before any flush', async () => {
    expect(sink.getLastHash(SESSION_ID)).toBeNull();
  });

  it('getLastHash() returns the final hash after flush', async () => {
    sink.add(SESSION_ID, 1, makeRoundFact(1));
    const hashes = await sink.flush(mockDb);
    expect(sink.getLastHash(SESSION_ID)).toBe(hashes.get(SESSION_ID));
  });

  it('setLastHash() chains across flush calls (multi-round persistence)', async () => {
    // Simulate: round 1 was already persisted (hash loaded from DB)
    const existingHash = 'aaaa'.repeat(16);
    sink.setLastHash(SESSION_ID, existingHash);

    sink.add(SESSION_ID, 2, makeRoundFact(2));
    await sink.flush(mockDb);

    const round2Values = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(round2Values.prevFactHash).toBe(existingHash);
  });

  it('flush() hash chain verification: computeFactHash produces deterministic result', async () => {
    sink.add(SESSION_ID, 1, makeRoundFact(1));
    const hashes1 = await sink.flush(mockDb);
    const hash1 = hashes1.get(SESSION_ID)!;

    // Second sink instance with same data should produce same hash
    const { PgRoundFactSink: PgRoundFactSink2 } = await import('../negotiation/memory/pg-round-fact-sink.js');
    const sink2 = new PgRoundFactSink2();
    sink2.add(SESSION_ID, 1, makeRoundFact(1));
    const hashes2 = await sink2.flush(mockDb);
    const hash2 = hashes2.get(SESSION_ID)!;

    expect(hash1).toBe(hash2);
  });
});
