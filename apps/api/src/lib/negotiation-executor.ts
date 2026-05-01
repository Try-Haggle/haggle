/**
 * negotiation-executor.ts
 *
 * 라운드 실행 트랜잭션: DB lock → idempotency check → engine call → persist.
 * 이 모듈은 엔진(순수 함수)과 DB(서비스 레이어)를 연결하는 유일한 브리지.
 */

import { sql, type Database } from "@haggle/db";
import { executeRound } from "@haggle/engine-session";
import type { RoundData } from "@haggle/engine-session";
import type { RoundResult, EscalationRequest } from "@haggle/engine-session";

import { getRoundByIdempotencyKey, createRound, getRoundsBySessionId } from "../services/negotiation-round.service.js";
import { recordRoundConversationSignals } from "../services/conversation-signal-sink.js";
import { broadcastToSession } from "../ws/negotiation-ws.js";
import { getSessionById, updateSessionState } from "../services/negotiation-session.service.js";
import { DEFAULT_MAX_ROUNDS } from "../negotiation/config.js";
import {
  reconstructSession,
  reconstructStrategy,
  getStrategyTimeWindow,
  buildIncomingOffer,
  extractPersistData,
  type DbSession,
  type DbRound,
} from "./session-reconstructor.js";

import type { EventDispatcher, PipelineEvent } from "./event-dispatcher.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoundExecutionInput {
  sessionId: string;
  offerPriceMinor: number;
  /** Optional natural-language message submitted with the offer. */
  messageText?: string;
  senderRole: "BUYER" | "SELLER";
  idempotencyKey: string;
  /** Optional HNP envelope identifiers for protocol-level replay/order/proposal audit. */
  protocol?: {
    specVersion: string;
    capability: string;
    messageId: string;
    proposalId: string;
    proposalHash?: string;
    currency?: string;
    issues?: Array<{
      issue_id: string;
      value: string | number | boolean;
      unit?: string;
      kind?: "NEGOTIABLE" | "INFORMATIONAL";
    }>;
    settlementPreconditions?: string[];
    sequence: number;
    senderAgentId: string;
    expiresAtMs: number;
  };
  /** Per-round situational data (trust score, elapsed time, etc.) from API layer */
  roundData: Partial<RoundData>;
  nowMs: number;
}

export interface RoundExecutionResult {
  /** Was this a cached idempotent response? */
  idempotent: boolean;
  roundId: string;
  roundNo: number;
  decision: string;
  outgoingPrice: number;
  utility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
  sessionStatus: string;
  escalation?: EscalationRequest;
}

// ---------------------------------------------------------------------------
// Terminal status check
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

/**
 * Execute a single negotiation round inside a DB transaction.
 *
 * Flow:
 * 1. BEGIN
 * 2. SELECT session FOR UPDATE (row-level lock)
 * 3. Idempotency key check → return cached if exists
 * 4. Reconstruct engine types (pure function)
 * 5. Execute round via engine-session (pure function)
 * 6. Persist round + update session (optimistic lock)
 * 7. COMMIT
 * 8. Dispatch pipeline events for terminal states
 */
