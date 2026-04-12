import { describe, it, expect, beforeEach } from 'vitest';
import { CheckpointStore } from './checkpoint-store.js';
import type { CoreMemory, RevertPolicy } from '../types.js';
import { DEFAULT_REVERT_POLICY } from '../types.js';

function makeCoreMemory(phase: CoreMemory['session']['phase'] = 'BARGAINING'): CoreMemory {
  return {
    session: {
      session_id: 'sess-1',
      phase,
      round: 5,
      rounds_remaining: 15,
      role: 'buyer',
      max_rounds: 20,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: 1200,
      my_floor: 1500,
      current_offer: 1300,
      opponent_offer: 1400,
      gap: 100,
    },
    terms: {
      active: [],
      resolved_summary: '',
    },
    coaching: {
      recommended_price: 1350,
      acceptable_range: { min: 1200, max: 1400 },
      suggested_tactic: 'concede',
      hint: '',
      opponent_pattern: 'CONCEDER',
      convergence_rate: 0.6,
      time_pressure: 0.3,
      utility_snapshot: { u_price: 0.7, u_time: 0.5, u_risk: 0.8, u_quality: 0.6, u_total: 0.65 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: {
      style: 'balanced',
      preferred_tactic: 'anchoring',
      category_experience: 'electronics',
      condition_trade_success_rate: 0.7,
      best_timing: 'mid-session',
      tone: { style: 'professional', formality: 'neutral', emoji_use: false },
    },
    skill_summary: 'test skill',
  };
}

describe('CheckpointStore', () => {
  let store: CheckpointStore;
  const sid = 'sess-1';

  beforeEach(() => {
    store = new CheckpointStore();
  });

  it('save creates checkpoint with id and created_at', async () => {
    const cp = await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });

    expect(cp.id).toBeDefined();
    expect(cp.created_at).toBeGreaterThan(0);
    expect(cp.phase).toBe('OPENING');
    expect(cp.session_id).toBe(sid);
  });

  it('getLatest returns latest checkpoint for phase', async () => {
    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });

    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 2,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: { warranty: '30d' },
      total_rounds_at_checkpoint: 6,
      both_agreed: false,
    });

    const latest = await store.getLatest(sid, 'OPENING');
    expect(latest).not.toBeNull();
    expect(latest!.version).toBe(2);
    expect(latest!.total_rounds_at_checkpoint).toBe(6);
  });

  it('getLatest returns null for missing phase', async () => {
    const result = await store.getLatest(sid, 'CLOSING');
    expect(result).toBeNull();
  });

  it('getAll returns all checkpoints for session', async () => {
    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 8,
      both_agreed: false,
    });

    const all = await store.getAll(sid);
    expect(all).toHaveLength(2);
  });

  it('revert allowed: BARGAINING -> OPENING', async () => {
    // Save OPENING checkpoint
    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: { warranty: '30d' },
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });

    // Save BARGAINING checkpoint (current phase)
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 8,
      both_agreed: false,
    });

    const result = await store.revert(sid, 'OPENING', DEFAULT_REVERT_POLICY);

    expect(result.checkpoint.phase).toBe('OPENING');
    expect(result.restoredMemory.session.phase).toBe('OPENING');
    expect(result.newVersion).toBe(2); // version 1 + 1
    expect(result.cost).toBe(0); // first revert is free
  });

  it('revert allowed: CLOSING -> BARGAINING', async () => {
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 5,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'CLOSING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('CLOSING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 10,
      both_agreed: false,
    });

    const result = await store.revert(sid, 'BARGAINING', DEFAULT_REVERT_POLICY);
    expect(result.checkpoint.phase).toBe('BARGAINING');
    expect(result.cost).toBe(0); // first free
  });

  it('revert blocked from SETTLEMENT', async () => {
    await store.save({
      session_id: sid,
      phase: 'CLOSING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('CLOSING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 10,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'SETTLEMENT',
      version: 1,
      core_memory_snapshot: makeCoreMemory('SETTLEMENT'),
      conditions_state: {},
      total_rounds_at_checkpoint: 12,
      both_agreed: true,
    });

    await expect(
      store.revert(sid, 'CLOSING', DEFAULT_REVERT_POLICY),
    ).rejects.toThrow('Revert blocked from phase SETTLEMENT');
  });

  it('revert disallowed transition throws', async () => {
    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 8,
      both_agreed: false,
    });

    // BARGAINING -> DISCOVERY is not an allowed transition
    await expect(
      store.revert(sid, 'DISCOVERY', DEFAULT_REVERT_POLICY),
    ).rejects.toThrow('not allowed');
  });

  it('revert cost: first free, second costs 10 HC', async () => {
    // Setup: two checkpoints
    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 8,
      both_agreed: false,
    });

    // First revert: free
    const first = await store.revert(sid, 'OPENING', DEFAULT_REVERT_POLICY);
    expect(first.cost).toBe(0);

    // Need to re-save BARGAINING checkpoint to revert again
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 2,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 12,
      both_agreed: false,
    });

    // Second revert: 10 HC
    const second = await store.revert(sid, 'OPENING', DEFAULT_REVERT_POLICY);
    expect(second.cost).toBe(10);
  });

  it('getRevertCount tracks revert operations', async () => {
    expect(await store.getRevertCount(sid)).toBe(0);

    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 8,
      both_agreed: false,
    });

    await store.revert(sid, 'OPENING', DEFAULT_REVERT_POLICY);
    expect(await store.getRevertCount(sid)).toBe(1);
  });

  it('revert version increment based on target checkpoint version', async () => {
    await store.save({
      session_id: sid,
      phase: 'OPENING',
      version: 3, // already reverted twice before
      core_memory_snapshot: makeCoreMemory('OPENING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 3,
      both_agreed: false,
    });
    await store.save({
      session_id: sid,
      phase: 'BARGAINING',
      version: 1,
      core_memory_snapshot: makeCoreMemory('BARGAINING'),
      conditions_state: {},
      total_rounds_at_checkpoint: 8,
      both_agreed: false,
    });

    const result = await store.revert(sid, 'OPENING', DEFAULT_REVERT_POLICY);
    expect(result.newVersion).toBe(4); // 3 + 1
  });
});
