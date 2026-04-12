import { describe, it, expect } from 'vitest';
import { computeMemoHash, createSnapshot, verifyMemoIntegrity } from '../memo-manager.js';
import type { CoreMemory } from '../../types.js';
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
      opponent_pattern: 'LINEAR',
      convergence_rate: 0.5,
      time_pressure: 0.3,
      utility_snapshot: { u_price: 0.6, u_time: 0.7, u_risk: 0.5, u_quality: 0.5, u_total: 0.6 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
  };
}

describe('memo-manager', () => {
  describe('computeMemoHash', () => {
    it('returns a 64-character hex SHA-256 hash', () => {
      const hash = computeMemoHash('NS:BARGAINING|R3/10|buyer|FULL_AUTO');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces different hashes for different content', () => {
      const hash1 = computeMemoHash('content-A');
      const hash2 = computeMemoHash('content-B');
      expect(hash1).not.toBe(hash2);
    });

    it('produces same hash for same content', () => {
      const hash1 = computeMemoHash('identical-content');
      const hash2 = computeMemoHash('identical-content');
      expect(hash1).toBe(hash2);
    });
  });

  describe('createSnapshot', () => {
    it('creates a snapshot with codec encoding', () => {
      const snapshot = createSnapshot(makeMemory(), 3, 'codec');
      expect(snapshot.shared).toContain('NS:BARGAINING');
      expect(snapshot.private).toBeTruthy();
      expect(snapshot.hash).toHaveLength(64);
      expect(snapshot.round).toBe(3);
      expect(snapshot.timestamp).toBeGreaterThan(0);
    });

    it('creates a snapshot with raw encoding', () => {
      const snapshot = createSnapshot(makeMemory(), 3, 'raw');
      // Raw encoding puts everything in shared
      JSON.parse(snapshot.shared); // should be valid JSON
      expect(snapshot.private).toBe('');
      expect(snapshot.hash).toHaveLength(64);
    });

    it('separates shared and private layers in codec mode', () => {
      const snapshot = createSnapshot(makeMemory(), 3, 'codec');
      // Shared should have NS:, PT:, CL: but not SS: (private)
      expect(snapshot.shared).toContain('NS:');
      expect(snapshot.shared).toContain('PT:');
      expect(snapshot.private).toContain('SS:');
      expect(snapshot.private).toContain('OM:');
    });
  });

  describe('verifyMemoIntegrity', () => {
    it('returns true for valid snapshot', () => {
      const snapshot = createSnapshot(makeMemory(), 3, 'codec');
      expect(verifyMemoIntegrity(snapshot)).toBe(true);
    });

    it('returns false for tampered shared content', () => {
      const snapshot = createSnapshot(makeMemory(), 3, 'codec');
      snapshot.shared = 'TAMPERED CONTENT';
      expect(verifyMemoIntegrity(snapshot)).toBe(false);
    });

    it('returns true even if private layer changes (hash is only on shared)', () => {
      const snapshot = createSnapshot(makeMemory(), 3, 'codec');
      snapshot.private = 'MODIFIED PRIVATE DATA';
      // Hash is computed from shared layer only, so integrity check passes
      expect(verifyMemoIntegrity(snapshot)).toBe(true);
    });
  });
});