export async function executeNegotiationRound(
  db: Database,
  input: RoundExecutionInput,
  eventDispatcher?: EventDispatcher,
): Promise<RoundExecutionResult> {
  // --- Idempotency check (outside transaction for speed) ---
  const existingRound = await getRoundByIdempotencyKey(db, input.idempotencyKey);
  if (existingRound) {
    return {
      idempotent: true,
      roundId: existingRound.id,
      roundNo: existingRound.roundNo,
      decision: existingRound.decision ?? "COUNTER",
      outgoingPrice: Number(existingRound.counterPriceMinor ?? existingRound.priceminor),
      utility: (existingRound.utility as RoundExecutionResult["utility"]) ?? {
        u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0,
      },
      sessionStatus: (await getSessionById(db, input.sessionId))?.status ?? "ACTIVE",
    };
  }

  // --- Transaction ---
  // Drizzle + postgres-js: use raw SQL transaction for SELECT FOR UPDATE
  const result = await db.transaction(async (tx) => {
    // 1. Lock session row
    const lockedRows = await tx.execute(
      sql`SELECT * FROM negotiation_sessions WHERE id = ${input.sessionId} FOR UPDATE`,
    );
    const lockedRow = (lockedRows as unknown as Record<string, unknown>[])[0];

    if (!lockedRow) {
      throw new Error(`SESSION_NOT_FOUND: ${input.sessionId}`);
    }

    // Map raw row to typed DbSession
    const dbSession = mapRawToDbSession(lockedRow);

    // 2. Check terminal status
    if (TERMINAL_STATUSES.has(dbSession.status)) {
      throw new Error(`SESSION_TERMINAL: ${dbSession.status}`);
    }

    // 2b. Check max rounds — auto-reject if exceeded
    const maxRounds = (dbSession.strategySnapshot as Record<string, unknown>)?.max_rounds as number | undefined
      ?? DEFAULT_MAX_ROUNDS;
    if (dbSession.currentRound >= maxRounds) {
      await updateSessionState(tx as unknown as Database, input.sessionId, dbSession.version, {
        status: "REJECTED",
      });
      throw new Error("SESSION_MAX_ROUNDS_EXCEEDED");
    }

    // 2c. Check expiry — auto-expire if past deadline (use server time, not client-provided nowMs)
    const serverNowMs = Date.now();
    if (dbSession.expiresAt && dbSession.expiresAt.getTime() < serverNowMs) {
      await updateSessionState(tx as unknown as Database, input.sessionId, dbSession.version, {
        status: "EXPIRED",
      });
      throw new Error("SESSION_EXPIRED");
    }

    // 3. Double-check idempotency inside transaction
    const existingInTx = await getRoundByIdempotencyKey(tx as unknown as Database, input.idempotencyKey);
    if (existingInTx) {
      return {
        idempotent: true as const,
        roundId: existingInTx.id,
        roundNo: existingInTx.roundNo,
        decision: existingInTx.decision ?? "COUNTER",
        outgoingPrice: Number(existingInTx.counterPriceMinor ?? existingInTx.priceminor),
        utility: (existingInTx.utility as RoundExecutionResult["utility"]) ?? {
          u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0,
        },
        sessionStatus: dbSession.status,
      };
    }

    // 4. Load rounds and reconstruct engine types
    const dbRounds = await getRoundsBySessionId(tx as unknown as Database, input.sessionId) as DbRound[];
    const engineSession = reconstructSession(dbSession, dbRounds);
    const strategy = reconstructStrategy(dbSession.strategySnapshot);

    // 5. Build incoming offer
    const nextRound = engineSession.current_round + 1;
    const incomingOffer = buildIncomingOffer(
      input.sessionId,
      input.offerPriceMinor,
      input.senderRole,
      nextRound,
      input.nowMs,
    );

    const timeWindow = getStrategyTimeWindow(
      dbSession.strategySnapshot,
      engineSession.created_at,
      dbSession.expiresAt?.getTime(),
    );

    // 6. Build complete RoundData with defaults
    const roundData: RoundData = {
      p_effective: input.offerPriceMinor,
      r_score: 0.5,
      i_completeness: 0.5,
      t_elapsed: Math.max(0, input.nowMs - timeWindow.startMs),
      n_success: 0,
      n_dispute_losses: 0,
      ...input.roundData,
    };

    // 7. Execute round (pure function — no I/O)
    const roundResult: RoundResult = executeRound(
      engineSession,
      strategy,
      incomingOffer,
      roundData,
    );

    // 8. Persist results
    const { round: roundPersist, sessionUpdate } = extractPersistData(
      input.sessionId,
      roundResult,
      input.offerPriceMinor,
      input.idempotencyKey,
    );
    if (input.protocol) {
      roundPersist.metadata = {
        ...(roundPersist.metadata ?? {}),
        protocol: { hnp: input.protocol },
      };
    }

    const createdRound = await createRound(tx as unknown as Database, roundPersist);
    await recordSignalsForCreatedRound(
      tx as unknown as Database,
      dbSession,
      input,
      createdRound.id,
      createdRound.roundNo,
      roundResult.message.price,
      String(roundResult.decision),
    );

    const updated = await updateSessionState(
      tx as unknown as Database,
      input.sessionId,
      dbSession.version,
      {
        status: sessionUpdate.status,
        currentRound: sessionUpdate.currentRound,
        roundsNoConcession: sessionUpdate.roundsNoConcession,
        lastOfferPriceMinor: sessionUpdate.lastOfferPriceMinor,
        lastUtility: sessionUpdate.lastUtility ?? undefined,
      },
    );

    if (!updated) {
      throw new Error("CONCURRENT_MODIFICATION: session version conflict");
    }

    return {
      idempotent: false as const,
      roundId: createdRound.id,
      roundNo: createdRound.roundNo,
      decision: roundResult.decision,
      outgoingPrice: roundResult.message.price,
      utility: {
        u_total: roundResult.utility.u_total,
        v_p: roundResult.utility.v_p,
        v_t: roundResult.utility.v_t,
        v_r: roundResult.utility.v_r,
        v_s: roundResult.utility.v_s,
      },
      sessionStatus: roundResult.session.status,
      escalation: roundResult.escalation,
    };
  });

  // --- Post-commit: broadcast real-time update via WebSocket ---
  if (!result.idempotent) {
    broadcastToSession(input.sessionId, {
      type: "round_update",
      payload: {
        round: result.roundNo,
        status: result.sessionStatus,
        offer: result.outgoingPrice,
        decision: result.decision,
      },
    });
  }

  // --- Post-commit: dispatch pipeline events for terminal states ---
  if (eventDispatcher && !result.idempotent) {
    // Re-read session to get buyer/seller/price for event payload
    const finalSession = await getSessionById(db, input.sessionId);
    const terminalEvent = buildTerminalEvent(
      input.sessionId,
      result.sessionStatus,
      result.decision,
      finalSession ?? undefined,
    );
    if (terminalEvent) {
      await eventDispatcher.dispatch(terminalEvent).catch((err) => {
        // Non-fatal: log but don't fail the round execution
        console.error("[negotiation-executor] event dispatch error:", err);
      });
    }
  }

  return result;
}

