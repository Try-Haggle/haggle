/** @deprecated Use RefereeBriefing (briefing.ts) + FaratinCoachingSkill instead. */

import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  BuddyDNA,
  RefereeCoaching,
  OpponentPatternType,
} from '../types.js';
import { computeCounterOffer } from '@haggle/engine-core';
import { eq, trustScores, type Database } from '@haggle/db';

// ─── Style-based margin for opening anchor ───
const STYLE_MARGIN: Record<BuddyDNA['style'], number> = {
  aggressive: 0.15,
  balanced: 0.10,
  defensive: 0.05,
};

// ─── EMA decay factor for opponent pattern classification ───
const EMA_ALPHA = 0.3;

/**
 * Compute referee coaching for the current round.
 * When db + counterpartyId are supplied, queries the counterparty's combined
 * trust score from the DB and uses it to set u_risk. Falls back to 0.5 if
 * the query fails or the arguments are omitted.
 */
export async function computeCoachingAsync(
  memory: CoreMemory,
  recentFacts: RoundFact[],
  opponentPattern: OpponentPattern | null,
  buddyDna: BuddyDNA,
  db: Database,
  counterpartyId: string,
): Promise<RefereeCoaching> {
  let u_risk = 0.5;
  try {
    const rows = await db
      .select({ score: trustScores.score })
      .from(trustScores)
      .where(eq(trustScores.actorId, counterpartyId))
      .limit(1);
    const row = rows[0];
    if (row) {
      const parsed = parseFloat(String(row.score));
      if (!Number.isNaN(parsed)) {
        u_risk = clamp01(parsed / 100);
      }
    }
  } catch {
    // Non-fatal: fall back to default
    u_risk = 0.5;
  }
  return _computeCoaching(memory, recentFacts, opponentPattern, buddyDna, u_risk);
}

/**
 * Synchronous version — no DB, uses 0.5 defaults for u_risk/u_quality.
 * Kept for callers that cannot pass a DB instance.
 */
export function computeCoaching(
  memory: CoreMemory,
  recentFacts: RoundFact[],
  opponentPattern: OpponentPattern | null,
  buddyDna: BuddyDNA,
): RefereeCoaching {
  return _computeCoaching(memory, recentFacts, opponentPattern, buddyDna, 0.5);
}

function _computeCoaching(
  memory: CoreMemory,
  recentFacts: RoundFact[],
  opponentPattern: OpponentPattern | null,
  buddyDna: BuddyDNA,
  u_risk: number,
): RefereeCoaching {
  const { session, boundaries } = memory;
  const { phase, role, rounds_remaining, max_rounds, round } = session;

  // ─── Time pressure ───
  const time_pressure = max_rounds > 0 ? 1 - rounds_remaining / max_rounds : 0;

  // ─── Recommended price (phase-dependent) ───
  let recommended_price: number;
  if (phase === 'DISCOVERY') {
    // No price recommendation during discovery
    recommended_price = 0;
  } else if (phase === 'OPENING') {
    // Initial anchor: target + margin based on style
    const margin = STYLE_MARGIN[buddyDna.style] ?? 0.10;
    if (role === 'buyer') {
      // Buyer wants lower: start below target
      recommended_price = boundaries.my_target * (1 - margin);
    } else {
      // Seller wants higher: start above target
      recommended_price = boundaries.my_target * (1 + margin);
    }
  } else if (phase === 'BARGAINING') {
    // Faratin concession curve
    const t = max_rounds > 0 ? round / max_rounds : 0;
    const beta = buddyDna.style === 'aggressive' ? 2.0 : buddyDna.style === 'defensive' ? 0.5 : 1.0;
    recommended_price = computeCounterOffer({
      p_start: boundaries.my_target,
      p_limit: boundaries.my_floor,
      t,
      T: 1, // normalized
      beta,
    });
  } else {
    // CLOSING / SETTLEMENT: last known offer as confirmation price
    recommended_price = boundaries.current_offer || boundaries.my_target;
  }

  // ─── Acceptable range ───
  const rangePadding = Math.abs(boundaries.my_target - boundaries.my_floor) * 0.1;
  let acceptable_range: { min: number; max: number };
  if (role === 'buyer') {
    // Buyer: min = recommended - padding, max = floor (ceiling for buyer)
    acceptable_range = {
      min: Math.max(0, recommended_price - rangePadding),
      max: boundaries.my_floor,
    };
  } else {
    // Seller: min = floor (bottom for seller), max = recommended + padding
    acceptable_range = {
      min: boundaries.my_floor,
      max: recommended_price + rangePadding,
    };
  }

  // ─── Opponent pattern classification (EMA-based) ───
  const opponent_pattern = classifyOpponent(recentFacts, role, opponentPattern);

  // ─── Convergence rate ───
  const convergence_rate = computeConvergenceRate(recentFacts);

  // ─── Utility snapshot (simplified — real u_total from engine-core would be better) ───
  const u_price_raw = boundaries.my_floor > 0
    ? 1 - Math.abs(boundaries.current_offer - boundaries.my_target) / Math.abs(boundaries.my_floor - boundaries.my_target || 1)
    : 0.5;
  const u_price = clamp01(u_price_raw);
  const u_time = 1 - time_pressure;
  // u_risk comes from trust-core DB query (counterparty combined score / 100), or 0.5 fallback
  const u_quality = 0.5; // placeholder
  const u_total = u_price * 0.5 + u_time * 0.2 + u_risk * 0.15 + u_quality * 0.15;

  // ─── Suggested tactic ───
  const suggested_tactic = deriveTactic(phase, time_pressure, opponent_pattern, buddyDna);

  // ─── Strategic hints ───
  const strategic_hints = deriveStrategicHints(memory, buddyDna, opponent_pattern, time_pressure);

  // ─── Hint (single-line buddy-aware) ───
  const hint = `${buddyDna.preferred_tactic} works best ${buddyDna.best_timing}. ${suggested_tactic} recommended now.`;

  // ─── Warnings ───
  const warnings: string[] = [];
  if (time_pressure > 0.8) warnings.push('Running low on rounds — consider closing.');
  if (convergence_rate < 0.01 && recentFacts.length >= 3) warnings.push('Stagnation detected — try changing approach.');
  if (opponent_pattern === 'BOULWARE') warnings.push('Opponent is firm — small concessions may not yield results.');

  return {
    recommended_price,
    acceptable_range,
    suggested_tactic,
    hint,
    opponent_pattern,
    convergence_rate,
    time_pressure,
    utility_snapshot: { u_price, u_time: clamp01(u_time), u_risk, u_quality, u_total: clamp01(u_total) },
    strategic_hints,
    warnings,
  };
}

