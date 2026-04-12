import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql, type Database } from "@haggle/db";
import { requireAuth } from "../middleware/require-auth.js";
import {
  createSession,
  getSessionById,
  getSessionsByUserId,
  updateSessionState,
} from "../services/negotiation-session.service.js";
import { getRoundsBySessionId } from "../services/negotiation-round.service.js";
import { executeNegotiationRound } from "../lib/negotiation-executor.js";
import { getExecutor } from "../lib/executor-factory.js";
import { executeGroupOrchestration, executeGroupTerminal } from "../lib/group-executor.js";
import type { EventDispatcher } from "../lib/event-dispatcher.js";

// ── Zod Schemas ────────────────────────────────────────────

const createSessionSchema = z.object({
  listing_id: z.string().uuid(),
  strategy_id: z.string().min(1),
  role: z.enum(["BUYER", "SELLER"]),
  buyer_id: z.string().uuid(),
  seller_id: z.string().uuid(),
  counterparty_id: z.string().uuid(),
  strategy_snapshot: z.record(z.unknown()),
  group_id: z.string().uuid().optional(),
  intent_id: z.string().uuid().optional(),
  expires_at: z.string().datetime().optional(),
});

const submitOfferSchema = z.object({
  price_minor: z.number().int().positive(),
  sender_role: z.enum(["BUYER", "SELLER"]),
  idempotency_key: z.string().min(1),
  round_data: z
    .object({
      r_score: z.number().min(0).max(1).optional(),
      i_completeness: z.number().min(0).max(1).optional(),
      t_elapsed: z.number().nonnegative().optional(),
      n_success: z.number().int().nonnegative().optional(),
      n_dispute_losses: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

// ── Route Registration ─────────────────────────────────────

export function registerNegotiationRoutes(
  app: FastifyInstance,
  db: Database,
  eventDispatcher: EventDispatcher,
) {
  // POST /negotiations/sessions — 세션 생성
  app.post(
    "/negotiations/sessions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = createSessionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_SESSION_REQUEST", issues: parsed.error.issues });
      }

      const data = parsed.data;
      const session = await createSession(db, {
        listingId: data.listing_id,
        strategyId: data.strategy_id,
        role: data.role,
        buyerId: data.buyer_id,
        sellerId: data.seller_id,
        counterpartyId: data.counterparty_id,
        strategySnapshot: data.strategy_snapshot,
        groupId: data.group_id,
        intentId: data.intent_id,
        expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      });

      return reply.code(201).send({ session });
    },
  );

  // GET /negotiations/sessions — 유저별 세션 목록
  app.get<{ Querystring: { user_id: string; role?: string; status?: string } }>(
    "/negotiations/sessions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { user_id, role, status } = request.query;
      if (!user_id) {
        return reply.code(400).send({ error: "MISSING_USER_ID" });
      }

      const sessions = await getSessionsByUserId(
        db,
        user_id,
        (role as "BUYER" | "SELLER") ?? undefined,
        (status as "CREATED" | "ACTIVE" | "NEAR_DEAL" | "STALLED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED" | "WAITING") ?? undefined,
      );

      return reply.send({
        sessions: sessions.map((s) => ({
          id: s.id,
          group_id: s.groupId,
          listing_id: s.listingId,
          role: s.role,
          status: s.status,
          current_round: s.currentRound,
          last_offer_price_minor: s.lastOfferPriceMinor,
          last_utility: s.lastUtility,
          version: s.version,
          expires_at: s.expiresAt,
          created_at: s.createdAt,
          updated_at: s.updatedAt,
        })),
      });
    },
  );

  // GET /negotiations/sessions/:id — 세션 상태 + 라운드 이력
  app.get<{ Params: { id: string } }>(
    "/negotiations/sessions/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }

      const rounds = await getRoundsBySessionId(db, session.id);

      // 공정함: utility 점수 공개, 상대방 전략 파라미터 비공개
      return reply.send({
        session: {
          id: session.id,
          group_id: session.groupId,
          listing_id: session.listingId,
          role: session.role,
          status: session.status,
          current_round: session.currentRound,
          last_offer_price_minor: session.lastOfferPriceMinor,
          last_utility: session.lastUtility,
          version: session.version,
          expires_at: session.expiresAt,
          created_at: session.createdAt,
          updated_at: session.updatedAt,
        },
        rounds: rounds.map((r) => ({
          id: r.id,
          round_no: r.roundNo,
          sender_role: r.senderRole,
          message_type: r.messageType,
          price_minor: r.priceminor,
          counter_price_minor: r.counterPriceMinor,
          utility: r.utility,
          decision: r.decision,
          created_at: r.createdAt,
        })),
      });
    },
  );

  // POST /negotiations/sessions/:id/offers — 오퍼 제출 (라운드 실행)
  app.post<{ Params: { id: string }; Querystring: { include_explainability?: string } }>(
    "/negotiations/sessions/:id/offers",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = submitOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_OFFER_REQUEST", issues: parsed.error.issues });
      }

      const data = parsed.data;

      try {
        const executor = getExecutor();
        const result = await executor(db, {
          sessionId: request.params.id,
          offerPriceMinor: data.price_minor,
          senderRole: data.sender_role,
          idempotencyKey: data.idempotency_key,
          roundData: data.round_data ?? {},
          nowMs: Date.now(),
        }, eventDispatcher);

        // Post-round: group orchestration (if session belongs to a group)
        const session = await getSessionById(db, request.params.id);
        if (session?.groupId && !result.idempotent) {
          const terminalStatuses = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);
          if (terminalStatuses.has(result.sessionStatus)) {
            await executeGroupTerminal(
              db,
              session.groupId,
              request.params.id,
              result.sessionStatus as "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED",
              eventDispatcher,
            ).catch((err) => {
              console.error("[negotiations] group terminal error:", err);
            });
          } else {
            await executeGroupOrchestration(db, session.groupId, eventDispatcher).catch((err) => {
              console.error("[negotiations] group orchestration error:", err);
            });
          }
        }

        // Extended fields from LLM executor (undefined for rule-based)
        const extended = result as unknown as Record<string, unknown>;
        const responseBody: Record<string, unknown> = {
          idempotent: result.idempotent,
          round_id: result.roundId,
          round_no: result.roundNo,
          decision: result.decision,
          outgoing_price: result.outgoingPrice,
          utility: result.utility,
          session_status: result.sessionStatus,
          escalation: result.escalation
            ? { type: result.escalation.type, context: result.escalation.context }
            : undefined,
        };

        // LLM engine extensions (present when NEGOTIATION_ENGINE=llm)
        if (extended.message) responseBody.message = extended.message;
        if (extended.phase) responseBody.phase = extended.phase;
        if (extended.reasoningUsed !== undefined) responseBody.reasoning_used = extended.reasoningUsed;

        // Explainability: only when staged pipeline + client opts in
        const includeExplainability = request.query.include_explainability === 'true';
        if (includeExplainability && extended.explainability) {
          responseBody.explainability = extended.explainability;
        }

        return reply.code(result.idempotent ? 200 : 201).send(responseBody);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);

        if (message.startsWith("SESSION_NOT_FOUND")) {
          return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
        }
        if (message.startsWith("SESSION_TERMINAL")) {
          return reply.code(409).send({ error: "SESSION_TERMINAL", message });
        }
        if (message === "SESSION_EXPIRED") {
          return reply.code(410).send({ error: "SESSION_EXPIRED", message: "Session has expired" });
        }
        if (message.startsWith("CONCURRENT_MODIFICATION")) {
          return reply.code(409).send({ error: "CONCURRENT_MODIFICATION", message: "Please retry" });
        }

        throw err;
      }
    },
  );

  // PATCH /negotiations/sessions/:id/accept — 수락
  app.patch<{ Params: { id: string } }>(
    "/negotiations/sessions/:id/accept",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }

      const acceptableStatuses = new Set(["ACTIVE", "NEAR_DEAL"]);
      if (!acceptableStatuses.has(session.status)) {
        return reply.code(409).send({ error: "INVALID_STATUS", message: `Cannot accept from ${session.status}` });
      }

      const updated = await updateSessionState(db, session.id, session.version, {
        status: "ACCEPTED",
      });

      if (!updated) {
        return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
      }

      // Dispatch agreed event
      await eventDispatcher.dispatch({
        domain: "negotiation",
        type: "negotiation.agreed",
        payload: {
          session_id: session.id,
          agreed_price_minor: Number(session.lastOfferPriceMinor ?? 0),
          buyer_id: session.buyerId,
          seller_id: session.sellerId,
        },
        idempotency_key: `neg_agreed_${session.id}`,
        timestamp: Date.now(),
      }).catch((err) => {
        console.error("[negotiations] event dispatch error:", err);
      });

      // Group handling
      if (session.groupId) {
        await executeGroupTerminal(
          db, session.groupId, session.id, "ACCEPTED", eventDispatcher,
        ).catch((err) => {
          console.error("[negotiations] group terminal error:", err);
        });
      }

      return reply.send({ updated: true, session_status: "ACCEPTED" });
    },
  );

  // PATCH /negotiations/sessions/:id/reject — 거절
  app.patch<{ Params: { id: string } }>(
    "/negotiations/sessions/:id/reject",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }

      const TERMINAL = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);
      if (TERMINAL.has(session.status)) {
        return reply.code(409).send({ error: "SESSION_TERMINAL", message: `Already ${session.status}` });
      }

      const updated = await updateSessionState(db, session.id, session.version, {
        status: "REJECTED",
      });

      if (!updated) {
        return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
      }

      // Dispatch terminal event
      await eventDispatcher.dispatch({
        domain: "negotiation",
        type: "negotiation.session.terminal",
        payload: { session_id: session.id, terminal_status: "REJECTED", intent_id: session.intentId },
        idempotency_key: `neg_terminal_${session.id}_REJECTED`,
        timestamp: Date.now(),
      }).catch((err) => {
        console.error("[negotiations] event dispatch error:", err);
      });

      // Group handling
      if (session.groupId) {
        await executeGroupTerminal(
          db, session.groupId, session.id, "REJECTED", eventDispatcher,
        ).catch((err) => {
          console.error("[negotiations] group terminal error:", err);
        });
      }

      return reply.send({ updated: true, session_status: "REJECTED" });
    },
  );

  // GET /negotiations/sessions/:id/state — 경량 상태 조회 (polling)
  app.get<{ Params: { id: string } }>(
    "/negotiations/sessions/:id/state",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }

      return reply.send({
        status: session.status,
        current_round: session.currentRound,
        last_offer_price_minor: session.lastOfferPriceMinor,
        last_utility: session.lastUtility,
        version: session.version,
        updated_at: session.updatedAt,
      });
    },
  );

  // GET /negotiations/sessions/:id/decisions — 라운드별 의사결정 로그
  app.get<{ Params: { id: string } }>(
    "/negotiations/sessions/:id/decisions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }

      const rounds = await getRoundsBySessionId(db, session.id);

      // Extract explainability data from round metadata (stored by staged pipeline)
      const decisions = rounds
        .map((r) => {
          const meta = r.metadata as Record<string, unknown> | null;
          const explainability = meta?.explainability as Record<string, unknown> | undefined;
          if (!explainability) return null;
          return explainability;
        })
        .filter((d): d is Record<string, unknown> => d !== null);

      return reply.send({
        session_id: session.id,
        decisions,
      });
    },
  );

  // POST /negotiations/sessions/expire-stale — cron 벌크 만료
  // Vercel Cron 또는 외부 scheduler에서 호출
  app.post(
    "/negotiations/sessions/expire-stale",
    async (request, reply) => {
      const cronSecret = request.headers["x-cron-secret"];
      if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
        return reply.code(401).send({ error: "UNAUTHORIZED" });
      }

      const result = await db.execute(sql`
        UPDATE negotiation_sessions
        SET status = 'EXPIRED', updated_at = NOW(), version = version + 1
        WHERE status NOT IN ('ACCEPTED', 'REJECTED', 'EXPIRED', 'SUPERSEDED')
          AND expires_at IS NOT NULL
          AND expires_at < NOW()
      `);

      const count = Array.isArray(result) ? result.length : 0;
      return reply.send({ expired_count: count });
    },
  );
}
