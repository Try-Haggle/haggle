/**
 * memory-reconstructor.ts
 *
 * Pure functions to bridge DB rows → Step 56 engine types (CoreMemory, RoundFact, OpponentPattern).
 * No I/O, no side effects.
 *
 * Pattern follows apps/api/src/lib/session-reconstructor.ts for DB ↔ engine type mapping.
 */

import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  NegotiationPhase,
  BuddyDNA,
  HumanInterventionMode,
  RefereeCoaching,
  ActiveTerm,
} from '../types.js';
import { DEFAULT_BUDDY_DNA, DEFAULT_INTERVENTION_MODE, DEFAULT_MAX_ROUNDS } from '../config.js';

// ---------------------------------------------------------------------------
// DB Row Types (aligned with session-reconstructor.ts DbSession / DbRound)
// ---------------------------------------------------------------------------

export interface DbSessionForMemory {
  id: string;
  role: 'BUYER' | 'SELLER';
  status: string;
  currentRound: number;
  roundsNoConcession: number;
  lastOfferPriceMinor: string | null;
  lastUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number } | null;
  strategySnapshot: Record<string, unknown>;
  createdAt: Date;
  // LLM extension columns (nullable for backward compat)
  phase?: string | null;
  interventionMode?: string | null;
  buddyTone?: Record<string, unknown> | null;
  coachingSnapshot?: Record<string, unknown> | null;
}

export interface DbRoundForMemory {
  roundNo: number;
  senderRole: 'BUYER' | 'SELLER';
  priceminor: string;
  counterPriceMinor: string | null;
  decision: string | null;
  utility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number } | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  // LLM extension columns (nullable)
  coaching?: Record<string, unknown> | null;
  phaseAtRound?: string | null;
}

// ---------------------------------------------------------------------------
// Phase ↔ Status Mapping
// ---------------------------------------------------------------------------

/**
 * Infer NegotiationPhase from DB session status and round count.
 * Used when the `phase` column is null (legacy rule-based rounds).
 */
export function inferPhaseFromStatus(
  status: string,
  currentRound: number,
  roundsNoConcession: number,
): NegotiationPhase {
  switch (status) {
    case 'CREATED':
      return 'OPENING'; // Skip DISCOVERY per plan
    case 'ACTIVE':
      return currentRound <= 1 ? 'OPENING' : 'BARGAINING';
    case 'NEAR_DEAL':
      return 'CLOSING';
    case 'STALLED':
      return 'BARGAINING';
    case 'ACCEPTED':
    case 'REJECTED':
    case 'EXPIRED':
    case 'SUPERSEDED':
      return 'SETTLEMENT';
    case 'WAITING':
      return 'BARGAINING';
    default:
      return 'OPENING';
  }
}

/**
 * Map NegotiationPhase back to DB session status for persistence.
 */
export function phaseToDbStatus(
  phase: NegotiationPhase,
  action: string,
  roundsNoConcession: number,
): string {
  switch (phase) {
    case 'OPENING':
      return 'ACTIVE';
    case 'BARGAINING':
      if (action === 'HOLD') return 'WAITING';
      return roundsNoConcession >= 4 ? 'STALLED' : 'ACTIVE';
    case 'CLOSING':
      return 'NEAR_DEAL';
    case 'SETTLEMENT':
      return action === 'ACCEPT' || action === 'CONFIRM' ? 'ACCEPTED' : 'REJECTED';
    default:
      return 'ACTIVE';
  }
}

// ---------------------------------------------------------------------------
// Core Memory Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct CoreMemory from DB session + strategy snapshot.
 * This is the primary data structure consumed by the LLM pipeline.
 */
export function reconstructCoreMemory(
  dbSession: DbSessionForMemory,
  strategySnapshot: Record<string, unknown>,
  coaching: RefereeCoaching,
): CoreMemory {
  const strategy = strategySnapshot as Record<string, unknown>;
  const role = dbSession.role.toLowerCase() as 'buyer' | 'seller';

  // Extract price boundaries from strategy snapshot
  const myTarget = extractNumber(strategy, 'p_target') ?? extractNumber(strategy, 'target_price') ?? 0;
  const myFloor = extractNumber(strategy, 'p_limit') ?? extractNumber(strategy, 'floor_price') ?? 0;
  const maxRounds = extractNumber(strategy, 'max_rounds') ?? DEFAULT_MAX_ROUNDS;

  const currentOffer = dbSession.lastOfferPriceMinor ? Number(dbSession.lastOfferPriceMinor) : myTarget;
  const opponentOffer = coaching.recommended_price > 0 ? coaching.recommended_price : currentOffer;
  const gap = Math.abs(currentOffer - opponentOffer);

  // Phase: use stored phase or infer from status
  const phase: NegotiationPhase = (dbSession.phase as NegotiationPhase) ??
    inferPhaseFromStatus(dbSession.status, dbSession.currentRound, dbSession.roundsNoConcession);

  // Intervention mode
  const interventionMode: HumanInterventionMode =
    (dbSession.interventionMode as HumanInterventionMode) ?? DEFAULT_INTERVENTION_MODE;

  // BuddyDNA: use stored or default
  const buddyDna: BuddyDNA = dbSession.buddyTone
    ? { ...DEFAULT_BUDDY_DNA, tone: dbSession.buddyTone as unknown as BuddyDNA['tone'] }
    : DEFAULT_BUDDY_DNA;

  return {
    session: {
      session_id: dbSession.id,
      phase,
      round: dbSession.currentRound,
      rounds_remaining: Math.max(0, maxRounds - dbSession.currentRound),
      role,
      max_rounds: maxRounds,
      intervention_mode: interventionMode,
      created_at_ms: extractTimeValueMillis(strategy, 'listed_at_ms') ?? dbSession.createdAt.getTime(),
      deadline_at_ms: extractTimeValueMillis(strategy, 'deadline_at_ms'),
      max_duration_ms: extractTimeValueMillis(strategy, 't_total_ms') ?? extractNumber(strategy, 't_max') ?? undefined,
    },
    boundaries: {
      my_target: myTarget,
      my_floor: myFloor,
      current_offer: currentOffer,
      opponent_offer: opponentOffer,
      gap,
    },
    terms: {
      active: [], // Terms populated from separate term tracking (future)
      resolved_summary: '',
    },
    coaching,
    buddy_dna: buddyDna,
    skill_summary: 'electronics-iphone-pro-v1',
  };
}

