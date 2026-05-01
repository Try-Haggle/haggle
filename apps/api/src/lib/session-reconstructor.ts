/**
 * session-reconstructor.ts
 *
 * DB row ↔ engine type 변환. 순수 함수만 포함.
 * DB에서 꺼낸 세션/라운드 데이터를 엔진이 이해하는 형태로 조립하고,
 * 엔진 결과를 DB에 쓸 수 있는 형태로 분해한다.
 */

import type {
  NegotiationSession,
  NegotiationRound as EngineRound,
  MasterStrategy,
  HnpMessage,
  HnpRole,
  HnpMessageType,
  SessionStatus,
} from "@haggle/engine-session";
import type { UtilityResult, DecisionAction } from "@haggle/engine-core";

const DEFAULT_NEGOTIATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// DB row types (inferred from Drizzle schema)
// ---------------------------------------------------------------------------

export interface DbSession {
  id: string;
  groupId: string | null;
  intentId: string | null;
  listingId: string;
  strategyId: string;
  role: "BUYER" | "SELLER";
  status: string;
  buyerId: string;
  sellerId: string;
  counterpartyId: string;
  currentRound: number;
  roundsNoConcession: number;
  lastOfferPriceMinor: string | null;
  lastUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number } | null;
  strategySnapshot: Record<string, unknown>;
  version: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // LLM engine extension columns (Step 57) — nullable for backward compat
  phase?: string | null;
  interventionMode?: string | null;
  buddyTone?: Record<string, unknown> | null;
  coachingSnapshot?: Record<string, unknown> | null;
}

export interface DbRound {
  id: string;
  sessionId: string;
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  messageType: string;
  priceminor: string;
  counterPriceMinor: string | null;
  utility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number } | null;
  decision: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// DB → Engine
// ---------------------------------------------------------------------------

/** Reconstruct an engine NegotiationSession from DB session + rounds. */
export function reconstructSession(
  dbSession: DbSession,
  dbRounds: DbRound[],
): NegotiationSession {
  const rounds: EngineRound[] = dbRounds.map((r) => ({
    round_no: r.roundNo,
    message: {
      session_id: dbSession.id,
      round: r.roundNo,
      type: r.messageType as HnpMessageType,
      price: Number(r.priceminor),
      sender_role: r.senderRole as HnpRole,
      timestamp: r.createdAt.getTime(),
      metadata: r.metadata ?? undefined,
    },
    utility: r.utility as UtilityResult | undefined,
    decision: (r.decision as DecisionAction) ?? undefined,
    counter_price: r.counterPriceMinor ? Number(r.counterPriceMinor) : undefined,
  }));

  return {
    session_id: dbSession.id,
    strategy_id: dbSession.strategyId,
    role: dbSession.role as HnpRole,
    status: dbSession.status as SessionStatus,
    counterparty_id: dbSession.counterpartyId,
    rounds,
    current_round: dbSession.currentRound,
    rounds_no_concession: dbSession.roundsNoConcession,
    last_offer_price: dbSession.lastOfferPriceMinor
      ? Number(dbSession.lastOfferPriceMinor)
      : null,
    last_utility: dbSession.lastUtility as UtilityResult | null,
    created_at: dbSession.createdAt.getTime(),
    updated_at: dbSession.updatedAt.getTime(),
  };
}

/**
 * Reconstruct a MasterStrategy from the JSONB snapshot stored in DB.
 *
 * MCP tools store a human-friendly format (alpha as object, thresholds, concession),
 * but the engine expects flat MasterStrategy fields. This adapter handles both:
 * - Legacy/direct MasterStrategy format (pass through)
 * - MCP snapshot format (transform to MasterStrategy)
 */
export function reconstructStrategy(snapshot: Record<string, unknown>): MasterStrategy {
  const timeWindow = extractStrategyTimeWindow(snapshot);

  // If snapshot already has engine-native `weights` field, it's a MasterStrategy — pass through
  if (snapshot.weights && typeof snapshot.weights === "object") {
    return {
      ...(snapshot as unknown as MasterStrategy),
      t_deadline: timeWindow.durationMs ?? (snapshot as unknown as MasterStrategy).t_deadline,
      created_at: timeWindow.startMs ?? (snapshot as unknown as MasterStrategy).created_at,
      expires_at: timeWindow.deadlineAtMs ?? (snapshot as unknown as MasterStrategy).expires_at,
    };
  }

  // MCP format: { alpha: {price,time,reputation,satisfaction}, thresholds: {...}, concession: {...} }
  const alpha = snapshot.alpha as Record<string, number> | undefined;
  const thresholds = snapshot.thresholds as Record<string, number> | undefined;
  const concession = snapshot.concession as Record<string, number> | undefined;

  const wP = alpha?.price ?? 0.4;
  const wT = alpha?.time ?? 0.25;
  const wR = alpha?.reputation ?? 0.2;
  const wS = alpha?.satisfaction ?? 0.15;

  return {
    id: (snapshot.id as string) ?? "mcp_generated",
    user_id: (snapshot.user_id as string) ?? "",
    weights: { w_p: wP, w_t: wT, w_r: wR, w_s: wS },
    p_target: (snapshot.p_target as number) ?? 0,
    p_limit: (snapshot.p_reservation as number) ?? (snapshot.p_limit as number) ?? 0,
    alpha: wT, // time utility curve exponent (assembler uses strategy.alpha for time)
    beta: concession?.beta ?? 0.6,
    t_deadline: timeWindow.durationMs ?? (snapshot.t_max as number) ?? DEFAULT_NEGOTIATION_WINDOW_MS,
    v_t_floor: (snapshot.v_t_floor as number) ?? 0.1,
    n_threshold: (snapshot.n_threshold as number) ?? 3,
    v_s_base: (snapshot.v_s_base as number) ?? 0.5,
    w_rep: wR,
    w_info: 1 - wR,
    u_threshold: thresholds?.accept ?? 0.78,
    u_aspiration: thresholds?.near_deal ?? 0.72,
    persona: (snapshot.role as string) ?? "BUYER",
    gamma: (snapshot.gamma as number) ?? undefined,
    created_at: timeWindow.startMs ?? Date.now(),
    expires_at: timeWindow.deadlineAtMs ?? Date.now() + ((snapshot.t_max as number) ?? DEFAULT_NEGOTIATION_WINDOW_MS),
    term_space: snapshot.term_space as MasterStrategy["term_space"],
  } satisfies MasterStrategy;
}

