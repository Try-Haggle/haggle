import { describe, it, expect, vi } from 'vitest';
import { CheckpointStore, type CheckpointPersistence } from '../negotiation/memory/checkpoint-store.js';
import type { Checkpoint, CoreMemory, NegotiationPhase, RevertPolicy, RoundExplainability } from '../negotiation/types.js';

// ─── Helpers ───

function makeMemory(overrides?: Partial<CoreMemory>): CoreMemory {
  return {
    session: {
      session_id: 'test-session',
      phase: 'OPENING',
      round: 1,
      rounds_remaining: 14,
      role: 'buyer',
      max_rounds: 15,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 50000,
      my_floor: 70000,
      current_offer: 55000,
      opponent_offer: 65000,
      gap: 10000,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 58000,
      acceptable_range: { min: 50000, max: 65000 },
      suggested_tactic: 'reciprocal_concession',
      hint: 'test',
      opponent_pattern: 'UNKNOWN',
      convergence_rate: 0,
      time_pressure: 0.2,
      utility_snapshot: { u_price: 0.7, u_time: 0.8, u_risk: 0.9, u_quality: 0.7, u_total: 0.75 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: {
      style: 'balanced',
      preferred_tactic: 'reciprocal_concession',
      category_experience: 'electronics',
      condition_trade_success_rate: 0.5,
      best_timing: 'mid-session',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: 'test-skill',
    ...overrides,
  } as CoreMemory;
}

function makeCheckpointInput(overrides?: Partial<Omit<Checkpoint, 'id' | 'created_at'>>) {
  return {
    session_id: 'session-1',
    phase: 'OPENING' as NegotiationPhase,
    version: 1,
    core_memory_snapshot: makeMemory(),
    conditions_state: {},
    total_rounds_at_checkpoint: 3,
    both_agreed: false,
    ...overrides,
  };
}

describe('CheckpointStore', () => {
  describe('basic in-memory behavior (no persistence)', () => {
    it('saves and retrieves checkpoint', async () => {
      const store = new CheckpointStore();
      const cp = await store.save(makeCheckpointInput());

      expect(cp.id).toBeDefined();
      expect(cp.created_at).toBeGreaterThan(0);
      expect(cp.session_id).toBe('session-1');
      expect(cp.phase).toBe('OPENING');
    });

    it('gets latest checkpoint for a phase', async () => {
      const store = new CheckpointStore();
      await store.save(makeCheckpointInput({ version: 1 }));
      const cp2 = await store.save(makeCheckpointInput({ version: 2 }));

      const latest = await store.getLatest('session-1', 'OPENING');
      expect(latest).toBeDefined();
      expect(latest!.version).toBe(2);
    });

    it('returns null for nonexistent checkpoint', async () => {
      const store = new CheckpointStore();
      const result = await store.getLatest('nonexistent', 'OPENING');
      expect(result).toBeNull();
    });

    it('gets all checkpoints for a session', async () => {
      const store = new CheckpointStore();
      await store.save(makeCheckpointInput({ phase: 'OPENING' }));
      await store.save(makeCheckpointInput({ phase: 'BARGAINING' }));

      const all = await store.getAll('session-1');
      expect(all).toHaveLength(2);
    });

    it('reverts to target phase', async () => {
      const store = new CheckpointStore();
      await store.save(makeCheckpointInput({ phase: 'OPENING', version: 1 }));
      await store.save(makeCheckpointInput({ phase: 'BARGAINING', version: 2 }));

      const policy: RevertPolicy = {
        allowed_transitions: [{ from: 'BARGAINING', to: 'OPENING' }],
        blocked_from: ['SETTLEMENT'],
        first_free: true,
        revert_cost_hc: 10,
      };

      const result = await store.revert('session-1', 'OPENING', policy);
      expect(result.checkpoint.phase).toBe('OPENING');
      expect(result.newVersion).toBe(2);
      expect(result.cost).toBe(0); // first free
    });

    it('charges for second revert', async () => {
      const store = new CheckpointStore();
      await store.save(makeCheckpointInput({ phase: 'OPENING', version: 1 }));
      await store.save(makeCheckpointInput({ phase: 'BARGAINING', version: 2 }));

      const policy: RevertPolicy = {
        allowed_transitions: [
          { from: 'BARGAINING', to: 'OPENING' },
        ],
        blocked_from: ['SETTLEMENT'],
        first_free: true,
        revert_cost_hc: 10,
      };

      // First revert (free)
      await store.revert('session-1', 'OPENING', policy);

      // Add back to bargaining for second revert
      await store.save(makeCheckpointInput({ phase: 'BARGAINING', version: 3 }));
      const result2 = await store.revert('session-1', 'OPENING', policy);
      expect(result2.cost).toBe(10);
    });
  });

  describe('explainability and memo_hash in checkpoint', () => {
    it('saves checkpoint with explainability', async () => {
      const store = new CheckpointStore();
      const explainability: RoundExplainability = {
        round: 3,
        coach_recommendation: { price: 58000, basis: 'test', acceptable_range: { min: 50000, max: 65000 } },
        decision: { source: 'skill', action: 'COUNTER', reasoning_summary: 'test' },
        referee_result: { violations: [], action: 'PASS', auto_fix_applied: false },
        final_output: { price: 58000, action: 'COUNTER' },
      };

      const cp = await store.save(makeCheckpointInput({
        explainability,
        memo_hash: 'abc123',
      }));

      expect(cp.explainability).toEqual(explainability);
      expect(cp.memo_hash).toBe('abc123');
    });

    it('saves checkpoint without explainability (backward compat)', async () => {
      const store = new CheckpointStore();
      const cp = await store.save(makeCheckpointInput());
      expect(cp.explainability).toBeUndefined();
      expect(cp.memo_hash).toBeUndefined();
    });
  });

  describe('with persistence backend', () => {
    it('calls persistence.save on checkpoint save', async () => {
      const mockPersistence: CheckpointPersistence = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue([]),
      };

      const store = new CheckpointStore(mockPersistence);
      const cp = await store.save(makeCheckpointInput());

      expect(mockPersistence.save).toHaveBeenCalledOnce();
      expect(mockPersistence.save).toHaveBeenCalledWith('session-1', cp);
    });

    it('hydrates from persistence on demand', async () => {
      const storedCheckpoints: Checkpoint[] = [
        {
          id: 'cp-1',
          session_id: 'session-1',
          phase: 'OPENING',
          version: 1,
          core_memory_snapshot: makeMemory(),
          conditions_state: {},
          total_rounds_at_checkpoint: 2,
          both_agreed: false,
          created_at: Date.now() - 1000,
        },
      ];

      const mockPersistence: CheckpointPersistence = {
        save: vi.fn().mockResolvedValue(undefined),
        load: vi.fn().mockResolvedValue(storedCheckpoints),
      };

      const store = new CheckpointStore(mockPersistence);

      // Before hydration — empty
      const before = await store.getAll('session-1');
      expect(before).toHaveLength(0);

      // Hydrate from persistence
      await store.hydrate('session-1');

      const after = await store.getAll('session-1');
      expect(after).toHaveLength(1);
      expect(after[0]!.id).toBe('cp-1');
    });

    it('works without persistence (default behavior)', async () => {
      const store = new CheckpointStore();
      const cp = await store.save(makeCheckpointInput());
      const all = await store.getAll('session-1');
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(cp.id);
    });
  });
});
