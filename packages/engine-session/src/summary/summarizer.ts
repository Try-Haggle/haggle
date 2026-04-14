// Session summarizer — pure function that produces SessionSummary from round data.
// No DB/API/LLM dependencies. (Doc 30 §2–3)

import type { SessionStatus } from '../session/types.js';
import type {
  SessionOutcome,
  RoundSnapshot,
  SessionSummary,
} from './types.js';
import {
  classifyConcessionPattern,
  extractConcessions,
  computeConcessionRates,
} from './classifier.js';

/** Map terminal SessionStatus to a SessionOutcome. */
export function classifyOutcome(status: SessionStatus): SessionOutcome {
  switch (status) {
    case 'ACCEPTED':
      return 'DEAL';
    case 'REJECTED':
      return 'REJECT';
    case 'EXPIRED':
      return 'TIMEOUT';
    default:
      return 'WALKAWAY';
  }
}

/** Compute average absolute deviation between coach-recommended and actual prices. */
export function computeCoachDeviation(rounds: RoundSnapshot[]): number {
  const deviations: number[] = [];
  for (const round of rounds) {
    if (round.coach_recommended_minor != null) {
      deviations.push(Math.abs(round.price_minor - round.coach_recommended_minor));
    }
  }
  if (deviations.length === 0) return 0;
  return deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
}

/** Bucket a price into an anonymized value range string. */
export function toValueRange(priceMinor: number): string {
  const dollars = priceMinor / 100;
  if (dollars < 50) return '$0-50';
  if (dollars < 100) return '$50-100';
  if (dollars < 250) return '$100-250';
  if (dollars < 500) return '$250-500';
  if (dollars < 1000) return '$500-1000';
  if (dollars < 2500) return '$1000-2500';
  if (dollars < 5000) return '$2500-5000';
  return '$5000+';
}

/** Input for session summary computation. */
export interface SummarizeInput {
  session_id: string;
  category: string;
  status: SessionStatus;
  /** Initial asking price (seller's first price) in minor units. */
  initial_ask_minor: number;
  rounds: RoundSnapshot[];
  /** Session creation timestamp (epoch ms). */
  created_at_ms: number;
  /** Session end timestamp (epoch ms). */
  ended_at_ms: number;
  /** Conditions exchanged during negotiation (e.g. "charger_included", "free_shipping"). */
  conditions_exchanged?: string[];
}

/**
 * Compute a complete SessionSummary from round-level snapshots.
 * Pure function — deterministic, no side effects.
 */
export function summarizeSession(input: SummarizeInput): SessionSummary {
  const {
    session_id,
    category,
    status,
    initial_ask_minor,
    rounds,
    created_at_ms,
    ended_at_ms,
    conditions_exchanged = [],
  } = input;

  const outcome = classifyOutcome(status);
  const totalRounds = rounds.length;
  const totalDurationMinutes = Math.max(0, (ended_at_ms - created_at_ms) / 60_000);

  // ── Price trajectory ──
  const priceTrajectory = rounds.map((r) => r.price_minor);

  // ── Split by role ──
  const buyerPrices = rounds.filter((r) => r.role === 'BUYER').map((r) => r.price_minor);
  const sellerPrices = rounds.filter((r) => r.role === 'SELLER').map((r) => r.price_minor);

  // ── Concession analysis ──
  const initialBuyerPrice = buyerPrices[0] ?? 0;
  const initialSpread = Math.abs(initial_ask_minor - initialBuyerPrice);

  const buyerConcessions = extractConcessions(buyerPrices, 'BUYER');
  const sellerConcessions = extractConcessions(sellerPrices, 'SELLER');

  const buyerPattern = classifyConcessionPattern(buyerConcessions);
  const sellerPattern = classifyConcessionPattern(sellerConcessions);

  const concessionRates = computeConcessionRates(priceTrajectory, initialSpread, 'BUYER');

  // ── Final price & discount ──
  const finalPriceMinor = outcome === 'DEAL' && priceTrajectory.length > 0
    ? priceTrajectory[priceTrajectory.length - 1]
    : undefined;
  const discountRate = finalPriceMinor != null && initial_ask_minor > 0
    ? (initial_ask_minor - finalPriceMinor) / initial_ask_minor
    : undefined;

  // ── Tactics ──
  const allTactics = rounds
    .map((r) => r.tactic_used)
    .filter((t): t is string => t != null);
  const tacticsUsed = [...new Set(allTactics)];

  const tacticsSuccess: Record<string, boolean> = {};
  for (const tactic of tacticsUsed) {
    // A tactic is "successful" if the session ended in a deal
    // More granular: if the round after using the tactic saw a concession
    const tacticRounds = rounds
      .map((r, i) => ({ ...r, index: i }))
      .filter((r) => r.tactic_used === tactic);

    let success = false;
    for (const tr of tacticRounds) {
      const nextRound = rounds[tr.index + 1];
      if (nextRound && nextRound.price_minor !== tr.price_minor) {
        // Opponent moved after this tactic
        success = true;
        break;
      }
    }
    tacticsSuccess[tactic] = success || outcome === 'DEAL';
  }

  // ── Referee violations ──
  let hardViolations = 0;
  let softViolations = 0;
  for (const round of rounds) {
    if (round.violations) {
      for (const v of round.violations) {
        if (v.severity === 'HARD') hardViolations++;
        else softViolations++;
      }
    }
  }

  // ── Coach deviation ──
  const coachDeviation = computeCoachDeviation(rounds);

  // ── Time context ──
  const startDate = new Date(created_at_ms);
  const dayOfWeek = startDate.getUTCDay();
  const hourOfDay = startDate.getUTCHours();

  // ── Value range ──
  const itemValueRange = toValueRange(initial_ask_minor);

  return {
    session_id,
    category,
    item_value_range: itemValueRange,
    outcome,
    final_price_minor: finalPriceMinor,
    discount_rate: discountRate,
    total_rounds: totalRounds,
    total_duration_minutes: Math.round(totalDurationMinutes * 10) / 10,
    price_trajectory: priceTrajectory,
    concession_rates: concessionRates,
    tactics_used: tacticsUsed,
    tactics_success: tacticsSuccess,
    conditions_exchanged,
    buyer_pattern: buyerPattern,
    seller_pattern: sellerPattern,
    referee_hard_violations: hardViolations,
    referee_soft_violations: softViolations,
    coach_vs_actual_avg_deviation: Math.round(coachDeviation),
    day_of_week: dayOfWeek,
    hour_of_day: hourOfDay,
  };
}
