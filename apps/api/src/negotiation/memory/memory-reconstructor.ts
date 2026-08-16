/**
 * memory-reconstructor.ts
 *
 * Pure functions to bridge DB rows → Step 56 engine types (CoreMemory, RoundFact, OpponentPattern).
 * No I/O, no side effects.
 *
 * Pattern follows apps/api/src/lib/session-reconstructor.ts for DB ↔ engine type mapping.
 */

import { DEFAULT_BUDDY_DNA, DEFAULT_INTERVENTION_MODE, DEFAULT_MAX_ROUNDS } from "../config.js";
import type {
  BuddyDNA,
  CoreMemory,
  HumanInterventionMode,
  ListingContextMemory,
  NegotiationPhase,
  OpponentPattern,
  RefereeCoaching,
  RoundFact,
  StrategyContextMemory,
  StrategyParams,
} from "../types.js";

// ---------------------------------------------------------------------------
// DB Row Types (aligned with session-reconstructor.ts DbSession / DbRound)
// ---------------------------------------------------------------------------

export interface DbSessionForMemory {
  id: string;
  role: "BUYER" | "SELLER";
  status: string;
  currentRound: number;
  roundsNoConcession: number;
  lastOfferPriceMinor: string | null;
  lastUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number } | null;
  negotiationAgentSnapshot: Record<string, unknown>;
  createdAt: Date;
  // LLM extension columns (nullable for backward compat)
  phase?: string | null;
  interventionMode?: string | null;
  buddyTone?: Record<string, unknown> | null;
  coachingSnapshot?: Record<string, unknown> | null;
}

