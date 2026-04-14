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

/** Reconstruct a MasterStrategy from the JSONB snapshot stored in DB. */
export function reconstructStrategy(snapshot: Record<string, unknown>): MasterStrategy {
  // The snapshot is the MasterStrategy serialized as-is at session creation.
  return snapshot as unknown as MasterStrategy;
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