async function recordSignalsForCreatedRound(
  tx: Database,
  dbSession: DbSession,
  input: RoundExecutionInput,
  roundId: string,
  roundNo: number,
  outgoingPriceMinor: number,
  decision: string,
): Promise<void> {
  const incomingText = input.messageText ?? `Offer: $${(input.offerPriceMinor / 100).toFixed(2)}`;
  const outgoingText = `${decision}: $${(outgoingPriceMinor / 100).toFixed(2)}`;

  await recordRoundConversationSignals(tx, {
    sessionId: input.sessionId,
    roundId,
    roundNo,
    listingId: dbSession.listingId,
    buyerId: dbSession.buyerId,
    sellerId: dbSession.sellerId,
    incomingRole: input.senderRole,
    agentRole: dbSession.role,
    incomingText,
    outgoingText,
    engine: "rule",
    idempotencyKey: input.idempotencyKey,
    decision,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTerminalEvent(
  sessionId: string,
  sessionStatus: string,
  decision: string,
  session?: { buyerId: string; sellerId: string; lastOfferPriceMinor: string | null; intentId: string | null },
): PipelineEvent | null {
  if (sessionStatus === "ACCEPTED") {
    return {
      domain: "negotiation",
      type: "negotiation.agreed",
      payload: {
        session_id: sessionId,
        agreed_price_minor: Number(session?.lastOfferPriceMinor ?? 0),
        buyer_id: session?.buyerId ?? "",
        seller_id: session?.sellerId ?? "",
      },
      idempotency_key: `neg_agreed_${sessionId}`,
      timestamp: Date.now(),
    };
  }

  if (["REJECTED", "EXPIRED", "SUPERSEDED"].includes(sessionStatus)) {
    return {
      domain: "negotiation",
      type: "negotiation.session.terminal",
      payload: {
        session_id: sessionId,
        terminal_status: sessionStatus,
        decision,
        intent_id: session?.intentId ?? undefined,
      },
      idempotency_key: `neg_terminal_${sessionId}_${sessionStatus}`,
      timestamp: Date.now(),
    };
  }

  if (sessionStatus === "NEAR_DEAL") {
    return {
      domain: "negotiation",
      type: "negotiation.near_deal",
      payload: {
        session_id: sessionId,
        decision,
        buyer_id: session?.buyerId ?? "",
        seller_id: session?.sellerId ?? "",
      },
      idempotency_key: `neg_near_deal_${sessionId}`,
      timestamp: Date.now(),
    };
  }

  if (sessionStatus === "STALLED") {
    return {
      domain: "negotiation",
      type: "negotiation.stalled",
      payload: {
        session_id: sessionId,
        decision,
        buyer_id: session?.buyerId ?? "",
        seller_id: session?.sellerId ?? "",
        intent_id: session?.intentId ?? undefined,
      },
      idempotency_key: `neg_stalled_${sessionId}`,
      timestamp: Date.now(),
    };
  }

  return null;
}

/** Map a raw SQL row (snake_case) to typed DbSession (camelCase). */
export function mapRawToDbSession(raw: Record<string, unknown>): DbSession {
  return {
    id: raw.id as string,
    groupId: (raw.group_id as string) ?? null,
    intentId: (raw.intent_id as string) ?? null,
    listingId: raw.listing_id as string,
    strategyId: raw.strategy_id as string,
    role: raw.role as "BUYER" | "SELLER",
    status: raw.status as string,
    buyerId: raw.buyer_id as string,
    sellerId: raw.seller_id as string,
    counterpartyId: raw.counterparty_id as string,
    currentRound: raw.current_round as number,
    roundsNoConcession: raw.rounds_no_concession as number,
    lastOfferPriceMinor: (raw.last_offer_price_minor as string) ?? null,
    lastUtility: raw.last_utility as DbSession["lastUtility"],
    strategySnapshot: raw.strategy_snapshot as Record<string, unknown>,
    version: raw.version as number,
    expiresAt: raw.expires_at ? new Date(raw.expires_at as string) : null,
    createdAt: new Date(raw.created_at as string),
    updatedAt: new Date(raw.updated_at as string),
    // LLM engine extension columns (Step 57)
    phase: (raw.phase as string) ?? null,
    interventionMode: (raw.intervention_mode as string) ?? null,
    buddyTone: (raw.buddy_tone as Record<string, unknown>) ?? null,
    coachingSnapshot: (raw.coaching_snapshot as Record<string, unknown>) ?? null,
  };
}