export function getStrategyTimeWindow(
  snapshot: Record<string, unknown>,
  fallbackStartMs: number,
  fallbackDeadlineAtMs?: number | null,
): { startMs: number; deadlineAtMs: number; durationMs: number } {
  const extracted = extractStrategyTimeWindow(snapshot);
  const startMs = extracted.startMs ?? fallbackStartMs;
  const deadlineAtMs = Math.max(
    startMs + 1,
    extracted.deadlineAtMs ?? fallbackDeadlineAtMs ?? startMs + (extracted.durationMs ?? DEFAULT_NEGOTIATION_WINDOW_MS),
  );
  const durationMs = Math.max(1, extracted.durationMs ?? deadlineAtMs - startMs);

  return { startMs, deadlineAtMs, durationMs };
}

function extractStrategyTimeWindow(
  snapshot: Record<string, unknown>,
): { startMs?: number; deadlineAtMs?: number; durationMs?: number } {
  const timeValue = snapshot.time_value as Record<string, unknown> | undefined;
  const startMs = extractMillis(timeValue?.listed_at_ms)
    ?? extractMillis(timeValue?.created_at_ms)
    ?? extractMillis(snapshot.created_at_ms)
    ?? extractMillis(snapshot.listed_at_ms);
  const deadlineAtMs = extractMillis(timeValue?.deadline_at_ms)
    ?? extractMillis(snapshot.deadline_at_ms);
  const durationMs = extractMillis(timeValue?.t_total_ms)
    ?? extractMillis(snapshot.t_max);

  return { startMs, deadlineAtMs, durationMs };
}

function extractMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** Build an incoming HNP message from an offer submission. */
export function buildIncomingOffer(
  sessionId: string,
  priceMinor: number,
  senderRole: HnpRole,
  roundNo: number,
  nowMs: number,
): HnpMessage {
  return {
    session_id: sessionId,
    round: roundNo,
    type: roundNo === 1 ? "OFFER" : "COUNTER",
    price: priceMinor,
    sender_role: senderRole,
    timestamp: nowMs,
  };
}

// ---------------------------------------------------------------------------
// Engine → DB (for persisting round results)
// ---------------------------------------------------------------------------

export interface RoundPersistData {
  sessionId: string;
  roundNo: number;
  senderRole: "BUYER" | "SELLER";
  messageType: "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE";
  priceminor: string;
  counterPriceMinor?: string;
  utility?: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
  decision?: "ACCEPT" | "COUNTER" | "REJECT" | "NEAR_DEAL" | "ESCALATE";
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface SessionUpdateData {
  status: "CREATED" | "ACTIVE" | "NEAR_DEAL" | "STALLED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED" | "WAITING" | "NEGOTIATING_VERSION" | "FAILED_COMPATIBILITY";
  currentRound: number;
  roundsNoConcession: number;
  lastOfferPriceMinor: string;
  lastUtility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number } | null;
}

/** Extract DB-writable data from an engine RoundResult. */
export function extractPersistData(
  sessionId: string,
  result: {
    message: HnpMessage;
    utility: UtilityResult;
    decision: DecisionAction;
    session: NegotiationSession;
  },
  incomingPrice: number,
  idempotencyKey: string,
): { round: RoundPersistData; sessionUpdate: SessionUpdateData } {
  const { message, utility, decision, session: updatedSession } = result;

  const round: RoundPersistData = {
    sessionId,
    roundNo: updatedSession.current_round,
    senderRole: message.sender_role,
    messageType: message.type,
    priceminor: String(incomingPrice),
    counterPriceMinor: message.type === "COUNTER" ? String(message.price) : undefined,
    utility: {
      u_total: utility.u_total,
      v_p: utility.v_p,
      v_t: utility.v_t,
      v_r: utility.v_r,
      v_s: utility.v_s,
    },
    decision,
    idempotencyKey,
  };

  const sessionUpdate: SessionUpdateData = {
    status: updatedSession.status,
    currentRound: updatedSession.current_round,
    roundsNoConcession: updatedSession.rounds_no_concession,
    lastOfferPriceMinor: String(incomingPrice),
    lastUtility: updatedSession.last_utility
      ? {
          u_total: updatedSession.last_utility.u_total,
          v_p: updatedSession.last_utility.v_p,
          v_t: updatedSession.last_utility.v_t,
          v_r: updatedSession.last_utility.v_r,
          v_s: updatedSession.last_utility.v_s,
        }
      : null,
  };

  return { round, sessionUpdate };
}
