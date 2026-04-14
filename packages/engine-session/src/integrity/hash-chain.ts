// Hash chain implementation for tamper-proof negotiation records (Doc 31 §4).
//
// Level 1: Row-level hash — sha256(canonical JSON of row data)
// Level 2: Chain hash — each round includes previous round's hash
// Level 3: On-chain anchor — final chain hash stored on Base L2
//
// Uses Node.js built-in crypto (standard library, not external dep).

import { createHash } from 'node:crypto';
import type { RoundFactPayload, FactHashResult, ChainVerificationResult } from './types.js';

const GENESIS_MARKER = 'GENESIS';

/**
 * Serialize a RoundFactPayload to a canonical string for hashing.
 *
 * Deterministic: keys are sorted alphabetically, null values preserved,
 * numbers serialized without trailing decimals.
 */
export function canonicalize(payload: RoundFactPayload): string {
  const ordered: Record<string, unknown> = {};
  const keys = Object.keys(payload).sort() as (keyof RoundFactPayload)[];
  for (const key of keys) {
    ordered[key] = payload[key];
  }
  return JSON.stringify(ordered);
}

/**
 * Compute SHA-256 hex digest of a string.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Compute the fact hash for a single round.
 *
 * fact_hash = sha256(canonical(payload) + prev_fact_hash)
 *
 * For the first round (round_no === 1 or no previous hash),
 * prev_fact_hash is set to "GENESIS".
 *
 * @param payload The round fact data to hash.
 * @param prevFactHash The previous round's fact_hash, or null for the first round.
 */
export function computeFactHash(
  payload: RoundFactPayload,
  prevFactHash: string | null,
): FactHashResult {
  const prev = prevFactHash ?? GENESIS_MARKER;
  const canonical = canonicalize(payload);
  const hashInput = canonical + prev;
  return {
    fact_hash: sha256(hashInput),
    prev_fact_hash: prevFactHash,
  };
}

/**
 * Verify a sequence of round facts forms a valid hash chain.
 *
 * Each round's fact_hash must equal sha256(canonical(payload) + prev_fact_hash).
 * The first round's prev_fact_hash must be null (GENESIS).
 *
 * @param rounds Array of { payload, fact_hash, prev_fact_hash } sorted by round_no ascending.
 */
export function verifyChain(
  rounds: Array<{
    payload: RoundFactPayload;
    fact_hash: string;
    prev_fact_hash: string | null;
  }>,
): ChainVerificationResult {
  if (rounds.length === 0) {
    return { valid: true, broken_at_round: null, rounds_verified: 0 };
  }

  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];

    // Chain linkage check: first round must have null prev, others must link
    if (i === 0) {
      if (round.prev_fact_hash !== null) {
        return {
          valid: false,
          broken_at_round: round.payload.round_no,
          rounds_verified: i,
        };
      }
    } else {
      if (round.prev_fact_hash !== rounds[i - 1].fact_hash) {
        return {
          valid: false,
          broken_at_round: round.payload.round_no,
          rounds_verified: i,
        };
      }
    }

    // Hash integrity check
    const expected = computeFactHash(round.payload, round.prev_fact_hash);
    if (expected.fact_hash !== round.fact_hash) {
      return {
        valid: false,
        broken_at_round: round.payload.round_no,
        rounds_verified: i,
      };
    }
  }

  return {
    valid: true,
    broken_at_round: null,
    rounds_verified: rounds.length,
  };
}

/**
 * Get the session-level chain hash (the last round's fact_hash).
 * This is the value stored in negotiation_sessions.session_fact_chain_hash
 * and anchored on-chain.
 */
export function getSessionChainHash(
  rounds: Array<{ fact_hash: string }>,
): string | null {
  if (rounds.length === 0) return null;
  return rounds[rounds.length - 1].fact_hash;
}
