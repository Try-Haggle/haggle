import { describe, it, expect } from 'vitest';
import type { SessionSnapshot, DecisionThresholds, UtilityResult } from '@haggle/engine-core';
import {
  computeGroupCompetition,
  orchestrateGroup,
  handleSessionTerminal,
} from '../src/group/orchestrator.js';
import type {
  NegotiationGroup,
  GroupSnapshot,
  GroupAction,
} from '../src/group/types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeThresholds(overrides?: Partial<DecisionThresholds>): DecisionThresholds {
  return {
    u_threshold: 0.4,
    u_aspiration: 0.8,
    max_rounds: 10,
    stall_rounds: 3,
    ...overrides,
  };
}

function makeUtility(u_total: number): UtilityResult {
  return {
    v_price: u_total,
    v_time: 0,
    v_risk: 0,
    v_relationship: 0,
    u_total,
  };
}

function makeSnapshot(
  session_id: string,
  u_total: number,
  thresholdOverrides?: Partial<DecisionThresholds>,
): SessionSnapshot {
  return {
    session_id,
    utility: makeUtility(u_total),
    thresholds: makeThresholds(thresholdOverrides),
  };
}

function makeGroup(overrides?: Partial<NegotiationGroup>): NegotiationGroup {
  return {
    group_id: 'grp-1',
    topology: '1_BUYER_N_SELLERS',
    anchor_user_id: 'buyer-1',
    max_sessions: 5,
    session_ids: ['sess-1', 'sess-2', 'sess-3'],
    status: 'ACTIVE',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  };
}

function makeGroupSnapshot(
  sessions: SessionSnapshot[],
  groupOverrides?: Partial<NegotiationGroup>,
): GroupSnapshot {
  return {
    group: makeGroup(groupOverrides),
    sessions,
  };
}

// ── computeGroupCompetition ──────────────────────────────────────────

describe('computeGroupCompetition', () => {
  it('returns n_competitors=0 for empty sessions', () => {
    const snapshot = makeGroupSnapshot([]);
    const result = computeGroupCompetition(snapshot);
    expect(result.n_competitors).toBe(0);
    expect(result.competitive_pressure).toBe(0);
  });

  it('returns n_competitors=0 for single session', () => {
    const snapshot = makeGroupSnapshot([makeSnapshot('sess-1', 0.7)]);
    const result = computeGroupCompetition(snapshot);
    expect(result.n_competitors).toBe(0);
    expect(result.competitive_pressure).toBe(0);
  });

  it('computes n_competitors=1 for 2 sessions', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.7),
      makeSnapshot('sess-2', 0.5),
    ]);
    const result = computeGroupCompetition(snapshot);
    expect(result.n_competitors).toBe(1);
  });

  it('computes n_competitors=2 for 3 sessions', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.7),
      makeSnapshot('sess-2', 0.5),
      makeSnapshot('sess-3', 0.3),
    ]);
    const result = computeGroupCompetition(snapshot);
    expect(result.n_competitors).toBe(2);
  });

  it('computes competitive_pressure = batna / best_u_total', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.8),
      makeSnapshot('sess-2', 0.6),
    ]);
    const result = computeGroupCompetition(snapshot);
    // batna = 0.6, best = 0.8 → pressure = 0.75
    expect(result.competitive_pressure).toBeCloseTo(0.75, 4);
  });

  it('competitive_pressure = 0 when best_u_total is 0', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0),
      makeSnapshot('sess-2', 0),
    ]);
    const result = computeGroupCompetition(snapshot);
    expect(result.competitive_pressure).toBe(0);
  });
});

// ── orchestrateGroup ─────────────────────────────────────────────────