// ─── Helpers ───

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function classifyOpponent(
  facts: RoundFact[],
  myRole: 'buyer' | 'seller',
  existingPattern: OpponentPattern | null,
): OpponentPatternType {
  if (facts.length < 2) return existingPattern ? classifyFromAggression(existingPattern.aggression) : 'UNKNOWN';

  // Compute EMA of opponent concession rates
  let ema = 0;
  for (let i = 1; i < facts.length; i++) {
    const prev = facts[i - 1]!;
    const curr = facts[i]!;
    const opponentPrev = myRole === 'buyer' ? prev.seller_offer : prev.buyer_offer;
    const opponentCurr = myRole === 'buyer' ? curr.seller_offer : curr.buyer_offer;

    if (opponentPrev === 0) continue;
    const concession = (opponentPrev - opponentCurr) / opponentPrev;
    // For seller opponent, concession = price drop (positive = conceding)
    // For buyer opponent, concession = price rise (negative of this calc = conceding)
    const adjustedConcession = myRole === 'buyer' ? concession : -concession;
    ema = EMA_ALPHA * adjustedConcession + (1 - EMA_ALPHA) * ema;
  }

  if (ema > 0.05) return 'CONCEDER';
  if (ema < 0.005) return 'BOULWARE';
  return 'LINEAR';
}

function classifyFromAggression(aggression: number): OpponentPatternType {
  if (aggression > 0.7) return 'BOULWARE';
  if (aggression < 0.3) return 'CONCEDER';
  return 'LINEAR';
}

function computeConvergenceRate(facts: RoundFact[]): number {
  if (facts.length < 2) return 0;

  const gaps = facts.map((f) => f.gap);
  let totalDelta = 0;
  let count = 0;
  for (let i = 1; i < gaps.length; i++) {
    const prev = gaps[i - 1]!;
    if (prev > 0) {
      totalDelta += (prev - gaps[i]!) / prev;
      count++;
    }
  }
  return count > 0 ? totalDelta / count : 0;
}

function deriveTactic(
  phase: string,
  timePressure: number,
  opponentPattern: OpponentPatternType,
  buddyDna: BuddyDNA,
): string {
  if (phase === 'DISCOVERY') return 'ask_questions';
  if (phase === 'CLOSING') return 'confirm_terms';

  if (timePressure > 0.7) return 'time_pressure_close';
  if (opponentPattern === 'BOULWARE') return 'nibble';
  if (opponentPattern === 'CONCEDER') return 'anchoring';

  return buddyDna.preferred_tactic || 'reciprocal_concession';
}

function deriveStrategicHints(
  memory: CoreMemory,
  buddyDna: BuddyDNA,
  opponentPattern: OpponentPatternType,
  timePressure: number,
): string[] {
  const hints: string[] = [];

  // Style-based
  if (buddyDna.style === 'aggressive') {
    hints.push('Push for larger concessions early.');
  } else if (buddyDna.style === 'defensive') {
    hints.push('Protect floor — small concessions only.');
  }

  // Opponent-based
  if (opponentPattern === 'BOULWARE') {
    hints.push('Opponent is firm. Consider non-price trades to create value.');
  } else if (opponentPattern === 'CONCEDER') {
    hints.push('Opponent is flexible. Hold position to maximize gains.');
  }

  // Time-based
  if (timePressure > 0.6) {
    hints.push('Time running low — prioritize closing.');
  }

  // Competition-aware
  if (memory.competition) {
    hints.push(`Competition active: ${memory.competition.n_active_sessions} sessions, BATNA at $${memory.competition.batna_price}.`);
    if (memory.competition.my_rank > 1) {
      hints.push('Not the best offer — increase urgency.');
    }
  }

  return hints;
}
