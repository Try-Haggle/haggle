import type { Database } from "@haggle/db";
import { buyerChoiceOptionsForCheck } from "@haggle/shared";
import { buildHostHnpOfferEnvelope } from "../hnp/host-envelope.js";
import { submitHnpOffer } from "../hnp/submit-offer.js";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import type { AuthUser } from "../middleware/auth.js";
import {
  buyerCriteriaRequiredReject,
  readSellerCriteriaFromSnapshot,
  SELLER_CRITERIA_PAUSE_MARKER,
} from "../negotiation/phase/seller-criteria-pause.js";
import {
  attachNegotiationAutoPlayContext,
  getNegotiationAutoPlayContext,
  isNegotiationAutoPlayTerminal,
  planNegotiationAutoPlayRound,
} from "./negotiation-auto-play.service.js";
import { getRoundsBySessionId } from "./negotiation-round.service.js";
import {
  getSessionById,
  type NegotiationDriver,
  setSessionPerspective,
  updateSessionState,
} from "./negotiation-session.service.js";

export type AutoPlayNextResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

export async function executeAutoPlayNext(
  db: Database,
  input: {
    sessionId: string;
    actor: AuthUser;
    expectedDriver: NegotiationDriver;
    eventDispatcher?: EventDispatcher;
  },
): Promise<AutoPlayNextResult> {
  const session = await getSessionById(db, input.sessionId);
  if (!session) {
    return { ok: false, status: 404, body: { error: "SESSION_NOT_FOUND" } };
  }
  const driver = session.driver === "mcp" ? "mcp" : "web";
  if (driver !== input.expectedDriver) {
    return { ok: false, status: 409, body: { error: "DRIVER_MISMATCH" } };
  }
  if (
    input.actor.role !== "admin" &&
    input.actor.id !== session.buyerId &&
    input.actor.id !== session.sellerId
  ) {
    return { ok: false, status: 403, body: { error: "SESSION_ACTOR_MISMATCH" } };
  }

  const context = getNegotiationAutoPlayContext(session.negotiationAgentSnapshot);
  if (!context) {
    return { ok: false, status: 409, body: { error: "AUTO_PLAY_CONTEXT_MISSING" } };
  }

  if (isNegotiationAutoPlayTerminal(session.status)) {
    return {
      ok: true,
      status: 200,
      body: {
        complete: true,
        session_status: session.status,
        current_round: session.currentRound,
      },
    };
  }

  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    const expired = await updateSessionState(db, session.id, session.version, {
      status: "EXPIRED",
    });
    if (!expired) {
      return { ok: false, status: 409, body: { error: "CONCURRENT_MODIFICATION" } };
    }
    return {
      ok: true,
      status: 200,
      body: {
        complete: true,
        session_status: expired.status,
        current_round: expired.currentRound,
      },
    };
  }

  if (session.currentRound >= context.maxRounds) {
    const stalled = await updateSessionState(db, session.id, session.version, {
      status: "STALLED",
    });
    if (!stalled) {
      return { ok: false, status: 409, body: { error: "CONCURRENT_MODIFICATION" } };
    }
    return {
      ok: true,
      status: 200,
      body: {
        complete: true,
        session_status: stalled.status,
        current_round: stalled.currentRound,
      },
    };
  }

  const criteriaReject = buyerCriteriaRequiredReject(context.buyerSnapshot);
  if (criteriaReject) {
    return { ok: false, status: 409, body: criteriaReject };
  }

  const rounds = await getRoundsBySessionId(db, session.id);
  const latestRound = rounds.at(-1);
  const latestReasoning = (latestRound?.metadata as Record<string, unknown> | null)?.reasoning;
  if (
    typeof latestReasoning === "string" &&
    latestReasoning.includes(SELLER_CRITERIA_PAUSE_MARKER)
  ) {
    const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(context.buyerSnapshot);
    const unresolved = unresolvedAsks(sellerRequired, buyerCriteria);
    if (unresolved.length > 0) {
      return {
        ok: true,
        status: 200,
        body: {
          paused_for_buyer: true,
          pause_checks: unresolved.map((c) => ({
            checkId: c.checkId,
            ask: c.ask,
            options: buyerChoiceOptionsForCheck(c.checkId).map((o) => ({
              label: o.label,
              stance: o.stance,
            })),
          })),
          pause_questions: unresolved.map((c) => c.ask),
          pause_check_ids: unresolved.map((c) => c.checkId),
          session_status: session.status,
          current_round: session.currentRound,
        },
      };
    }
  }

  const plan = planNegotiationAutoPlayRound(session, rounds, context);
  if (!plan) {
    return { ok: false, status: 409, body: { error: "AUTO_PLAY_ROUND_UNAVAILABLE" } };
  }

  const claimed = await setSessionPerspective(
    db,
    session.id,
    plan.responderRole,
    attachNegotiationAutoPlayContext(plan.responderSnapshot, context),
    session.version,
  );
  if (!claimed) {
    return { ok: false, status: 409, body: { error: "CONCURRENT_MODIFICATION" } };
  }

  try {
    const envelope = buildHostHnpOfferEnvelope({
      sessionId: session.id,
      roundNo: plan.roundNo,
      senderRole: plan.senderRole,
      priceMinor: plan.offerPriceMinor,
      nowMs: Date.now(),
    });
    const submitted = await submitHnpOffer(db, envelope, {
      messageText: plan.messageText,
      eventDispatcher: input.eventDispatcher,
      requireSignature: false,
    });
    if (!submitted.ok) {
      return {
        ok: false,
        status: submitted.status,
        body: submitted.body as Record<string, unknown>,
      };
    }
    const result = {
      idempotent: submitted.idempotent,
      roundId: submitted.roundId,
      roundNo: submitted.roundNo,
      decision: submitted.decision,
      sessionStatus: submitted.sessionStatus,
    };

    let finalSession = await getSessionById(db, session.id);
    if (
      finalSession &&
      !isNegotiationAutoPlayTerminal(finalSession.status) &&
      finalSession.currentRound >= context.maxRounds
    ) {
      finalSession =
        (await updateSessionState(db, finalSession.id, finalSession.version, {
          status: "STALLED",
        })) ?? finalSession;
    }

    const finalStatus = finalSession?.status ?? result.sessionStatus;
    return {
      ok: true,
      status: result.idempotent ? 200 : 201,
      body: {
        complete: isNegotiationAutoPlayTerminal(finalStatus),
        session_status: finalStatus,
        current_round: finalSession?.currentRound ?? result.roundNo,
        round_id: result.roundId,
        round_no: result.roundNo,
        decision: result.decision,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("SESSION_NOT_FOUND")) {
      return { ok: false, status: 404, body: { error: "SESSION_NOT_FOUND" } };
    }
    if (message.startsWith("SESSION_EXPIRED")) {
      const latest = await getSessionById(db, session.id);
      if (!latest) {
        return { ok: false, status: 404, body: { error: "SESSION_NOT_FOUND" } };
      }
      const expired = isNegotiationAutoPlayTerminal(latest.status)
        ? latest
        : await updateSessionState(db, latest.id, latest.version, { status: "EXPIRED" });
      if (!expired) {
        return { ok: false, status: 409, body: { error: "CONCURRENT_MODIFICATION" } };
      }
      return {
        ok: true,
        status: 200,
        body: {
          complete: true,
          session_status: expired.status,
          current_round: expired.currentRound,
        },
      };
    }
    if (
      message.startsWith("SESSION_TERMINAL") ||
      message.startsWith("SESSION_MAX_ROUNDS_EXCEEDED") ||
      message.startsWith("ROUND_LIMIT_EXCEEDED")
    ) {
      const latest = await getSessionById(db, session.id);
      return {
        ok: false,
        status: 409,
        body: {
          error: "SESSION_TERMINAL",
          session_status: latest?.status,
          current_round: latest?.currentRound,
        },
      };
    }
    if (message.startsWith("CONCURRENT_MODIFICATION")) {
      return { ok: false, status: 409, body: { error: "CONCURRENT_MODIFICATION" } };
    }
    return { ok: false, status: 502, body: { error: "AUTO_PLAY_ROUND_FAILED" } };
  }
}

function unresolvedAsks(
  sellerRequired: Array<{ checkId: string; buyerAskKo?: string; questionKo?: string }>,
  buyerCriteria: Array<{ checkId: string; stance?: string }>,
) {
  const answered = new Set(
    buyerCriteria
      .filter((c) => typeof c.stance === "string" && c.stance.trim())
      .map((c) => c.checkId),
  );
  return sellerRequired
    .filter((c) => !answered.has(c.checkId))
    .map((c) => ({ checkId: c.checkId, ask: (c.buyerAskKo ?? c.questionKo)?.trim() }))
    .filter((c): c is { checkId: string; ask: string } => Boolean(c.ask));
}
