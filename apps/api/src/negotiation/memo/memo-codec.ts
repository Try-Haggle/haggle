/**
 * memo-codec.ts
 *
 * Living Memo Compressed Codec (Doc 26 §3).
 * Independent module used by Stage 2 (Context) in the 6-Stage pipeline.
 * Does NOT touch the existing GrokFastAdapter S:|B:|C: encoding.
 */

import type { CoreMemory, RoundFact } from '../types.js';

export type MemoEncoding = 'codec' | 'raw';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode CoreMemory into a compressed memo string (~390 tokens).
 * Shared Layer format:
 *   NS:BARGAINING|R3/10|buyer|FULL_AUTO
 *   PT:85000→90000|gap:5000(5.6%)
 *   CL:rec:87000|tactic:reciprocal|opp:CONCEDER|conv:0.72
 *   RM:R1:COUNTER@88000→92000|R2:...
 *
 * Private Layer format:
 *   SS:t:83000|f:95000|β:1.5
 *   OM:CONCEDER(0.78)|ema:0.65|shifts:0
 *   TA:term_id=status|...
 *   TR:V7:SOFT@R2(detail)|auto_fix:0
 */
export function encodeCompressed(memory: CoreMemory, recentFacts?: RoundFact[]): string {
  const shared = encodeSharedLayer(memory, recentFacts);
  const priv = encodePrivateLayer(memory);
  return shared + '\n---\n' + priv;
}

/**
 * Encode CoreMemory as raw JSON string (~1000 tokens).
 */
export function encodeRaw(memory: CoreMemory): string {
  return JSON.stringify({
    session: memory.session,
    boundaries: memory.boundaries,
    coaching: {
      recommended_price: memory.coaching.recommended_price,
      acceptable_range: memory.coaching.acceptable_range,
      suggested_tactic: memory.coaching.suggested_tactic,
      opponent_pattern: memory.coaching.opponent_pattern,
      convergence_rate: memory.coaching.convergence_rate,
      time_pressure: memory.coaching.time_pressure,
    },
    terms: memory.terms,
    buddy_dna: { style: memory.buddy_dna.style, preferred_tactic: memory.buddy_dna.preferred_tactic },
  });
}

/**
 * Encode using specified encoding.
 */
export function encodeMemo(memory: CoreMemory, encoding: MemoEncoding, recentFacts?: RoundFact[]): string {
  if (encoding === 'codec') {
    return encodeCompressed(memory, recentFacts);
  }
  return encodeRaw(memory);
}

// ---------------------------------------------------------------------------
// Shared Layer encoding
// ---------------------------------------------------------------------------

function encodeSharedLayer(memory: CoreMemory, recentFacts?: RoundFact[]): string {
  const { session, boundaries, coaching } = memory;
  const lines: string[] = [];

  // NS: Negotiation State
  lines.push(
    `NS:${session.phase}|R${session.round}/${session.max_rounds}|${session.role}|${session.intervention_mode}`,
  );

  // PT: Price Trajectory
  const gapPct = boundaries.my_target !== 0
    ? ((boundaries.gap / Math.abs(boundaries.my_target)) * 100).toFixed(1)
    : '0.0';
  lines.push(
    `PT:${boundaries.current_offer}→${boundaries.opponent_offer}|gap:${boundaries.gap}(${gapPct}%)`,
  );

  // CL: Coaching Layer
  lines.push(
    `CL:rec:${coaching.recommended_price}|tactic:${coaching.suggested_tactic}|opp:${coaching.opponent_pattern}|conv:${coaching.convergence_rate.toFixed(2)}`,
  );

  // RM: Round Memory (recent facts, last 5)
  if (recentFacts && recentFacts.length > 0) {
    const recent = recentFacts.slice(-5);
    const rmEntries = recent.map((f) => {
      const tactic = f.buyer_tactic || f.seller_tactic || '';
      return `R${f.round}:${f.buyer_offer}→${f.seller_offer}${tactic ? '|t:' + tactic : ''}`;
    });
    lines.push('RM:' + rmEntries.join('|'));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Private Layer encoding
// ---------------------------------------------------------------------------

function encodePrivateLayer(memory: CoreMemory): string {
  const { boundaries, coaching, buddy_dna, terms } = memory;
  const lines: string[] = [];

  // SS: Strategy Snapshot
  const beta = buddy_dna.style === 'aggressive' ? 2.0 : buddy_dna.style === 'defensive' ? 0.5 : 1.5;
  lines.push(`SS:t:${boundaries.my_target}|f:${boundaries.my_floor}|β:${beta.toFixed(1)}`);

  // OM: Opponent Model
  const oppAgg = coaching.opponent_pattern === 'BOULWARE' ? 0.8
    : coaching.opponent_pattern === 'CONCEDER' ? 0.2
    : 0.5;
  lines.push(
    `OM:${coaching.opponent_pattern}(${oppAgg.toFixed(2)})|conv:${coaching.convergence_rate.toFixed(2)}|shifts:0`,
  );

  // TA: Terms Active
  if (terms.active.length > 0) {
    const termEntries = terms.active.map(
      (t) => `${t.term_id}=${t.status}${t.value !== undefined ? ':' + String(t.value) : ''}`,
    );
    lines.push('TA:' + termEntries.join('|'));
  }

  // TR: Tracking (warnings from coaching)
  if (coaching.warnings.length > 0) {
    lines.push('TR:' + coaching.warnings.map((w) => w.slice(0, 50)).join('|'));
  }

  return lines.join('\n');
}
