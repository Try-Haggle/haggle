import type { FastifyInstance } from "fastify";
import type { AuthUser } from "../middleware/auth.js";
import { z } from "zod";
import { sql, type Database } from "@haggle/db";
import {
  computeHnpProposalHash,
  createHnpAgreementObject,
  createHnpTransactionHandoff,
  createHnpTransactionHandoffFromSignals,
  summarizeHnpTransactionHandoffChain,
  validateHnpTransactionHandoff,
  type HnpAgreementObject,
  type HnpTransactionHandoff,
  type HnpTransactionHandoffChainSummary,
} from "@haggle/engine-session";
import { requireAuth } from "../middleware/require-auth.js";
import {
  createSession,
  getSessionById,
  getSessionsByUserId,
  updateSessionState,
} from "../services/negotiation-session.service.js";
import { createRound, getRoundsBySessionId } from "../services/negotiation-round.service.js";
import { executeNegotiationRound } from "../lib/negotiation-executor.js";
import { getExecutor } from "../lib/executor-factory.js";
import { executeGroupOrchestration, executeGroupTerminal } from "../lib/group-executor.js";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import {
  defaultAttemptControlPolicy,
  evaluateAttemptControl,
  type AttemptControlSnapshot,
} from "../services/attempt-control.service.js";
import { evaluateNegotiationStartReadiness } from "../services/negotiation-readiness.service.js";
import { loadUserMemoryBrief } from "../services/user-memory-card.service.js";
import { validateHnpIngress } from "../services/hnp-ingress.service.js";

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

const hnpEnvelopeSchema = z.object({
  spec_version: z.string().min(1),
  capability: z.string().min(1),
  session_id: z.string().uuid(),
  message_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  sent_at_ms: z.number().int().positive(),
  expires_at_ms: z.number().int().positive(),
  sender_agent_id: z.string().min(1),
  sender_role: z.enum(["BUYER", "SELLER"]),
  type: z.enum(["OFFER", "COUNTER"]),
  payload: z.object({
    proposal_id: z.string().min(1),
    issues: z.array(z.object({
      issue_id: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
      unit: z.string().optional(),
      kind: z.enum(["NEGOTIABLE", "INFORMATIONAL"]).optional(),
    })).default([]),
    total_price: z.object({
      currency: z.string().length(3).default("USD"),
      units_minor: z.number().int().positive(),
    }),
    proposal_hash: z.string().min(1).optional(),
    rationale_code: z.string().optional(),
    valid_until: z.string().optional(),
    in_reply_to: z.string().optional(),
    settlement_preconditions: z.array(z.string().min(1)).optional(),
  }),
  detached_signature: z.string().optional(),
});

const hnpAcceptEnvelopeSchema = z.object({
  spec_version: z.string().min(1),
  capability: z.string().min(1),
  session_id: z.string().uuid(),
  message_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().optional(),
  sequence: z.number().int().nonnegative(),
  sent_at_ms: z.number().int().positive(),
  expires_at_ms: z.number().int().positive(),
  sender_agent_id: z.string().min(1),
  sender_role: z.enum(["BUYER", "SELLER"]),
  type: z.literal("ACCEPT"),
  payload: z.object({
    accepted_message_id: z.string().min(1),
    accepted_proposal_id: z.string().min(1),
    accepted_proposal_hash: z.string().min(1).optional(),
    accepted_issues: z.array(z.object({
      issue_id: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean()]),
      unit: z.string().optional(),
      kind: z.enum(["NEGOTIABLE", "INFORMATIONAL"]).optional(),
    })).optional(),
  }),
  detached_signature: z.string().optional(),
});

const transactionSignalsSchema = z.object({
  payment_decision: z.enum(["AUTO_APPROVE", "HUMAN_APPROVAL_REQUIRED", "BLOCKED"]).optional(),
  payment_reasons: z.array(z.string().trim().min(1)).optional(),
  settlement_completed: z.boolean().optional(),
  dispute_evidence_packet_hashes: z.array(z.string().min(1)).optional(),
  trust_event_hashes: z.array(z.string().min(1)).optional(),
}).optional();

