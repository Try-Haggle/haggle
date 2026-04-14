/**
 * referee/briefing.ts
 *
 * RefereeBriefing — facts-only context the referee provides to the pipeline.
 * Replaces the old RefereeCoaching which mixed facts with recommendations.
 *
 * Principle: "What happened" not "What to do".
 *   - Coaching (recommendations) is now a Skill (faratin-coaching).
 *   - Briefing is standardizable: all HNP implementations can provide the same facts.
 */

import type { CoreMemory, RoundFact, OpponentPattern } from '../types.js';
import type { RefereeBriefing } from '../skills/skill-types.js';

/**
 * Compute referee briefing from session state.
 * All outputs are factual observations — no recommendations.
 */
export function computeBriefing(
  memory: CoreMemory,
  recentFacts: RoundFact[],
  opponentPattern: OpponentPattern | null,
): RefereeBriefing {
  const { session, boundaries } = memory;
  const { max_rounds, rounds_remaining, round } = session;

  // ── Time pressure (fact: fraction of rounds elapsed) ──
  const timePressure = max_rounds > 0 ? 1 - rounds_remaining / max_rounds : 0;

  // ── Gap trend (last N gaps, factual) ──
  const gapTrend = recentFacts.slice(-5).map(f => f.gap);

  // ── Opponent moves (price deltas, signed, factual) ──
  const opponentMoves: number[] = [];
  const role = session.role;
  for (let i = 1; i < recentFacts.length && i < 5; i++) {
    const prev = recentFacts[i - 1]!;
    const curr = recentFacts[i]!;
    const prevPrice = role === 'buyer' ? prev.seller_offer : prev.buyer_offer;
    const currPrice = role === 'buyer' ? curr.seller_offer : curr.buyer_offer;
    opponentMoves.push(currPrice - prevPrice);
  }

  // ── Stagnation detection (factual: gap barely moved in last 2 rounds) ──
  let stagnation = false;
  if (gapTrend.length >= 3) {
    const last3 = gapTrend.slice(-3);
    const maxDelta = Math.max(
      Math.abs(last3[1]! - last3[0]!),
      Math.abs(last3[2]! - last3[1]!),
    );
    stagnation = maxDelta < 200; // less than $2 movement
  }

  // ── Utility snapshot (factual computation) ──
  const range = Math.abs(boundaries.my_floor - boundaries.my_target) || 1;
  const u_price = Math.max(0, Math.min(1,
    1 - Math.abs(boundaries.current_offer - boundaries.my_target) / range
  ));
  const u_time = Math.max(0, 1 - timePressure);
  const u_risk = 0.5; // default without trust-core DB query
  const u_total = u_price * 0.5 + u_time * 0.2 + u_risk * 0.3;

  // ── Opponent pattern (factual classification) ──
  let patternLabel = 'UNKNOWN';
  if (opponentPattern) {
    if (opponentPattern.aggression > 0.7) patternLabel = 'BOULWARE';
    else if (opponentPattern.aggression < 0.3) patternLabel = 'CONCEDER';
    else patternLabel = 'LINEAR';
  }

  // ── Warnings (factual observations only) ──
  const warnings: string[] = [];
  if (rounds_remaining <= 3 && rounds_remaining > 0) {
    warnings.push(`${rounds_remaining} rounds remaining.`);
  }
  if (stagnation) {
    warnings.push('Gap barely moved in last 3 rounds.');
  }
  if (boundaries.current_offer > 0 && boundaries.my_floor > 0) {
    const roomUsed = Math.abs(boundaries.current_offer - boundaries.my_target) / range;
    if (roomUsed > 0.8) {
      warnings.push(`Room used: ${(roomUsed * 100).toFixed(0)}% of range.`);
    }
  }

  return {
    opponentPattern: patternLabel,
    timePressure,
    gapTrend,
    opponentMoves,
    stagnation,
    utilitySnapshot: {
      u_price: round2(u_price),
      u_time: round2(u_time),
      u_risk: round2(u_risk),
      u_total: round2(u_total),
    },
    warnings,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