describe('orchestrateGroup', () => {
  it('returns close_group when 0 active sessions', () => {
    const snapshot = makeGroupSnapshot([]);
    const actions = orchestrateGroup(snapshot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('close_group');
  });

  it('returns no_action for single active session', () => {
    const snapshot = makeGroupSnapshot([makeSnapshot('sess-1', 0.5)]);
    const actions = orchestrateGroup(snapshot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('no_action');
  });

  it('returns update_competition + update_batna for 2+ active sessions below aspiration', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.6),
      makeSnapshot('sess-2', 0.5),
    ]);
    const actions = orchestrateGroup(snapshot);
    const actionTypes = actions.map((a) => a.action);
    expect(actionTypes).toContain('update_competition');
    expect(actionTypes).toContain('update_batna');
  });

  it('update_competition includes all active session_ids', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.6),
      makeSnapshot('sess-2', 0.5),
      makeSnapshot('sess-3', 0.4),
    ]);
    const actions = orchestrateGroup(snapshot);
    const updateComp = actions.find((a) => a.action === 'update_competition');
    expect(updateComp).toBeDefined();
    if (updateComp && updateComp.action === 'update_competition') {
      expect(updateComp.session_ids).toEqual(['sess-1', 'sess-2', 'sess-3']);
    }
  });

  it('update_batna has correct batna and best session', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.7),
      makeSnapshot('sess-2', 0.5),
    ]);
    const actions = orchestrateGroup(snapshot);
    const batnaAction = actions.find((a) => a.action === 'update_batna');
    expect(batnaAction).toBeDefined();
    if (batnaAction && batnaAction.action === 'update_batna') {
      expect(batnaAction.batna).toBeCloseTo(0.5, 4);
      expect(batnaAction.best_session_id).toBe('sess-1');
    }
  });

  it('returns supersede_losers when ACCEPT_BEST is recommended', () => {
    // u_total >= u_aspiration(0.8) triggers ACCEPT_BEST
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.9),
      makeSnapshot('sess-2', 0.5),
    ]);
    const actions = orchestrateGroup(snapshot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('supersede_losers');
    if (actions[0].action === 'supersede_losers') {
      expect(actions[0].winner_session_id).toBe('sess-1');
      expect(actions[0].loser_session_ids).toEqual(['sess-2']);
    }
  });

  it('supersede_losers includes all losers when multiple exist', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('sess-1', 0.9),
      makeSnapshot('sess-2', 0.5),
      makeSnapshot('sess-3', 0.3),
    ]);
    const actions = orchestrateGroup(snapshot);
    const supersede = actions.find((a) => a.action === 'supersede_losers');
    expect(supersede).toBeDefined();
    if (supersede && supersede.action === 'supersede_losers') {
      expect(supersede.winner_session_id).toBe('sess-1');
      expect(supersede.loser_session_ids).toHaveLength(2);
      expect(supersede.loser_session_ids).toContain('sess-2');
      expect(supersede.loser_session_ids).toContain('sess-3');
    }
  });

  it('returns no_action for non-ACTIVE group (RESOLVED)', () => {
    const snapshot = makeGroupSnapshot(
      [makeSnapshot('sess-1', 0.7)],
      { status: 'RESOLVED' },
    );
    const actions = orchestrateGroup(snapshot);
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('no_action');
    if (actions[0].action === 'no_action') {
      expect(actions[0].reason).toContain('RESOLVED');
    }
  });

  it('returns no_action for EXPIRED group', () => {
    const snapshot = makeGroupSnapshot(
      [makeSnapshot('sess-1', 0.7)],
      { status: 'EXPIRED' },
    );
    const actions = orchestrateGroup(snapshot);
    expect(actions[0].action).toBe('no_action');
  });

  it('returns no_action for CANCELLED group', () => {
    const snapshot = makeGroupSnapshot(
      [makeSnapshot('sess-1', 0.7)],
      { status: 'CANCELLED' },
    );
    const actions = orchestrateGroup(snapshot);
    expect(actions[0].action).toBe('no_action');
  });
});

// ── handleSessionTerminal ────────────────────────────────────────────

