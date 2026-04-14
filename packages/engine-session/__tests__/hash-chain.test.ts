import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  sha256,
  computeFactHash,
  verifyChain,
  getSessionChainHash,
  type RoundFactPayload,
} from '../src/integrity/index.js';

// ── helpers ─────────────────────────────────────────────────────

function makePayload(overrides: Partial<RoundFactPayload> = {}): RoundFactPayload {
  return {
    session_id: 'sess-001',
    round_no: 1,
    buyer_offer: '90000',
    seller_offer: '100000',
    gap: '10000',
    buyer_tactic: 'ANCHOR',
    seller_tactic: 'HOLD',
    conditions_changed: null,
    coaching_recommended_price: '92000',
    coaching_recommended_tactic: 'CONCEDE',
    coaching_followed: true,
    human_intervened: false,
    phase: 'OPENING',
    ...overrides,
  };
}

function buildChain(count: number): Array<{
  payload: RoundFactPayload;
  fact_hash: string;
  prev_fact_hash: string | null;
}> {
  const rounds: Array<{
    payload: RoundFactPayload;
    fact_hash: string;
    prev_fact_hash: string | null;
  }> = [];

  for (let i = 0; i < count; i++) {
    const payload = makePayload({
      round_no: i + 1,
      buyer_offer: String(90000 + i * 1000),
      seller_offer: String(100000 - i * 500),
    });
    const prevHash = i === 0 ? null : rounds[i - 1].fact_hash;
    const result = computeFactHash(payload, prevHash);
    rounds.push({
      payload,
      fact_hash: result.fact_hash,
      prev_fact_hash: result.prev_fact_hash,
    });
  }

  return rounds;
}

// ── canonicalize ────────────────────────────────────────────────

describe('canonicalize', () => {
  it('produces deterministic output with sorted keys', () => {
    const payload = makePayload();
    const result = canonicalize(payload);
    const parsed = JSON.parse(result);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it('produces same output for same data regardless of property order', () => {
    const a: RoundFactPayload = {
      session_id: 's1',
      round_no: 1,
      buyer_offer: '100',
      seller_offer: '200',
      gap: '100',
      buyer_tactic: null,
      seller_tactic: null,
      conditions_changed: null,
      coaching_recommended_price: null,
      coaching_recommended_tactic: null,
      coaching_followed: null,
      human_intervened: false,
      phase: null,
    };
    // Same data, different construction order (TypeScript objects)
    const b: RoundFactPayload = {
      phase: null,
      human_intervened: false,
      coaching_followed: null,
      coaching_recommended_tactic: null,
      coaching_recommended_price: null,
      conditions_changed: null,
      seller_tactic: null,
      buyer_tactic: null,
      gap: '100',
      seller_offer: '200',
      buyer_offer: '100',
      round_no: 1,
      session_id: 's1',
    };
    expect(canonicalize(a)).toBe(canonicalize(b));
  });
});

// ── sha256 ──────────────────────────────────────────────────────

describe('sha256', () => {
  it('returns 64-character hex string', () => {
    const result = sha256('hello');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256('test')).toBe(sha256('test'));
  });

  it('produces known output for empty string', () => {
    // Known SHA-256 of ""
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

// ── computeFactHash ─────────────────────────────────────────────

describe('computeFactHash', () => {
  it('uses GENESIS for first round (null prev)', () => {
    const payload = makePayload({ round_no: 1 });
    const result = computeFactHash(payload, null);
    expect(result.fact_hash).toHaveLength(64);
    expect(result.prev_fact_hash).toBeNull();
  });

  it('includes prev_fact_hash in chain', () => {
    const payload1 = makePayload({ round_no: 1 });
    const result1 = computeFactHash(payload1, null);

    const payload2 = makePayload({ round_no: 2, buyer_offer: '91000' });
    const result2 = computeFactHash(payload2, result1.fact_hash);

    expect(result2.prev_fact_hash).toBe(result1.fact_hash);
    expect(result2.fact_hash).not.toBe(result1.fact_hash);
  });

  it('changing any field changes the hash', () => {
    const baseline = computeFactHash(makePayload(), null);
    const modified = computeFactHash(makePayload({ buyer_offer: '91000' }), null);
    expect(modified.fact_hash).not.toBe(baseline.fact_hash);
  });

  it('changing prev_fact_hash changes the hash', () => {
    const payload = makePayload({ round_no: 2 });
    const a = computeFactHash(payload, 'hash_a');
    const b = computeFactHash(payload, 'hash_b');
    expect(a.fact_hash).not.toBe(b.fact_hash);
  });
});

// ── verifyChain ─────────────────────────────────────────────────

describe('verifyChain', () => {
  it('validates empty chain', () => {
    const result = verifyChain([]);
    expect(result).toEqual({ valid: true, broken_at_round: null, rounds_verified: 0 });
  });

  it('validates single-round chain', () => {
    const chain = buildChain(1);
    const result = verifyChain(chain);
    expect(result).toEqual({ valid: true, broken_at_round: null, rounds_verified: 1 });
  });

  it('validates multi-round chain', () => {
    const chain = buildChain(5);
    const result = verifyChain(chain);
    expect(result).toEqual({ valid: true, broken_at_round: null, rounds_verified: 5 });
  });

  it('detects tampered data in middle round', () => {
    const chain = buildChain(5);
    // Tamper round 3 data but keep original hash
    chain[2].payload.buyer_offer = '999999';
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.broken_at_round).toBe(3);
  });

  it('detects tampered hash in middle round', () => {
    const chain = buildChain(5);
    // Tamper round 3 hash
    chain[2].fact_hash = 'deadbeef'.repeat(8);
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    // Chain breaks at round 3 (hash mismatch) or round 4 (linkage mismatch)
    expect(result.broken_at_round).toBeLessThanOrEqual(4);
  });

  it('detects broken linkage (prev_fact_hash mismatch)', () => {
    const chain = buildChain(3);
    // Break the link between round 2 and round 3
    chain[2].prev_fact_hash = 'wrong_hash';
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.broken_at_round).toBe(3);
  });

  it('detects non-null prev_fact_hash on first round', () => {
    const chain = buildChain(2);
    chain[0].prev_fact_hash = 'should_be_null';
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    expect(result.broken_at_round).toBe(1);
  });
});

// ── getSessionChainHash ─────────────────────────────────────────

describe('getSessionChainHash', () => {
  it('returns null for empty rounds', () => {
    expect(getSessionChainHash([])).toBeNull();
  });

  it('returns last round fact_hash', () => {
    const chain = buildChain(3);
    expect(getSessionChainHash(chain)).toBe(chain[2].fact_hash);
  });
});
