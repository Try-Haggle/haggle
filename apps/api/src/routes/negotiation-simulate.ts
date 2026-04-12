/**
 * In-memory negotiation simulation.
 *
 * Runs engine ↔ engine ping-pong entirely in process. Zero DB calls.
 * Use this when both parties are AI agents on our infrastructure and
 * the full transcript can be persisted at the end.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { executeRound } from "@haggle/engine-session";
import type { MasterStrategy, RoundData } from "@haggle/engine-session";
import type {
  NegotiationSession,
  HnpMessage,
} from "@haggle/engine-session";

const strategySchema = z.record(z.unknown());

const simulateSchema = z.object({
  buyer_strategy: strategySchema,
  seller_strategy: strategySchema,
  initial_offer: z.object({
    from: z.enum(["BUYER", "SELLER"]),
    price_minor: z.number().int().positive(),
  }),
  max_rounds: z.number().int().min(1).max(50).default(20),
});

function emptySession(role: "BUYER" | "SELLER", nowMs: number): NegotiationSession {
  return {
    session_id: `sim-${role.toLowerCase()}-${nowMs}`,
    strategy_id: `strat-${role.toLowerCase()}`,
    role,
    status: "ACTIVE",
    counterparty_id: role === "BUYER" ? "seller" : "buyer",
    rounds: [],
    current_round: 0,
    rounds_no_concession: 0,
    last_offer_price: null,
    last_utility: null,
    created_at: nowMs,
    updated_at: nowMs,
  };
}

function buildMsg(
  sessionId: string,
  price: number,
  from: "BUYER" | "SELLER",
  roundNo: number,
  nowMs: number,
): HnpMessage {
  return {
    session_id: sessionId,
    round: roundNo,
    type: roundNo === 1 ? "OFFER" : "COUNTER",
    price,
    sender_role: from,
    timestamp: nowMs,
  };
}

const DEFAULT_ROUND_DATA: RoundData = {
  p_effective: 0,
  r_score: 0.7,
  i_completeness: 0.8,
  t_elapsed: 0,
  n_success: 5,
  n_dispute_losses: 0,
};

export function registerSimulateRoute(app: FastifyInstance) {
  app.post("/negotiations/simulate", async (request, reply) => {
    const parsed = simulateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_SIMULATE_REQUEST", issues: parsed.error.issues });
    }

    const { buyer_strategy, seller_strategy, initial_offer, max_rounds } = parsed.data;
    const buyerStrategy = buyer_strategy as unknown as MasterStrategy;
    const sellerStrategy = seller_strategy as unknown as MasterStrategy;
    const startedAt = Date.now();

    let buyerSession = emptySession("BUYER", startedAt);
    let sellerSession = emptySession("SELLER", startedAt);

    const transcript: Array<{
      step: number;
      from: "BUYER" | "SELLER";
      to: "BUYER" | "SELLER";
      price: number;
      decision: string;
      counter_price: number | null;
      utility: { u_total: number; v_p: number; v_t: number; v_r: number; v_s: number };
      session_status: string;
      escalation: boolean;
    }> = [];

    let nextFrom: "BUYER" | "SELLER" = initial_offer.from;
    let nextPrice = initial_offer.price_minor;
    let terminalReason: string | null = null;

    for (let i = 0; i < max_rounds; i++) {
      // The OPPOSITE side's engine evaluates the incoming offer
      const to: "BUYER" | "SELLER" = nextFrom === "BUYER" ? "SELLER" : "BUYER";
      const session = to === "BUYER" ? buyerSession : sellerSession;
      const strategy = to === "BUYER" ? buyerStrategy : sellerStrategy;
      const nowMs = Date.now();
      const roundNo = session.current_round + 1;
      const incoming = buildMsg(session.session_id, nextPrice, nextFrom, roundNo, nowMs);

      const roundData: RoundData = {
        ...DEFAULT_ROUND_DATA,
        p_effective: nextPrice,
        t_elapsed: nowMs - startedAt,
      };

      let result;
      try {
        result = executeRound(session, strategy, incoming, roundData);
      } catch (err) {
        return reply.code(400).send({
          error: "ENGINE_ERROR",
          message: err instanceof Error ? err.message : String(err),
          step: i + 1,
        });
      }

      // Update the session that just acted
      if (to === "BUYER") buyerSession = result.session;
      else sellerSession = result.session;

      const counterPrice = result.message.price;
      transcript.push({
        step: i + 1,
        from: nextFrom,
        to,
        price: nextPrice,
        decision: result.decision,
        counter_price: counterPrice ?? null,
        utility: {
          u_total: result.utility.u_total,
          v_p: result.utility.v_p,
          v_t: result.utility.v_t,
          v_r: result.utility.v_r,
          v_s: result.utility.v_s,
        },
        session_status: result.session.status,
        escalation: !!result.escalation,
      });

      if (result.decision === "ACCEPT" || result.session.status === "ACCEPTED") {
        terminalReason = "ACCEPTED";
        break;
      }
      if (
        result.decision === "REJECT" ||
        result.session.status === "REJECTED" ||
        result.session.status === "EXPIRED"
      ) {
        terminalReason = result.session.status;
        break;
      }
      if (result.escalation) {
        terminalReason = "ESCALATED";
        break;
      }

      // Counter becomes the next incoming offer; sides flip
      nextFrom = to;
      nextPrice = counterPrice;
    }

    return reply.send({
      ok: true,
      duration_ms: Date.now() - startedAt,
      total_rounds: transcript.length,
      terminal_reason: terminalReason ?? "MAX_ROUNDS",
      final_price: transcript[transcript.length - 1]?.price ?? null,
      final_status: transcript[transcript.length - 1]?.session_status ?? null,
      transcript,
      buyer_session: { status: buyerSession.status, current_round: buyerSession.current_round },
      seller_session: { status: sellerSession.status, current_round: sellerSession.current_round },
    });
  });
}