export interface DbRoundForMemory {
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
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
  _roundsNoConcession: number,
): NegotiationPhase {
  switch (status) {
    case "CREATED":
      return "OPENING"; // Skip DISCOVERY per plan
    case "ACTIVE":
      return currentRound <= 1 ? "OPENING" : "BARGAINING";
    case "NEAR_DEAL":
      return "CLOSING";
    case "STALLED":
      return "BARGAINING";
    case "ACCEPTED":
    case "REJECTED":
    case "EXPIRED":
    case "SUPERSEDED":
      return "SETTLEMENT";
    case "WAITING":
      return "BARGAINING";
    default:
      return "OPENING";
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
  // A REJECT terminates the session no matter the phase — otherwise the
  // auto-play loop keeps going and the rejected offer gets propagated as a
  // fake counter (producing nonsensical "REJECT then ACCEPT at same price"
  // transcripts).
  if (action === "REJECT") return "REJECTED";
  // An ACCEPT/CONFIRM also terminates the session regardless of phase. The
  // CLOSING branch below used to swallow ACCEPTs and persist them as
  // 'NEAR_DEAL', which made the result UI show "Negotiation paused" + no
  // confetti even though both sides had agreed. Treat ACCEPT/CONFIRM as
  // authoritative deal-closes.
  if (action === "ACCEPT" || action === "CONFIRM") return "ACCEPTED";
  switch (phase) {
    case "OPENING":
      return "ACTIVE";
    case "BARGAINING":
      if (action === "HOLD") return "WAITING";
      return roundsNoConcession >= 4 ? "STALLED" : "ACTIVE";
    case "CLOSING":
      return "NEAR_DEAL";
    case "SETTLEMENT":
      // ACCEPT/CONFIRM already handled above; reaching SETTLEMENT without one
      // means the session ended unresolved (e.g., abort) — treat as rejected.
      return "REJECTED";
    default:
      return "ACTIVE";
  }
}

// ---------------------------------------------------------------------------
// Core Memory Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct CoreMemory from DB session + strategy snapshot.
 * This is the primary data structure consumed by the LLM pipeline.
 */
/**
 * The two prices actually on the table this round, supplied by the caller because the
 * session row cannot express them.
 *
 * `negotiation_sessions.last_offer_price_minor` stores the price a round RESPONDED to,
 * so reading it one round later yields the CURRENT responder's own previous offer — not
 * the counterparty's. Left to itself this module then set `opponent_offer` to
 * `coaching.recommended_price`, i.e. our own recommendation, so `gap` was
 * |my last offer − my own recommendation| and the engine never saw what the other side
 * had actually asked for. Both reported price faults trace back here.
 */
export interface RoundOffers {
  /** The offer this round is responding to — the counterparty's live price. */
  incomingOfferMinor?: number;
  /** The responder's own most recent outgoing offer, if they have made one. */
  myLastOfferMinor?: number;
}

export function reconstructCoreMemory(
  dbSession: DbSessionForMemory,
  negotiationAgentSnapshot: Record<string, unknown>,
  coaching: RefereeCoaching,
  offers: RoundOffers = {},
): CoreMemory {
  const strategy = negotiationAgentSnapshot as Record<string, unknown>;
  const role = dbSession.role.toLowerCase() as "buyer" | "seller";

  // Extract price boundaries from strategy snapshot
  const myTarget =
    extractNumber(strategy, "p_target") ?? extractNumber(strategy, "target_price") ?? 0;
  const myFloor = extractNumber(strategy, "p_limit") ?? extractNumber(strategy, "floor_price") ?? 0;
  const maxRounds = extractNumber(strategy, "max_rounds") ?? DEFAULT_MAX_ROUNDS;

  // The session row only remembers the price the LAST round responded to, which is this
  // responder's own previous offer — never the counterparty's. Prefer what the caller
  // measured from the round history; fall back to that stored price, which is at least a
  // real offer from the transcript. `coaching.recommended_price` must never be used here:
  // it is our own recommendation, so `gap` collapsed to ~0 and the engine negotiated
  // against itself.
  const storedOffer = dbSession.lastOfferPriceMinor
    ? Number(dbSession.lastOfferPriceMinor)
    : undefined;
  const currentOffer = offers.myLastOfferMinor ?? storedOffer ?? myTarget;
  const opponentOffer = offers.incomingOfferMinor ?? storedOffer ?? currentOffer;
  const gap = Math.abs(currentOffer - opponentOffer);

  // Phase: use stored phase or infer from status
  const phase: NegotiationPhase =
    (dbSession.phase as NegotiationPhase) ??
    inferPhaseFromStatus(dbSession.status, dbSession.currentRound, dbSession.roundsNoConcession);

  // Intervention mode
  const interventionMode: HumanInterventionMode =
    (dbSession.interventionMode as HumanInterventionMode) ?? DEFAULT_INTERVENTION_MODE;

  // BuddyDNA: use stored or default
  const buddyDna: BuddyDNA = dbSession.buddyTone
    ? { ...DEFAULT_BUDDY_DNA, tone: dbSession.buddyTone as unknown as BuddyDNA["tone"] }
    : DEFAULT_BUDDY_DNA;

  const listingContext = extractListingContextMemory(strategy);
  const strategyContext = extractStrategyContextMemory(strategy, role);
  const strategyParams = extractStrategyParams(strategy);

  return {
    session: {
      session_id: dbSession.id,
      phase,
      round: dbSession.currentRound,
      rounds_remaining: Math.max(0, maxRounds - dbSession.currentRound),
      role,
      max_rounds: maxRounds,
      intervention_mode: interventionMode,
      created_at_ms:
        extractTimeValueMillis(strategy, "listed_at_ms") ?? dbSession.createdAt.getTime(),
      deadline_at_ms: extractTimeValueMillis(strategy, "deadline_at_ms"),
      max_duration_ms:
        extractTimeValueMillis(strategy, "t_total_ms") ??
        extractNumber(strategy, "t_max") ??
        undefined,
    },
    boundaries: {
      my_target: myTarget,
      my_floor: myFloor,
      current_offer: currentOffer,
      opponent_offer: opponentOffer,
      gap,
      // Only when the caller actually measured it — absent means "has not offered yet",
      // which the envelope must not confuse with an offer that equals the target.
      ...(offers.myLastOfferMinor !== undefined ? { my_last_offer: offers.myLastOfferMinor } : {}),
    },
    terms: {
      active: [], // Terms populated from separate term tracking (future)
      resolved_summary: "",
    },
    coaching,
    buddy_dna: buddyDna,
    skill_summary: "electronics-iphone-pro-v1",
    ...(listingContext ? { listing_context: listingContext } : {}),
    ...(strategyContext ? { strategy_context: strategyContext } : {}),
    ...(strategyParams ? { strategy_params: strategyParams } : {}),
  };
}

/**
 * @deprecated LEGACY LLM/coach path only. Pulls a LOSSY 7-field subset of the
 * compiled snapshot (drops w_rep / v_s_base / n_threshold / gamma). The engine
 * decision path reads ALL knobs losslessly straight from the snapshot via
 * `readEngineKnobs` (negotiation/context/assemble-context.ts). Kept only because
 * coach.ts / default-engine-skill.ts still read `CoreMemory.strategy_params`;
 * remove this when the coach path retires in H2. Do not add new fields here —
 * add them to `readEngineKnobs` instead.
 */
function extractStrategyParams(strategy: Record<string, unknown>): StrategyParams | undefined {
  const out: StrategyParams = {};
  const num = (key: string): number | undefined => {
    const v = strategy[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };
  const beta = num("beta");
  const alpha = num("alpha");
  const anchorRatio = num("anchor_ratio");
  const vTFloor = num("v_t_floor");
  const uThreshold = num("u_threshold");
  const uAspiration = num("u_aspiration");
  if (beta !== undefined) out.beta = beta;
  if (alpha !== undefined) out.alpha = alpha;
  if (anchorRatio !== undefined) out.anchor_ratio = anchorRatio;
  if (vTFloor !== undefined) out.v_t_floor = vTFloor;
  if (uThreshold !== undefined) out.u_threshold = uThreshold;
  if (uAspiration !== undefined) out.u_aspiration = uAspiration;

  const w = strategy.weights;
  if (w && typeof w === "object" && !Array.isArray(w)) {
    const wr = w as Record<string, unknown>;
    const keys = ["w_p", "w_t", "w_r", "w_s"] as const;
    if (keys.every((k) => typeof wr[k] === "number")) {
      out.weights = {
        w_p: wr.w_p as number,
        w_t: wr.w_t as number,
        w_r: wr.w_r as number,
        w_s: wr.w_s as number,
      };
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// Exported for a focused test of the seller_facts pass-through (like
// extractStrategyContextMemory below).
export function extractListingContextMemory(
  strategy: Record<string, unknown>,
): ListingContextMemory | undefined {
  const raw = strategy.listing_context;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  const out: ListingContextMemory = {};
  if (typeof src.title === "string") out.title = src.title;
  if (typeof src.description === "string") out.description = src.description;
  if (typeof src.category === "string") out.category = src.category;
  if (typeof src.condition === "string") out.condition = src.condition;
  if (typeof src.photoUrl === "string") out.photoUrl = src.photoUrl;
  if (typeof src.subtype === "string") out.subtype = src.subtype;
  if (Array.isArray(src.tags)) {
    const tags = src.tags.filter((t): t is string => typeof t === "string");
    if (tags.length > 0) out.tags = tags;
  }
  if (src.attributes && typeof src.attributes === "object" && !Array.isArray(src.attributes)) {
    out.attributes = src.attributes as Record<string, unknown>;
  }
  // Seller-stated item facts (Phase G follow-up): shape-validate each entry so a
  // malformed snapshot can't push junk into the DECIDE prompt.
  if (Array.isArray(src.seller_facts)) {
    const facts = src.seller_facts
      .filter(
        (f): f is { checkId: string; question?: unknown; stance: string } =>
          !!f &&
          typeof f === "object" &&
          typeof (f as { checkId?: unknown }).checkId === "string" &&
          typeof (f as { stance?: unknown }).stance === "string" &&
          (f as { stance: string }).stance.trim().length > 0,
      )
      .map((f) => ({
        checkId: f.checkId,
        ...(typeof f.question === "string" ? { question: f.question } : {}),
        stance: f.stance,
      }));
    if (facts.length > 0) out.seller_facts = facts;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Select the ACTING side's advisor memory (which carries their quick-pick
 * `categoryCriteria`) into strategy_context, so `encodeStrategyContext` can surface
 * the party's required gates + soft preferences in their DECIDE prompt. Exported for
 * a focused test of the buyer/seller key selection (Feature #4 wiring).
 */
export function extractStrategyContextMemory(
  strategy: Record<string, unknown>,
  role: "buyer" | "seller",
): StrategyContextMemory | undefined {
  const out: StrategyContextMemory = {};
  if (typeof strategy.negotiation_agent_preset_id === "string")
    out.negotiation_agent_preset_id = strategy.negotiation_agent_preset_id;
  if (strategy.agent_weights && typeof strategy.agent_weights === "object") {
    out.agent_weights = strategy.agent_weights as Record<string, unknown>;
  }
  if (strategy.agent_overrides && typeof strategy.agent_overrides === "object") {
    out.agent_overrides = strategy.agent_overrides as Record<string, unknown>;
  }
  // Side-specific advisor memory keys (set by routes/negotiations.ts).
  const advisorKey =
    role === "buyer"
      ? "buyer_negotiation_agent_builder_memory"
      : "seller_negotiation_agent_builder_memory";
  const advisor = strategy[advisorKey];
  if (advisor && typeof advisor === "object" && !Array.isArray(advisor)) {
    out.negotiation_agent_builder_memory = advisor as Record<string, unknown>;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// ---------------------------------------------------------------------------
// RoundFact Reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct RoundFact[] from DB rounds for session memory.
 */
export function reconstructRoundFacts(
  dbRounds: DbRoundForMemory[],
  _sessionRole: "BUYER" | "SELLER",
): RoundFact[] {
  const facts: RoundFact[] = [];

  // Group by round pairs (incoming offer + engine response)
  // Each DB round is a single event; we need to pair them up
  for (let i = 0; i < dbRounds.length; i++) {
    const round = dbRounds[i]!;
    const _prevRound = i > 0 ? dbRounds[i - 1] : null;

    const incomingPrice = Number(round.priceminor);
    const counterPrice = round.counterPriceMinor ? Number(round.counterPriceMinor) : incomingPrice;

    const buyerOffer = round.senderRole === "BUYER" ? incomingPrice : counterPrice;
    const sellerOffer = round.senderRole === "SELLER" ? incomingPrice : counterPrice;

    const phase: NegotiationPhase =
      (round.phaseAtRound as NegotiationPhase) ?? inferPhaseFromStatus("ACTIVE", round.roundNo, 0);

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
        tactic: (round.coaching as { suggested_tactic?: string })?.suggested_tactic ?? "",
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
  role: "buyer" | "seller",
): OpponentPattern | null {
  if (facts.length < 2) return null;

  const EMA_ALPHA = 0.3;
  let ema = 0;
  let opponentFloorEstimate = 0;
  const tactics: string[] = [];

  for (let i = 1; i < facts.length; i++) {
    const prev = facts[i - 1]!;
    const curr = facts[i]!;

    const opponentPrev = role === "buyer" ? prev.seller_offer : prev.buyer_offer;
    const opponentCurr = role === "buyer" ? curr.seller_offer : curr.buyer_offer;

    if (opponentPrev > 0) {
      const concession = (opponentPrev - opponentCurr) / opponentPrev;
      const adjusted = role === "buyer" ? concession : -concession;
      ema = EMA_ALPHA * adjusted + (1 - EMA_ALPHA) * ema;
    }

    opponentFloorEstimate = opponentCurr;
    const tactic = role === "buyer" ? curr.seller_tactic : curr.buyer_tactic;
    if (tactic && !tactics.includes(tactic)) tactics.push(tactic);
  }

  // Derive aggression from EMA
  const aggression = ema < 0.005 ? 0.8 : ema > 0.05 ? 0.2 : 0.5;

  return {
    aggression,
    concession_rate: Math.abs(ema),
    preferred_tactics: tactics.length > 0 ? tactics : ["unknown"],
    condition_flexibility: 0.5, // Default — no term data yet
    estimated_floor: opponentFloorEstimate,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractNumber(obj: Record<string, unknown>, key: string): number | null {
  const val = obj[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = Number(val);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function extractTimeValueMillis(
  strategy: Record<string, unknown>,
  key: string,
): number | undefined {
  const timeValue = strategy.time_value as Record<string, unknown> | undefined;
  const value = timeValue?.[key] ?? strategy[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
