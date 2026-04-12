import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointStore } from '../checkpoint-store.js';
import type { CoreMemory } from '../../types.js';
import { DEFAULT_REVERT_POLICY } from '../../types.js';

function makeMemory(phase: string): CoreMemory {
  return {
    session: {
      session_id: 'sess-1',
      phase: phase as CoreMemory['session']['phase'],
      round: 3,
      rounds_remaining: 12,
      role: 'buyer',
      max_rounds: 15,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: { my_target: 500, my_floor: 650, current_offer: 520, opponent_offer: 620, gap: 100 },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 530,
      acceptable_range: { min: 480, max: 650 },
      suggested_tactic: 'anchoring',
      hint: '',
      opponent_pattern: 'LINEAR',
      convergence_rate: 0.1,
      time_pressure: 0.2,
      utility_snapshot: { u_price: 0.7, u_time: 0.8, u_risk: 0.5, u_quality: 0.5, u_total: 0.65 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: {
      style: 'balanced',
      preferred_tactic: 'reciprocal_concession',
      category_experience: 'electronics',
      condition_trade_success_rate: 0.7,
      best_timing: 'mid-bargaining',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: 'test',
  };
}

describe('CheckpointStore', () => {
  let store: CheckpointStore;

  beforeEach(() => {
    store = new CheckpointStore();
  });

  it('should save a checkpoint', async () => {
    const cp = await store.save({
      session_id: 'sess-1',
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 2,
      both_agreed: false,
    });

    expect(cp.id).toBeDefined();
    expect(cp.created_at).toBeGreaterThan(0);
    expect(cp.phase).toBe('OPENING');
  });

  it('should get latest checkpoint for phase', async () => {
    await store.save({
      session_id: 'sess-1', phase: 'OPENING', version: 1,
      core_memory_snapshot: makeMemory('OPENING'), conditions_state: {},
      total_rounds_at_checkpoint: 2, both_agreed: false,
    });
    await store.save({
      session_id: 'sess-1', phase: 'OPENING', version: 2,
      core_memory_snapshot: makeMemory('OPENING'), conditions_state: {},
      total_rounds_at_checkpoint: 4, both_agreed: false,
    });

    const latest = await store.getLatest('sess-1', 'OPENING');
    expect(latest).not.toBeNull();
    expect(latest!.version).toBe(2);
  });

  it('should return null for missing checkpoint', async () => {
    expect(await store.getLatest('sess-1', 'BARGAINING')).toBeNull();
  });

  it('should revert from CLOSING to BARGAINING', async () => {
    await store.save({
      session_id: 'sess-1', phase: 'BARGAINING', version: 1,
      core_memory_snapshot: makeMemory('BARGAINING'), conditions_state: {},
      total_rounds_at_checkpoint: 5, both_agreed: false,
    });
    await store.save({
      session_id: 'sess-1', phase: 'CLOSING', version: 1,
      core_memory_snapshot: makeMemory('CLOSING'), conditions_state: {},
      total_rounds_at_checkpoint: 8, both_agreed: false,
    });

    const result = await store.revert('sess-1', 'BARGAINING', DEFAULT_REVERT_POLICY);
    expect(result.restoredMemory.session.phase).toBe('BARGAINING');
    expect(result.newVersion).toBe(2);
    expect(result.cost).toBe(0); // first_free
  });

  it('should charge HC for second revert', async () => {
    await store.save({
      session_id: 'sess-2', phase: 'BARGAINING', version: 1,
      core_memory_snapshot: makeMemory('BARGAINING'), conditions_state: {},
      total_rounds_at_checkpoint: 5, both_agreed: false,
    });
    await store.save({
      session_id: 'sess-2', phase: 'CLOSING', version: 1,
      core_memory_snapshot: makeMemory('CLOSING'), conditions_state: {},
      total_rounds_at_checkpoint: 8, both_agreed: false,
    });

    // First revert: free
    await store.revert('sess-2', 'BARGAINING', DEFAULT_REVERT_POLICY);

    // Add closing checkpoint again
    await store.save({
      session_id: 'sess-2', phase: 'CLOSING', version: 2,
      core_memory_snapshot: makeMemory('CLOSING'), conditions_state: {},
      total_rounds_at_checkpoint: 10, both_agreed: false,
    });

    // Second revert: costs HC
    const result = await store.revert('sess-2', 'BARGAINING', DEFAULT_REVERT_POLICY);
    expect(result.cost).toBe(10); // revert_cost_hc
  });

  it('should block revert from SETTLEMENT', async () => {
    await store.save({
      session_id: 'sess-3', phase: 'SETTLEMENT', version: 1,
      core_memory_snapshot: makeMemory('SETTLEMENT'), conditions_state: {},
      total_rounds_at_checkpoint: 12, both_agreed: true,
    });

    await expect(
      store.revert('sess-3', 'CLOSING', DEFAULT_REVERT_POLICY),
    ).rejects.toThrow('blocked');
  });

  it('should block invalid transition', async () => {
    await store.save({
      session_id: 'sess-4', phase: 'OPENING', version: 1,
      core_memory_snapshot: makeMemory('OPENING'), conditions_state: {},
      total_rounds_at_checkpoint: 3, both_agreed: false,
    });

    await expect(
      store.revert('sess-4', 'DISCOVERY', DEFAULT_REVERT_POLICY),
    ).rejects.toThrow('not allowed');
  });
});