describe('handleSessionTerminal', () => {
  it('ACCEPTED → supersede_losers with all other session_ids', () => {
    const group = makeGroup({ session_ids: ['sess-1', 'sess-2', 'sess-3'] });
    const actions = handleSessionTerminal(group, 'sess-1', 'ACCEPTED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('supersede_losers');
    if (actions[0].action === 'supersede_losers') {
      expect(actions[0].winner_session_id).toBe('sess-1');
      expect(actions[0].loser_session_ids).toEqual(['sess-2', 'sess-3']);
    }
  });

  it('ACCEPTED with single session → no_action (no losers)', () => {
    const group = makeGroup({ session_ids: ['sess-1'] });
    const actions = handleSessionTerminal(group, 'sess-1', 'ACCEPTED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('no_action');
  });

  it('REJECTED with remaining sessions → no_action', () => {
    const group = makeGroup({ session_ids: ['sess-1', 'sess-2', 'sess-3'] });
    const actions = handleSessionTerminal(group, 'sess-1', 'REJECTED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('no_action');
    if (actions[0].action === 'no_action') {
      expect(actions[0].reason).toContain('2 session(s) remain');
    }
  });

  it('REJECTED as last session → close_group', () => {
    const group = makeGroup({ session_ids: ['sess-1'] });
    const actions = handleSessionTerminal(group, 'sess-1', 'REJECTED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('close_group');
  });

  it('EXPIRED with remaining sessions → no_action', () => {
    const group = makeGroup({ session_ids: ['sess-1', 'sess-2'] });
    const actions = handleSessionTerminal(group, 'sess-1', 'EXPIRED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('no_action');
    if (actions[0].action === 'no_action') {
      expect(actions[0].reason).toContain('1 session(s) remain');
    }
  });

  it('EXPIRED as last session → close_group', () => {
    const group = makeGroup({ session_ids: ['sess-1'] });
    const actions = handleSessionTerminal(group, 'sess-1', 'EXPIRED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('close_group');
    if (actions[0].action === 'close_group') {
      expect(actions[0].reason).toContain('last session');
    }
  });

  it('SUPERSEDED → no_action', () => {
    const group = makeGroup({ session_ids: ['sess-1', 'sess-2'] });
    const actions = handleSessionTerminal(group, 'sess-2', 'SUPERSEDED');
    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('no_action');
    if (actions[0].action === 'no_action') {
      expect(actions[0].reason).toContain('superseded');
    }
  });

  it('ACCEPTED identifies correct losers (not the winner)', () => {
    const group = makeGroup({ session_ids: ['a', 'b', 'c', 'd'] });
    const actions = handleSessionTerminal(group, 'c', 'ACCEPTED');
    if (actions[0].action === 'supersede_losers') {
      expect(actions[0].loser_session_ids).toEqual(['a', 'b', 'd']);
      expect(actions[0].loser_session_ids).not.toContain('c');
    }
  });
});

// ── Edge cases ───────────────────────────────────────────────────────

describe('edge cases', () => {
  it('N_BUYERS_1_SELLER topology works the same as 1_BUYER_N_SELLERS', () => {
    const snapshot = makeGroupSnapshot(
      [makeSnapshot('sess-1', 0.6), makeSnapshot('sess-2', 0.5)],
      { topology: 'N_BUYERS_1_SELLER' },
    );
    const actions = orchestrateGroup(snapshot);
    const actionTypes = actions.map((a) => a.action);
    expect(actionTypes).toContain('update_competition');
  });

  it('orchestrateGroup only evaluates sessions in snapshot, not session_ids', () => {
    // group has 3 session_ids, but snapshot only has 1 active session
    const snapshot = makeGroupSnapshot(
      [makeSnapshot('sess-1', 0.6)],
      { session_ids: ['sess-1', 'sess-2', 'sess-3'] },
    );
    const actions = orchestrateGroup(snapshot);
    // Only 1 active session → no_action
    expect(actions[0].action).toBe('no_action');
  });

  it('max_sessions does not affect orchestration logic', () => {
    const snapshot = makeGroupSnapshot(
      [makeSnapshot('sess-1', 0.6), makeSnapshot('sess-2', 0.5)],
      { max_sessions: 2 },
    );
    const actions = orchestrateGroup(snapshot);
    expect(actions.length).toBeGreaterThan(0);
    // Should still produce competition actions
    const actionTypes = actions.map((a) => a.action);
    expect(actionTypes).toContain('update_competition');
  });

  it('competition context has correct n_competitors with 4 sessions', () => {
    const snapshot = makeGroupSnapshot([
      makeSnapshot('s1', 0.7),
      makeSnapshot('s2', 0.6),
      makeSnapshot('s3', 0.5),
      makeSnapshot('s4', 0.4),
    ]);
    const result = computeGroupCompetition(snapshot);
    expect(result.n_competitors).toBe(3);
  });
});