const agentDelegationSchema = z.object({
  principal_user_id: z.string().min(1),
  agent_id: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  expires_at_ms: z.number().int().positive(),
  delegation_id: z.string().min(1).optional(),
});

const submitOfferSchema = z.object({
  price_minor: z.number().int().positive().optional(),
  message_text: z.string().trim().min(1).max(4000).optional(),
  sender_role: z.enum(["BUYER", "SELLER"]).optional(),
  idempotency_key: z.string().min(1).optional(),
  hnp: hnpEnvelopeSchema.optional(),
  agent_delegation: agentDelegationSchema.optional(),
  round_data: z
    .object({
      r_score: z.number().min(0).max(1).optional(),
      i_completeness: z.number().min(0).max(1).optional(),
      t_elapsed: z.number().nonnegative().optional(),
      n_success: z.number().int().nonnegative().optional(),
      n_dispute_losses: z.number().int().nonnegative().optional(),
    })
    .optional(),
}).superRefine((value, ctx) => {
  if (!value.hnp && (value.price_minor === undefined || !value.sender_role || !value.idempotency_key)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either hnp or price_minor, sender_role, and idempotency_key are required",
    });
  }
});

type CreateSessionBody = z.infer<typeof createSessionSchema>;
type SubmitOfferBody = z.infer<typeof submitOfferSchema>;
type HnpOfferEnvelope = z.infer<typeof hnpEnvelopeSchema>;
type AcceptSessionBody = z.infer<typeof acceptSessionSchema>;
type AgentDelegation = z.infer<typeof agentDelegationSchema>;

interface SessionAccessView {
  buyerId: string;
  sellerId: string;
}