// ---------------------------------------------------------------------------
// RoundFact Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct RoundFact[] from DB rounds for session memory.
 */
export function reconstructRoundFacts(
  dbRounds: DbRoundForMemory[],
  sessionRole: 'BUYER' | 'SELLER',
): RoundFact[] {
  const facts: RoundFact[] = [];

  // Group by round pairs (incoming offer + engine response)
  // Each DB round is a single event; we need to pair them up
  for (let i = 0; i < dbRounds.length; i++) {
    const round = dbRounds[i]!;
    const prevRound = i > 0 ? dbRounds[i - 1] : null;

    const incomingPrice = Number(round.priceminor);
    const counterPrice = round.counterPriceMinor ? Number(round.counterPriceMinor) : incomingPrice;

    const buyerOffer = round.senderRole === 'BUYER' ? incomingPrice : counterPrice;
    const sellerOffer = round.senderRole === 'SELLER' ? incomingPrice : counterPrice;

    const phase: NegotiationPhase = (round.phaseAtRound as NegotiationPhase) ??
      inferPhaseFromStatus('ACTIVE', round.roundNo, 0);

    facts.push({
      round: round.roundNo,
      phase,
      buyer_offer: buyerOffer,
      seller_offer: sellerOffer,
      gap: Math.abs(buyerOffer - sellerOffer),
      buyer_tactic: round.metadata?.tactic as string | undefined,
      seller_tactic: undefined,
      conditions_changed: {},
      coaching_given: {
        recommended: (round.coaching as { recommended_price?: number })?.recommended_price ?? 0,
        tactic: (round.coaching as { suggested_tactic?: string })?.suggested_tactic ?? '',
      },
      coaching_followed: false, // Computed retroactively if needed
      human_intervened: false,
      timestamp: round.createdAt.getTime(),
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Opponent Pattern Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct OpponentPattern from round facts.
 * Uses same EMA-based classification as referee/coach.ts.
 */
export function reconstructOpponentPattern(
  facts: RoundFact[],
  role: 'buyer' | 'seller',
): OpponentPattern | null {
  if (facts.length < 2) return null;

  const EMA_ALPHA = 0.3;
  let ema = 0;
  let opponentFloorEstimate = 0;
  const tactics: string[] = [];

  for (let i = 1; i < facts.length; i++) {
    const prev = facts[i - 1]!;
    const curr = facts[i]!;

    const opponentPrev = role === 'buyer' ? prev.seller_offer : prev.buyer_offer;
    const opponentCurr = role === 'buyer' ? curr.seller_offer : curr.buyer_offer;

    if (opponentPrev > 0) {
      const concession = (opponentPrev - opponentCurr) / opponentPrev;
      const adjusted = role === 'buyer' ? concession : -concession;
      ema = EMA_ALPHA * adjusted + (1 - EMA_ALPHA) * ema;
    }

    opponentFloorEstimate = opponentCurr;
    const tactic = role === 'buyer' ? curr.seller_tactic : curr.buyer_tactic;
    if (tactic && !tactics.includes(tactic)) tactics.push(tactic);
  }

  // Derive aggression from EMA
  const aggression = ema < 0.005 ? 0.8 : ema > 0.05 ? 0.2 : 0.5;

  return {
    aggression,
    concession_rate: Math.abs(ema),
    preferred_tactics: tactics.length > 0 ? tactics : ['unknown'],
    condition_flexibility: 0.5, // Default — no term data yet
    estimated_floor: opponentFloorEstimate,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractNumber(obj: Record<string, unknown>, key: string): number | null {
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractTimeValueMillis(strategy: Record<string, unknown>, key: string): number | undefined {
  const timeValue = strategy.time_value as Record<string, unknown> | undefined;
  const value = timeValue?.[key] ?? strategy[key];
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
