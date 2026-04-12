/**
 * memo-manager.ts
 *
 * Memo snapshot management with SHA-256 hash integrity.
 * Used by Stage 2 (Context) and Stage 6 (Persist) for memo provenance.
 */

import { createHash } from 'crypto';
import type { CoreMemory, RoundFact } from '../types.js';
import { encodeCompressed, encodeRaw, type MemoEncoding } from './memo-codec.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoSnapshot {
  shared: string;
  private: string;
  hash: string;       // SHA-256(shared)
  round: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest of the shared memo layer.
 */
export function computeMemoHash(sharedMemo: string): string {
  return createHash('sha256').update(sharedMemo).digest('hex');
}

// ---------------------------------------------------------------------------
// Snapshot creation
// ---------------------------------------------------------------------------

/**
 * Create a MemoSnapshot from CoreMemory at a given round.
 * Splits encoded memo into shared + private layers.
 */
export function createSnapshot(
  memory: CoreMemory,
  round: number,
  encoding: MemoEncoding,
  recentFacts?: RoundFact[],
): MemoSnapshot {
  let fullMemo: string;

  if (encoding === 'codec') {
    fullMemo = encodeCompressed(memory, recentFacts);
  } else {
    fullMemo = encodeRaw(memory);
  }

  // Split on separator between shared and private layers
  const separator = '\n---\n';
  const sepIndex = fullMemo.indexOf(separator);

  let shared: string;
  let priv: string;

  if (sepIndex >= 0) {
    shared = fullMemo.slice(0, sepIndex);
    priv = fullMemo.slice(sepIndex + separator.length);
  } else {
    // Raw encoding — treat entire content as shared
    shared = fullMemo;
    priv = '';
  }

  const hash = computeMemoHash(shared);

  return {
    shared,
    private: priv,
    hash,
    round,
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Integrity verification
// ---------------------------------------------------------------------------

/**
 * Verify that a MemoSnapshot's hash matches its shared content.
 */
export function verifyMemoIntegrity(snapshot: MemoSnapshot): boolean {
  const expected = computeMemoHash(snapshot.shared);
  return expected === snapshot.hash;
}