const acceptSessionSchema = z.object({
  accepted_message_id: z.string().min(1).optional(),
  accepted_proposal_id: z.string().min(1).optional(),
  hnp: hnpAcceptEnvelopeSchema.optional(),
  agent_delegation: agentDelegationSchema.optional(),
  transaction_signals: transactionSignalsSchema,
}).optional();

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
      const actor = request.user!;
      if (actor.role !== "admin" && !isAuthorizedSessionCreator(actor.id, data)) {
        return reply.code(403).send({ error: "SESSION_ACTOR_MISMATCH" });
      }

      let attemptControl: AttemptControlSnapshot | undefined;
      if (data.buyer_id === actor.id) {
        const memoryBrief = await loadUserMemoryBrief(db, {
          userId: data.buyer_id,
          limit: 8,
          minStrength: 0.25,
        });
        const readiness = evaluateNegotiationStartReadiness({
          role: data.role,
          strategySnapshot: data.strategy_snapshot,
          memoryBrief,
        });
        if (!readiness.ready) {
          return reply.code(409).send({
            error: "NEGOTIATION_READINESS_INCOMPLETE",
            readiness,
          });
        }

        const attemptResult = await evaluateAttemptControl(db, {
          buyerPrincipalId: actor.id,
          listingId: data.listing_id,
        });
        attemptControl = attemptResult.attemptControl;
        if (!attemptResult.allowed) {
          if (attemptResult.retryAfterSeconds) {
            reply.header("retry-after", String(attemptResult.retryAfterSeconds));
          }
          return reply.code(attemptResult.error === "ATTEMPT_LIMIT_EXCEEDED" ? 429 : 409).send({
            error: attemptResult.error,
            attempt_control: attemptResult.attemptControl,
          });
        }
      }

      const roundLimit = attemptControl?.max_rounds_per_session
        ?? defaultAttemptControlPolicy().maxRoundsPerSession;
      const strategySnapshot = applyRoundLimitToStrategy(data.strategy_snapshot, roundLimit);
      const session = await createSession(db, {
        listingId: data.listing_id,
        strategyId: data.strategy_id,
        role: data.role,
        buyerId: data.buyer_id,
        sellerId: data.seller_id,
        counterpartyId: data.counterparty_id,
        strategySnapshot,
        groupId: data.group_id,
        intentId: data.intent_id,
        expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
      });

      return reply.code(201).send({ session, attempt_control: attemptControl });
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
      if (request.user!.role !== "admin" && request.user!.id !== user_id) {
        return reply.code(403).send({ error: "SESSION_ACTOR_MISMATCH" });
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
      const access = validateSessionParticipant(request.user!, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
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
      const nowMs = Date.now();
      const normalized = normalizeSubmitOffer(data, request.params.id, nowMs);
      if (!normalized.ok) {
        return reply.code(normalized.status).send(normalized.body);
      }
      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }
      const writeAccess = validateSessionWriteAccess(request.user!, session, {
        senderRole: normalized.senderRole,
        senderAgentId: normalized.protocol?.senderAgentId,
        agentDelegation: data.agent_delegation,
        action: "offer",
        nowMs,
      });
      if (!writeAccess.ok) {
        return reply.code(writeAccess.status).send({ error: writeAccess.error });
      }
      if (normalized.hnp || normalized.protocol) {
        const hnpIngress = await validateHnpIngress(db, request.params.id, {
          envelope: normalized.hnp,
          protocol: normalized.protocol,
        });
        if (!hnpIngress.ok) {
          return reply.code(hnpIngress.status).send(hnpIngress.body);
        }
      }

      try {
        const executor = getExecutor();
        const result = await executor(db, {
          sessionId: request.params.id,
          offerPriceMinor: normalized.offerPriceMinor,
          messageText: data.message_text,
          senderRole: normalized.senderRole,
          idempotencyKey: normalized.idempotencyKey,
          protocol: normalized.protocol,
          roundData: data.round_data ?? {},
          nowMs,
        }, eventDispatcher);

        // Post-round: group orchestration (if session belongs to a group)
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
        if (normalized.hnp) {
          responseBody.hnp = {
            spec_version: normalized.hnp.spec_version,
            capability: normalized.hnp.capability,
            message_id: normalized.hnp.message_id,
            sequence: normalized.hnp.sequence,
            proposal_id: normalized.hnp.payload.proposal_id,
            proposal_hash: normalized.protocol?.proposalHash,
          };
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
        if (message === "ROUND_LIMIT_EXCEEDED" || message === "SESSION_MAX_ROUNDS_EXCEEDED") {
          return reply.code(429).send({ error: "ROUND_LIMIT_EXCEEDED", message: "Round limit exceeded" });
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
      const parsed = acceptSessionSchema.safeParse(request.body ?? undefined);
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_ACCEPT_REQUEST", issues: parsed.error.issues });
      }

      const accepted = normalizeAcceptRequest(parsed.data, request.params.id, Date.now());
      if (!accepted.ok) {
        return reply.code(accepted.status).send(accepted.body);
      }

      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }
      const access = validateSessionParticipant(request.user!, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
      }
      if (accepted.protocol) {
        const protocolAccess = validateSessionWriteAccess(request.user!, session, {
          senderRole: accepted.protocol.senderRole,
          senderAgentId: accepted.protocol.senderAgentId,
          agentDelegation: accepted.agentDelegation,
          action: "accept",
          nowMs: Date.now(),
        });
        if (!protocolAccess.ok) {
          return reply.code(protocolAccess.status).send({ error: protocolAccess.error });
        }
        const hnpIngress = await validateHnpIngress(db, request.params.id, {
          envelope: accepted.hnp,
          protocol: accepted.protocol,
        });
        if (!hnpIngress.ok) {
          return reply.code(hnpIngress.status).send(hnpIngress.body);
        }
      }

      const acceptableStatuses = new Set(["ACTIVE", "NEAR_DEAL"]);
      if (!acceptableStatuses.has(session.status)) {
        return reply.code(409).send({ error: "INVALID_STATUS", message: `Cannot accept from ${session.status}` });
      }

      let acceptedRound: Awaited<ReturnType<typeof getRoundsBySessionId>>[number] | null = null;
      if (accepted.acceptedMessageId || accepted.acceptedProposalId || accepted.acceptedProposalHash) {
        const rounds = await getRoundsBySessionId(db, session.id);
        acceptedRound = rounds.find((round) => roundMatchesAcceptedProposal(round, accepted)) ?? null;
        if (!acceptedRound) {
          return reply.code(409).send({
            error: "INVALID_PROPOSAL",
            message: "Accepted HNP proposal is not known for this session",
          });
        }
        const storedIssues = getStoredHnpIssues(acceptedRound);
        if (accepted.acceptedIssues && storedIssues.length > 0 && !hnpIssuesEqual(accepted.acceptedIssues, storedIssues)) {
          return reply.code(409).send({
            error: "INVALID_PROPOSAL_ISSUES",
            message: "Accepted issue snapshot does not match the stored HNP proposal",
          });
        }
      }

      const acceptedAtMs = Date.now();
      const agreement = accepted.hnp
        ? buildAcceptedAgreement({
            session,
            accepted,
            acceptedRound,
            createdAtMs: acceptedAtMs,
          })
        : undefined;
      const handoff = agreement
        ? buildAcceptedTransactionHandoff({
            agreement,
            signals: accepted.transactionSignals,
            createdAtMs: acceptedAtMs,
          })
        : undefined;
      if (handoff && !handoff.validation.ok) {
        return reply.code(400).send({
          error: "INVALID_TRANSACTION_HANDOFF",
          issues: handoff.validation.issues,
        });
      }

      const updated = await finalizeAcceptedSession(db, {
        session,
        accepted,
        agreement,
        handoff,
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
          agreed_price_minor: getAcceptedEventPriceMinor({ agreement, session }),
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

      return reply.send({
        updated: true,
        session_status: "ACCEPTED",
        agreement,
        transaction_handoff: handoff?.handoff,
        transaction_handoff_summary: handoff?.summary,
      });
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
      const access = validateSessionParticipant(request.user!, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
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
      const access = validateSessionParticipant(request.user!, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
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
      const access = validateSessionParticipant(request.user!, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
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

function isAuthorizedSessionCreator(actorId: string, data: CreateSessionBody): boolean {
  return data.role === "BUYER" ? data.buyer_id === actorId : data.seller_id === actorId;
}

function validateSessionParticipant(
  actor: AuthUser,
  session: SessionAccessView,
): { ok: true } | { ok: false; status: 403; error: "SESSION_ACTOR_MISMATCH" } {
  if (actor.role === "admin") return { ok: true };
  if (actor.id === session.buyerId || actor.id === session.sellerId) return { ok: true };
  return { ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" };
}

function validateSessionWriteAccess(
  actor: AuthUser,
  session: SessionAccessView,
  input: {
    senderRole: "BUYER" | "SELLER";
    senderAgentId?: string;
    agentDelegation?: AgentDelegation;
    action?: "offer" | "accept";
    nowMs?: number;
  },
): { ok: true } | { ok: false; status: 403; error: "SESSION_ACTOR_MISMATCH" | "HNP_SENDER_AGENT_MISMATCH" | "HNP_AGENT_DELEGATION_INVALID" } {
  if (actor.role === "admin") return { ok: true };
  const principalId = input.senderRole === "BUYER" ? session.buyerId : session.sellerId;
  if (actor.id !== principalId) {
    return { ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" };
  }
  if (!input.senderAgentId || input.senderAgentId === actor.id) return { ok: true };

  if (isValidAgentDelegation(input.agentDelegation, {
    principalUserId: actor.id,
    agentId: input.senderAgentId,
    action: input.action ?? "offer",
    nowMs: input.nowMs ?? Date.now(),
  })) {
    return { ok: true };
  }

  return {
    ok: false,
    status: 403,
    error: input.agentDelegation ? "HNP_AGENT_DELEGATION_INVALID" : "HNP_SENDER_AGENT_MISMATCH",
  };
}

function isValidAgentDelegation(
  delegation: AgentDelegation | undefined,
  expected: {
    principalUserId: string;
    agentId: string;
    action: "offer" | "accept";
    nowMs: number;
  },
): boolean {
  if (!delegation) return false;
  if (delegation.principal_user_id !== expected.principalUserId) return false;
  if (delegation.agent_id !== expected.agentId) return false;
  if (delegation.expires_at_ms <= expected.nowMs) return false;
  return delegation.scopes.includes("hnp:negotiate")
    || delegation.scopes.includes(`hnp:${expected.action}`);
}

function applyRoundLimitToStrategy(
  strategySnapshot: Record<string, unknown>,
  maxRoundsPerSession: number,
): Record<string, unknown> {
  const current = typeof strategySnapshot.max_rounds === "number"
    ? strategySnapshot.max_rounds
    : Number(strategySnapshot.max_rounds);
  const capped = Number.isFinite(current) && current > 0
    ? Math.min(current, maxRoundsPerSession)
    : maxRoundsPerSession;
  return { ...strategySnapshot, max_rounds: capped };
}

function normalizeSubmitOffer(
  body: SubmitOfferBody,
  sessionId: string,
  nowMs: number,
): (
  | {
      ok: true;
      offerPriceMinor: number;
      senderRole: "BUYER" | "SELLER";
      idempotencyKey: string;
      protocol?: {
        specVersion: string;
        capability: string;
        messageId: string;
        idempotencyKey: string;
        proposalId: string;
        proposalHash?: string;
        messageType: string;
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
      hnp?: HnpOfferEnvelope;
    }
  | { ok: false; status: number; body: Record<string, unknown> }
) {
  if (!body.hnp) {
    return {
      ok: true,
      offerPriceMinor: body.price_minor!,
      senderRole: body.sender_role!,
      idempotencyKey: body.idempotency_key!,
    };
  }

  const envelope = body.hnp;
  if (envelope.session_id !== sessionId) {
    return {
      ok: false,
      status: 400,
      body: { error: "HNP_SESSION_MISMATCH" },
    };
  }

  if (envelope.expires_at_ms <= nowMs) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "STALE_MESSAGE",
        retryable: false,
        related_message_id: envelope.message_id,
      },
    };
  }

  const computedProposalHash = computeHnpProposalHash({
    proposal_id: envelope.payload.proposal_id,
    issues: envelope.payload.issues,
    total_price: envelope.payload.total_price,
    valid_until: envelope.payload.valid_until,
    settlement_preconditions: envelope.payload.settlement_preconditions,
  });
  if (envelope.payload.proposal_hash && envelope.payload.proposal_hash !== computedProposalHash) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "HNP_PROPOSAL_HASH_MISMATCH",
        retryable: false,
        related_message_id: envelope.message_id,
        expected_proposal_hash: computedProposalHash,
      },
    };
  }
  const proposalHash = envelope.payload.proposal_hash ?? computedProposalHash;

  return {
    ok: true,
    offerPriceMinor: envelope.payload.total_price.units_minor,
    senderRole: envelope.sender_role,
    idempotencyKey: envelope.idempotency_key,
    protocol: {
      specVersion: envelope.spec_version,
      capability: envelope.capability,
      messageId: envelope.message_id,
      idempotencyKey: envelope.idempotency_key,
      proposalId: envelope.payload.proposal_id,
      proposalHash,
      messageType: envelope.type,
      currency: envelope.payload.total_price.currency,
      issues: envelope.payload.issues,
      settlementPreconditions: envelope.payload.settlement_preconditions,
      sequence: envelope.sequence,
      senderAgentId: envelope.sender_agent_id,
      expiresAtMs: envelope.expires_at_ms,
    },
    hnp: envelope,
  };
}

function normalizeAcceptRequest(
  body: AcceptSessionBody,
  sessionId: string,
  nowMs: number,
): (
      | {
          ok: true;
          acceptedMessageId?: string;
          acceptedProposalId?: string;
          acceptedProposalHash?: string;
          acceptedIssues?: Array<{
            issue_id: string;
            value: string | number | boolean;
            unit?: string;
            kind?: "NEGOTIABLE" | "INFORMATIONAL";
          }>;
          transactionSignals?: NonNullable<NonNullable<AcceptSessionBody>["transaction_signals"]>;
          agentDelegation?: AgentDelegation;
          hnp?: NonNullable<AcceptSessionBody>["hnp"];
          protocol?: {
            messageId: string;
            idempotencyKey: string;
        sequence: number;
        senderRole: "BUYER" | "SELLER";
        senderAgentId: string;
        messageType: "ACCEPT";
        acceptedProposalHash?: string;
      };
    }
  | { ok: false; status: number; body: Record<string, unknown> }
) {
  if (!body?.hnp) {
    return {
      ok: true,
      acceptedMessageId: body?.accepted_message_id,
      acceptedProposalId: body?.accepted_proposal_id,
      transactionSignals: body?.transaction_signals,
      agentDelegation: body?.agent_delegation,
    };
  }

  if (body.hnp.session_id !== sessionId) {
    return {
      ok: false,
      status: 400,
      body: { error: "HNP_SESSION_MISMATCH" },
    };
  }

  if (body.hnp.expires_at_ms <= nowMs) {
    return {
      ok: false,
      status: 409,
      body: {
        error: "STALE_MESSAGE",
        retryable: false,
        related_message_id: body.hnp.message_id,
      },
    };
  }

  return {
    ok: true,
    acceptedMessageId: body.hnp.payload.accepted_message_id,
    acceptedProposalId: body.hnp.payload.accepted_proposal_id,
    acceptedProposalHash: body.hnp.payload.accepted_proposal_hash,
    acceptedIssues: body.hnp.payload.accepted_issues,
    transactionSignals: body.transaction_signals,
    agentDelegation: body.agent_delegation,
    hnp: body.hnp,
    protocol: {
      messageId: body.hnp.message_id,
      idempotencyKey: body.hnp.idempotency_key,
      sequence: body.hnp.sequence,
      senderRole: body.hnp.sender_role,
      senderAgentId: body.hnp.sender_agent_id,
      messageType: "ACCEPT",
      acceptedProposalHash: body.hnp.payload.accepted_proposal_hash,
    },
  };
}

function roundMatchesAcceptedProposal(
  round: { id: string; metadata: Record<string, unknown> | null },
  accepted: { acceptedMessageId?: string; acceptedProposalId?: string; acceptedProposalHash?: string },
): boolean {
  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ?? {}) as Record<string, unknown>;
  const messageId = typeof hnp.messageId === "string" ? hnp.messageId : undefined;
  const proposalId = typeof hnp.proposalId === "string" ? hnp.proposalId : undefined;
  const proposalHash = typeof hnp.proposalHash === "string" ? hnp.proposalHash : undefined;

  return Boolean(
    (!accepted.acceptedMessageId || accepted.acceptedMessageId === messageId || accepted.acceptedMessageId === round.id) &&
    (!accepted.acceptedProposalId || accepted.acceptedProposalId === proposalId) &&
    (!accepted.acceptedProposalHash || accepted.acceptedProposalHash === proposalHash),
  );
}

function getStoredHnpIssues(round: { metadata: Record<string, unknown> | null }): Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}> {
  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ?? {}) as Record<string, unknown>;
  return hnpIssueArrayOrEmpty(hnp.issues);
}

function hnpIssuesEqual(
  left: Array<{
    issue_id: string;
    value: string | number | boolean;
    unit?: string;
    kind?: "NEGOTIABLE" | "INFORMATIONAL";
  }>,
  right: Array<{
    issue_id: string;
    value: string | number | boolean;
    unit?: string;
    kind?: "NEGOTIABLE" | "INFORMATIONAL";
  }>,
): boolean {
  return JSON.stringify(normalizeHnpIssues(left)) === JSON.stringify(normalizeHnpIssues(right));
}

function normalizeHnpIssues(issues: Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}>): Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}> {
  return issues
    .map((issue) => ({
      issue_id: issue.issue_id,
      value: issue.value,
      ...(issue.unit ? { unit: issue.unit } : {}),
      ...(issue.kind ? { kind: issue.kind } : {}),
    }))
    .sort((a, b) => a.issue_id.localeCompare(b.issue_id));
}

function buildAcceptedAgreement(input: {
  session: {
    id: string;
    buyerId: string;
    sellerId: string;
    lastOfferPriceMinor?: string | number | null;
  };
  accepted: {
    acceptedMessageId?: string;
    acceptedProposalId?: string;
    acceptedProposalHash?: string;
    acceptedIssues?: Array<{
      issue_id: string;
      value: string | number | boolean;
      unit?: string;
      kind?: "NEGOTIABLE" | "INFORMATIONAL";
    }>;
  };
  acceptedRound: {
    id: string;
    priceminor?: string | number | null;
    priceMinor?: string | number | null;
    counterPriceMinor?: string | number | null;
    metadata: Record<string, unknown> | null;
  } | null;
  createdAtMs: number;
}): HnpAgreementObject {
  const hnp = ((input.acceptedRound?.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ?? {}) as Record<string, unknown>;
  const acceptedMessageId = input.accepted.acceptedMessageId ?? stringOrUndefined(hnp.messageId) ?? input.acceptedRound?.id ?? "";
  const acceptedProposalId = input.accepted.acceptedProposalId ?? stringOrUndefined(hnp.proposalId) ?? "";
  const acceptedProposalHash = input.accepted.acceptedProposalHash ?? stringOrUndefined(hnp.proposalHash);
  const acceptedIssues = input.accepted.acceptedIssues ?? hnpIssueArrayOrEmpty(hnp.issues);
  const currency = stringOrUndefined(hnp.currency) ?? "USD";
  const settlementPreconditions = stringArrayOrEmpty(hnp.settlementPreconditions);
  const agreedPriceMinor = numberFromUnknown(
    input.acceptedRound?.counterPriceMinor
    ?? input.acceptedRound?.priceminor
    ?? input.acceptedRound?.priceMinor
    ?? input.session.lastOfferPriceMinor
    ?? 0,
  );

  return createHnpAgreementObject({
    session_id: input.session.id,
    accepted_message_id: acceptedMessageId,
    accepted_proposal_id: acceptedProposalId,
    accepted_proposal_hash: acceptedProposalHash,
    agreed_price: {
      currency,
      units_minor: agreedPriceMinor,
    },
    accepted_issues: acceptedIssues,
    parties: [
      { role: "BUYER", agent_id: input.session.buyerId },
      { role: "SELLER", agent_id: input.session.sellerId },
    ],
    settlement_preconditions: settlementPreconditions,
    created_at_ms: input.createdAtMs,
  });
}

function buildAcceptedTransactionHandoff(input: {
  agreement: HnpAgreementObject;
  signals?: NonNullable<NonNullable<AcceptSessionBody>["transaction_signals"]>;
  createdAtMs: number;
}): {
  handoff: HnpTransactionHandoff;
  summary: HnpTransactionHandoffChainSummary | undefined;
  validation: ReturnType<typeof validateHnpTransactionHandoff>;
} {
  const common = {
    agreement_hash: input.agreement.agreement_hash,
    listing_evidence_bundle_hash: input.agreement.listing_evidence_bundle_hash,
    payment_approval_policy_hash: input.agreement.payment_approval_policy_hash,
    shipping_terms_hash: input.agreement.shipping_terms_hash,
    trust_event_hashes: input.signals?.trust_event_hashes,
    created_at_ms: input.createdAtMs,
  };
  const handoff = input.signals
    ? createHnpTransactionHandoffFromSignals({
        ...common,
        payment_decision: input.signals.payment_decision,
        payment_reasons: input.signals.payment_reasons,
        settlement_completed: input.signals.settlement_completed,
        dispute_evidence_packet_hashes: input.signals.dispute_evidence_packet_hashes,
      })
    : createHnpTransactionHandoff({
        ...common,
        status: "ready_for_settlement",
      });
  const validation = validateHnpTransactionHandoff(handoff, { verifyHash: true });

  return {
    handoff,
    summary: validation.ok ? summarizeHnpTransactionHandoffChain([handoff], { verifyHash: true }) : undefined,
    validation,
  };
}

async function finalizeAcceptedSession(
  db: Database,
  input: {
    session: {
      id: string;
      version: number;
      currentRound: number;
    };
    accepted: ReturnType<typeof normalizeAcceptRequest> extends infer T
      ? T extends { ok: true } ? T : never
      : never;
    agreement?: HnpAgreementObject;
    handoff?: {
      handoff: HnpTransactionHandoff;
      summary: HnpTransactionHandoffChainSummary | undefined;
    };
  },
) {
  return db.transaction(async (tx) => {
    const shouldPersistAcceptRound = Boolean(input.agreement && input.handoff && input.accepted.protocol);
    const updated = await updateSessionState(tx as unknown as Database, input.session.id, input.session.version, {
      status: "ACCEPTED",
      ...(shouldPersistAcceptRound ? { currentRound: input.session.currentRound + 1 } : {}),
    });
    if (!updated) return null;

    if (shouldPersistAcceptRound && input.agreement && input.handoff && input.accepted.protocol) {
      await createAcceptedRoundRecord(tx as unknown as Database, {
        session: input.session,
        accepted: { ...input.accepted, protocol: input.accepted.protocol },
        agreement: input.agreement,
        handoff: input.handoff,
      });
    }

    return updated;
  });
}

async function createAcceptedRoundRecord(
  db: Database,
  input: {
    session: {
      id: string;
      currentRound: number;
    };
    accepted: {
      acceptedMessageId?: string;
      acceptedProposalId?: string;
      acceptedProposalHash?: string;
      hnp?: NonNullable<AcceptSessionBody>["hnp"];
      protocol: {
        messageId: string;
        idempotencyKey: string;
        sequence: number;
        senderRole: "BUYER" | "SELLER";
        senderAgentId: string;
        messageType: "ACCEPT";
        acceptedProposalHash?: string;
      };
    };
    agreement: HnpAgreementObject;
    handoff: {
      handoff: HnpTransactionHandoff;
      summary: HnpTransactionHandoffChainSummary | undefined;
    };
  },
): Promise<void> {
  await createRound(db, {
    sessionId: input.session.id,
    roundNo: input.session.currentRound + 1,
    senderRole: input.accepted.protocol.senderRole,
    messageType: "ACCEPT",
    priceminor: String(input.agreement.agreed_price?.units_minor ?? 0),
    decision: "ACCEPT",
    idempotencyKey: input.accepted.protocol.idempotencyKey,
    metadata: {
      protocol: {
        hnp: {
          messageId: input.accepted.protocol.messageId,
          idempotencyKey: input.accepted.protocol.idempotencyKey,
          sequence: input.accepted.protocol.sequence,
          senderAgentId: input.accepted.protocol.senderAgentId,
          messageType: input.accepted.protocol.messageType,
          acceptedProposalHash: input.accepted.protocol.acceptedProposalHash,
          acceptedMessageId: input.accepted.acceptedMessageId,
          acceptedProposalId: input.accepted.acceptedProposalId,
          type: "ACCEPT",
        },
      },
      agreement: input.agreement,
      transaction_handoff: input.handoff.handoff,
      transaction_handoff_summary: input.handoff.summary,
    },
  });
}

function getAcceptedEventPriceMinor(input: {
  agreement?: HnpAgreementObject;
  session: { lastOfferPriceMinor?: string | number | null };
}): number {
  return input.agreement?.agreed_price?.units_minor
    ?? numberFromUnknown(input.session.lastOfferPriceMinor ?? 0);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArrayOrEmpty(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function hnpIssueArrayOrEmpty(value: unknown): Array<{
  issue_id: string;
  value: string | number | boolean;
  unit?: string;
  kind?: "NEGOTIABLE" | "INFORMATIONAL";
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const issue = item as Record<string, unknown>;
    if (typeof issue.issue_id !== "string" || !issue.issue_id.trim()) return [];
    if (!["string", "number", "boolean"].includes(typeof issue.value)) return [];
    const normalized: {
      issue_id: string;
      value: string | number | boolean;
      unit?: string;
      kind?: "NEGOTIABLE" | "INFORMATIONAL";
    } = {
      issue_id: issue.issue_id,
      value: issue.value as string | number | boolean,
    };
    if (typeof issue.unit === "string") normalized.unit = issue.unit;
    if (issue.kind === "NEGOTIABLE" || issue.kind === "INFORMATIONAL") normalized.kind = issue.kind;
    return [normalized];
  });
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
