import { type Database, sql } from "@haggle/db";
import {
  compileNegotiationAgentSnapshot,
  computeHnpProposalHash,
  createHnpAgreementObject,
  createHnpTransactionHandoff,
  createHnpTransactionHandoffFromSignals,
  type HnpAgreementObject,
  type HnpTransactionHandoff,
  type HnpTransactionHandoffChainSummary,
  summarizeHnpTransactionHandoffChain,
  validateHnpTransactionHandoff,
} from "@haggle/engine-session";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import { getExecutor } from "../lib/executor-factory.js";
import { executeGroupOrchestration, executeGroupTerminal } from "../lib/group-executor.js";
import type { AuthUser } from "../middleware/auth.js";
import { requireAuth } from "../middleware/require-auth.js";
import { getNotificationUserInfo } from "../notification/get-user-info.js";
import type { NotificationBus } from "../notification/index.js";
import {
  type AttemptControlSnapshot,
  defaultAttemptControlPolicy,
  evaluateAttemptControl,
} from "../services/attempt-control.service.js";
import {
  getListingPlaybackSummaryByInternalId,
  getPublishedListingByPublicId,
} from "../services/draft.service.js";
import { validateHnpIngress } from "../services/hnp-ingress.service.js";
import { loadListingStrategyContext } from "../services/listing-strategy.service.js";
import { evaluateNegotiationStartReadiness } from "../services/negotiation-readiness.service.js";
import { createRound, getRoundsBySessionId } from "../services/negotiation-round.service.js";
import {
  createSession,
  getSessionById,
  getSessionsByUserId,
  setSessionPerspective,
  updateSessionState,
} from "../services/negotiation-session.service.js";
import { loadUserMemoryBrief } from "../services/user-memory-card.service.js";

// ── Zod Schemas ────────────────────────────────────────────

const createSessionSchema = z.object({
  listing_id: z.string().uuid(),
  strategy_id: z.string().min(1),
  role: z.enum(["BUYER", "SELLER"]),
  buyer_id: z.string().uuid(),
  seller_id: z.string().uuid(),
  counterparty_id: z.string().uuid(),
  negotiation_agent_snapshot: z.record(z.unknown()),
  group_id: z.string().uuid().optional(),
  intent_id: z.string().uuid().optional(),
  expires_at: z.string().datetime().optional(),
});

// Body for POST /negotiations/start — buyer-side entry from the web listing page.
const startSessionSchema = z.object({
  listing_public_id: z.string().min(1),
  negotiation_agent_preset_id: z.string().min(1),
  agent_weights: z.record(z.number()).optional(),
  agent_overrides: z.record(z.unknown()).optional(),
  negotiation_agent_builder_memory: z
    .object({
      budgetMax: z.number().positive().optional(),
      targetPrice: z.number().positive().optional(),
      mustHave: z.array(z.string()).optional(),
      avoid: z.array(z.string()).optional(),
      riskStyle: z.string().optional(),
      negotiationStyle: z.string().optional(),
      openingTactic: z.string().optional(),
      categoryInterest: z.string().optional(),
      questions: z.array(z.string()).optional(),
      source: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  deadline_hours: z
    .number()
    .positive()
    .max(24 * 14)
    .optional(),
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
    issues: z
      .array(
        z.object({
          issue_id: z.string().min(1),
          value: z.union([z.string(), z.number(), z.boolean()]),
          unit: z.string().optional(),
          kind: z.enum(["NEGOTIABLE", "INFORMATIONAL"]).optional(),
        }),
      )
      .default([]),
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
    accepted_issues: z
      .array(
        z.object({
          issue_id: z.string().min(1),
          value: z.union([z.string(), z.number(), z.boolean()]),
          unit: z.string().optional(),
          kind: z.enum(["NEGOTIABLE", "INFORMATIONAL"]).optional(),
        }),
      )
      .optional(),
  }),
  detached_signature: z.string().optional(),
});

const transactionSignalsSchema = z
  .object({
    payment_decision: z.enum(["AUTO_APPROVE", "HUMAN_APPROVAL_REQUIRED", "BLOCKED"]).optional(),
    payment_reasons: z.array(z.string().trim().min(1)).optional(),
    settlement_completed: z.boolean().optional(),
    dispute_evidence_packet_hashes: z.array(z.string().min(1)).optional(),
    trust_event_hashes: z.array(z.string().min(1)).optional(),
  })
  .optional();

const agentDelegationSchema = z.object({
  principal_user_id: z.string().min(1),
  agent_id: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  expires_at_ms: z.number().int().positive(),
  delegation_id: z.string().min(1).optional(),
});

const submitOfferSchema = z
  .object({
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
  })
  .superRefine((value, ctx) => {
    if (
      !value.hnp &&
      (value.price_minor === undefined || !value.sender_role || !value.idempotency_key)
    ) {
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

const acceptSessionSchema = z
  .object({
    accepted_message_id: z.string().min(1).optional(),
    accepted_proposal_id: z.string().min(1).optional(),
    hnp: hnpAcceptEnvelopeSchema.optional(),
    agent_delegation: agentDelegationSchema.optional(),
    transaction_signals: transactionSignalsSchema,
  })
  .optional();

// ── Route Registration ─────────────────────────────────────

export function registerNegotiationRoutes(
  app: FastifyInstance,
  db: Database,
  eventDispatcher: EventDispatcher,
  notificationBus: NotificationBus,
) {
  // POST /negotiations/sessions — 세션 생성
  app.post("/negotiations/sessions", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "INVALID_SESSION_REQUEST", issues: parsed.error.issues });
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
        negotiationAgentSnapshot: data.negotiation_agent_snapshot,
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

    const roundLimit =
      attemptControl?.max_rounds_per_session ?? defaultAttemptControlPolicy().maxRoundsPerSession;
    const negotiationAgentSnapshot = applyRoundLimitToStrategy(
      data.negotiation_agent_snapshot,
      roundLimit,
    );
    const session = await createSession(db, {
      listingId: data.listing_id,
      strategyId: data.strategy_id,
      role: data.role,
      buyerId: data.buyer_id,
      sellerId: data.seller_id,
      counterpartyId: data.counterparty_id,
      negotiationAgentSnapshot,
      groupId: data.group_id,
      intentId: data.intent_id,
      expiresAt: data.expires_at ? new Date(data.expires_at) : undefined,
    });

    return reply.code(201).send({ session, attempt_control: attemptControl });
  });

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
        (status as
          | "CREATED"
          | "ACTIVE"
          | "NEAR_DEAL"
          | "STALLED"
          | "ACCEPTED"
          | "REJECTED"
          | "EXPIRED"
          | "SUPERSEDED"
          | "WAITING") ?? undefined,
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
  app.get<{ Params: { id: string } }>("/negotiations/sessions/:id", async (request, reply) => {
    const session = await getSessionById(db, request.params.id);
    if (!session) {
      return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
    }
    if (request.user) {
      const access = validateSessionParticipant(request.user, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
      }
    }

    const [rounds, listing] = await Promise.all([
      getRoundsBySessionId(db, session.id),
      getListingPlaybackSummaryByInternalId(db, session.listingId),
    ]);

    // Surface only the buyer-agent preset id from negotiation_agent_snapshot; the
    // rest of the strategy stays private.
    const buyerNegotiationAgentPresetId = extractBuyerNegotiationAgentPresetId(
      session.negotiationAgentSnapshot,
    );

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
        buyer_negotiation_agent_preset_id: buyerNegotiationAgentPresetId,
        listing: listing
          ? {
              public_id: listing.publicId,
              title: listing.title,
              photo_url: listing.photoUrl,
              target_price: listing.targetPrice,
              category: listing.category,
              seller_agent_preset: listing.sellerAgentPreset,
            }
          : null,
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
        message: r.message,
        phase_at_round: r.phaseAtRound,
        tactic_used: r.tacticUsed,
        concession_rate: r.concessionRate,
        created_at: r.createdAt,
      })),
    });
  });

  // POST /negotiations/sessions/:id/offers — 오퍼 제출 (라운드 실행)
  app.post<{ Params: { id: string }; Querystring: { include_explainability?: string } }>(
    "/negotiations/sessions/:id/offers",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const parsed = submitOfferSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_OFFER_REQUEST", issues: parsed.error.issues });
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
        const result = await executor(
          db,
          {
            sessionId: request.params.id,
            offerPriceMinor: normalized.offerPriceMinor,
            messageText: data.message_text,
            senderRole: normalized.senderRole,
            idempotencyKey: normalized.idempotencyKey,
            protocol: normalized.protocol,
            roundData: data.round_data ?? {},
            nowMs,
          },
          eventDispatcher,
        );

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
        if (extended.reasoningUsed !== undefined)
          responseBody.reasoning_used = extended.reasoningUsed;

        // Explainability: only when staged pipeline + client opts in
        const includeExplainability = request.query.include_explainability === "true";
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

        // ── Notification: negotiation.session.concluded (NEAR_DEAL → buyer)
        if (
          !result.idempotent &&
          result.sessionStatus === "NEAR_DEAL" &&
          result.outgoingPrice != null
        ) {
          void (async () => {
            try {
              const listing = await db.query.listingsPublished.findFirst({
                where: (f, ops) => ops.eq(f.id, session.listingId),
              });
              if (listing && session.buyerId) {
                await notificationBus.publish({
                  type: "negotiation.session.concluded",
                  recipientUserId: session.buyerId,
                  payload: {
                    sessionId: session.id,
                    agreedPriceMinor: result.outgoingPrice,
                    currency: "USD",
                    listingTitle:
                      ((listing.snapshotJson as Record<string, unknown>)?.title as string) ??
                      "your listing",
                    listingId: session.listingId,
                  },
                });
              }
            } catch (err) {
              console.error("[notifications] session.concluded error:", err);
            }
          })();
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
          return reply
            .code(429)
            .send({ error: "ROUND_LIMIT_EXCEEDED", message: "Round limit exceeded" });
        }
        if (message.startsWith("CONCURRENT_MODIFICATION")) {
          return reply
            .code(409)
            .send({ error: "CONCURRENT_MODIFICATION", message: "Please retry" });
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
        return reply
          .code(400)
          .send({ error: "INVALID_ACCEPT_REQUEST", issues: parsed.error.issues });
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
        const idempotentAccept =
          session.status === "ACCEPTED" && accepted.protocol
            ? await findIdempotentAcceptedRound(db, session.id, accepted)
            : null;
        if (idempotentAccept) {
          return reply.send({
            updated: false,
            idempotent: true,
            session_status: "ACCEPTED",
            agreement: idempotentAccept.agreement,
            transaction_handoff: idempotentAccept.transactionHandoff,
            transaction_handoff_summary: idempotentAccept.transactionHandoffSummary,
          });
        }

        return reply
          .code(409)
          .send({ error: "INVALID_STATUS", message: `Cannot accept from ${session.status}` });
      }

      let acceptedRound: Awaited<ReturnType<typeof getRoundsBySessionId>>[number] | null = null;
      if (
        accepted.acceptedMessageId ||
        accepted.acceptedProposalId ||
        accepted.acceptedProposalHash
      ) {
        const rounds = await getRoundsBySessionId(db, session.id);
        acceptedRound =
          rounds.find((round) => roundMatchesAcceptedProposal(round, accepted)) ?? null;
        if (!acceptedRound) {
          return reply.code(409).send({
            error: "INVALID_PROPOSAL",
            message: "Accepted HNP proposal is not known for this session",
          });
        }
        const storedIssues = getStoredHnpIssues(acceptedRound);
        if (
          accepted.acceptedIssues &&
          storedIssues.length > 0 &&
          !hnpIssuesEqual(accepted.acceptedIssues, storedIssues)
        ) {
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

      // ── Notification: negotiation.offer.accepted (→ seller)
      void (async () => {
        try {
          const listing = await db.query.listingsPublished.findFirst({
            where: (f, ops) => ops.eq(f.id, session.listingId),
          });
          const buyerInfo = await getNotificationUserInfo(db, session.buyerId);
          const agreedPrice = getAcceptedEventPriceMinor({ agreement, session });
          if (listing && buyerInfo && session.sellerId) {
            await notificationBus.publish({
              type: "negotiation.offer.accepted",
              recipientUserId: session.sellerId,
              payload: {
                sessionId: session.id,
                agreedPriceMinor: agreedPrice,
                currency: "USD",
                buyerName: buyerInfo.displayName,
                listingTitle:
                  ((listing.snapshotJson as Record<string, unknown>)?.title as string) ??
                  "your listing",
                listingId: session.listingId,
              },
            });
          }
        } catch (err) {
          console.error("[notifications] offer.accepted error:", err);
        }
      })();

      // Dispatch agreed event
      await eventDispatcher
        .dispatch({
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
        })
        .catch((err) => {
          console.error("[negotiations] event dispatch error:", err);
        });

      // Group handling
      if (session.groupId) {
        await executeGroupTerminal(
          db,
          session.groupId,
          session.id,
          "ACCEPTED",
          eventDispatcher,
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
        return reply
          .code(409)
          .send({ error: "SESSION_TERMINAL", message: `Already ${session.status}` });
      }

      const updated = await updateSessionState(db, session.id, session.version, {
        status: "REJECTED",
      });

      if (!updated) {
        return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
      }

      // Dispatch terminal event
      await eventDispatcher
        .dispatch({
          domain: "negotiation",
          type: "negotiation.session.terminal",
          payload: {
            session_id: session.id,
            terminal_status: "REJECTED",
            intent_id: session.intentId,
          },
          idempotency_key: `neg_terminal_${session.id}_REJECTED`,
          timestamp: Date.now(),
        })
        .catch((err) => {
          console.error("[negotiations] event dispatch error:", err);
        });

      // Group handling
      if (session.groupId) {
        await executeGroupTerminal(
          db,
          session.groupId,
          session.id,
          "REJECTED",
          eventDispatcher,
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

  // POST /negotiations/start — 구매자가 리스팅 페이지에서 협상 시작
  //
  // 웹 입구. 인증된 구매자가 (publicId, 선택한 에이전트, 채팅 메모리)만 보내면
  // 서버가 판매자 전략 + 구매자 전략을 합성해 실제 세션을 생성하고 sessionId를
  // 반환한다. 클라이언트는 이 sessionId로 협상 페이지에 진입한다.
  app.post("/negotiations/start", async (request, reply) => {
    const parsed = startSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_START_REQUEST", issues: parsed.error.issues });
    }
    const body = parsed.data;
    const isGuest = !request.user;
    const buyer = request.user ?? { id: crypto.randomUUID() };

    const listing = await getPublishedListingByPublicId(db, body.listing_public_id);
    if (!listing) {
      return reply.code(404).send({ error: "LISTING_NOT_FOUND" });
    }
    if (!listing.sellerId) {
      return reply.code(409).send({ error: "LISTING_UNCLAIMED" });
    }
    if (!isGuest && listing.sellerId === buyer.id) {
      return reply.code(403).send({ error: "BUYER_IS_SELLER" });
    }

    const listingContext = await loadListingStrategyContext(db, listing.id);
    if (!listingContext?.askPriceMinor || !listingContext.floorPriceMinor) {
      return reply.code(409).send({ error: "LISTING_STRATEGY_INCOMPLETE" });
    }

    const askMinor = listingContext.askPriceMinor;
    const floorMinor = listingContext.floorPriceMinor;
    const listedAtMs = listingContext.listedAtMs;
    const nowMs = Date.now();
    const buyerDeadlineMs = nowMs + (body.deadline_hours ?? 24) * 60 * 60 * 1000;
    const effectiveDeadlineMs = listingContext.deadlineAtMs
      ? Math.max(nowMs + 1, Math.min(buyerDeadlineMs, listingContext.deadlineAtMs))
      : buyerDeadlineMs;
    const timeTotalMs = Math.max(1, effectiveDeadlineMs - listedAtMs);

    // Buyer target/reservation: prefer advisor memory budgetMax/targetPrice
    // (decimal dollars), else infer from listing price (10% discount target,
    // ask price as walk-away).
    const advisor = body.negotiation_agent_builder_memory;
    const budgetMaxMinor = toMinorOrUndefined(advisor?.budgetMax);
    const targetPriceMinor = toMinorOrUndefined(advisor?.targetPrice);
    const buyerReservation = budgetMaxMinor ?? askMinor;
    const buyerTarget = targetPriceMinor ?? Math.max(floorMinor, Math.round(askMinor * 0.9));
    if (buyerTarget >= buyerReservation) {
      return reply.code(400).send({ error: "INVALID_PRICE_RANGE" });
    }

    const styleDefaults = mapStyleToDefaults(advisor?.negotiationStyle);
    const sellerStrategy = listingContext.sellerStrategy;
    const sellerNegotiationAgentBuilderMemory = listingContext.sellerNegotiationAgentBuilderMemory;
    if (!sellerStrategy) {
      return reply.code(409).send({ error: "LISTING_STRATEGY_INCOMPLETE" });
    }

    const buyerRequestedStrategy = {
      style: styleDefaults.style,
      p_reservation: buyerReservation,
      p_target: buyerTarget,
      p_initial: buyerTarget,
      t_max: timeTotalMs,
      created_at_ms: listedAtMs,
      deadline_at_ms: effectiveDeadlineMs,
      alpha: styleDefaults.alpha,
      thresholds: styleDefaults.thresholds,
      concession: styleDefaults.concession,
      agent: {
        preset_id: body.negotiation_agent_preset_id,
        weights: body.agent_weights ?? null,
        overrides: body.agent_overrides ?? null,
      },
      ...(advisor ? { negotiation_agent_builder_memory: advisor } : {}),
    };

    // Auto-play loop: cap rounds and add max_rounds to both perspectives so
    // the executor's round-limit check fires symmetrically.
    const AUTO_PLAY_MAX_ROUNDS = 8;

    // Buyer-side compiled snapshot (mirror of the seller one).
    const buyerCompiled = compileNegotiationAgentSnapshot({
      role: "BUYER",
      userId: buyer.id,
      strategyId: `buyer_${body.negotiation_agent_preset_id}`,
      preset: undefined,
      agentStats: undefined,
      listing: {
        id: listing.id,
        category: null,
        condition: null,
        targetPriceMinor: buyerTarget,
        floorPriceMinor: buyerReservation,
        listedAtMs,
        deadlineAtMs: effectiveDeadlineMs,
      },
      nowMs,
    });

    const listingContextSnapshot = listingContext.listingContext;
    const sellerNegotiationAgentPresetId = listingContext.sellerNegotiationAgentPresetId;
    const sellerSnapshot: Record<string, unknown> = {
      ...sellerStrategy,
      max_rounds: AUTO_PLAY_MAX_ROUNDS,
      ...(sellerNegotiationAgentBuilderMemory
        ? { seller_negotiation_agent_builder_memory: sellerNegotiationAgentBuilderMemory }
        : {}),
      ...(listingContextSnapshot ? { listing_context: listingContextSnapshot } : {}),
      ...(sellerNegotiationAgentPresetId
        ? { negotiation_agent_preset_id: sellerNegotiationAgentPresetId }
        : {}),
      buyer_requested_strategy: buyerRequestedStrategy,
    };
    const buyerSnapshot: Record<string, unknown> = {
      ...buyerCompiled,
      max_rounds: AUTO_PLAY_MAX_ROUNDS,
      ...(advisor ? { buyer_negotiation_agent_builder_memory: advisor } : {}),
      ...(listingContextSnapshot ? { listing_context: listingContextSnapshot } : {}),
      negotiation_agent_preset_id: body.negotiation_agent_preset_id,
      ...(body.agent_weights ? { agent_weights: body.agent_weights } : {}),
      ...(body.agent_overrides ? { agent_overrides: body.agent_overrides } : {}),
      buyer_requested_strategy: buyerRequestedStrategy,
    };

    const strategyId = sellerStrategy.compiler.selected_playbook;
    const expiresAt = new Date(effectiveDeadlineMs);

    // Session starts in SELLER POV — round 1 is the buyer's opening offer.
    const session = await createSession(db, {
      listingId: listing.id,
      strategyId,
      role: "SELLER",
      buyerId: buyer.id,
      sellerId: listing.sellerId,
      counterpartyId: buyer.id,
      negotiationAgentSnapshot: sellerSnapshot,
      expiresAt,
    });

    // Drive both sides through the staged executor by swapping the session's
    // role + negotiation_agent_snapshot before each call. This is the simplest way to
    // get a back-and-forth LLM transcript persisted under one session id.
    const TERMINAL = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED", "NEAR_DEAL"]);
    const executor = getExecutor();
    let nextSenderRole: "BUYER" | "SELLER" = "BUYER";
    let nextOfferMinor = buyerTarget;
    let prevOfferMinor: number | null = null;
    let prevMessageText: string | null = null;
    for (let i = 0; i < AUTO_PLAY_MAX_ROUNDS; i++) {
      const responderRole: "BUYER" | "SELLER" = nextSenderRole === "BUYER" ? "SELLER" : "BUYER";
      const responderSnapshot = responderRole === "SELLER" ? sellerSnapshot : buyerSnapshot;

      try {
        await setSessionPerspective(db, session.id, responderRole, responderSnapshot);
      } catch (err) {
        console.error("[negotiations/start] perspective swap failed:", err);
        break;
      }

      // Preferred path: forward the prior round's persisted message so the
      // engine's understand() stage sees the same conversational signal the
      // counterparty actually saw. Fall back to a synthesized stub only for
      // round 1 (no prior message) or if persistence somehow returned empty.
      const offerDollars = (nextOfferMinor / 100).toFixed(2);
      const fallbackText =
        i === 0
          ? `Hi, I'm interested in this listing. I'd like to offer $${offerDollars}.`
          : prevOfferMinor != null && nextOfferMinor !== prevOfferMinor
            ? `Thanks for the response. I can do $${offerDollars}.`
            : `I'll stay at $${offerDollars} for now.`;
      const messageText =
        prevMessageText && prevMessageText.trim().length > 0 ? prevMessageText : fallbackText;

      let result: Awaited<ReturnType<typeof executor>>;
      try {
        result = await executor(db, {
          sessionId: session.id,
          offerPriceMinor: nextOfferMinor,
          senderRole: nextSenderRole,
          messageText,
          idempotencyKey: `auto-${session.id}-r${i + 1}`,
          roundData: {},
          nowMs: Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.startsWith("ROUND_LIMIT_EXCEEDED") ||
          msg.startsWith("SESSION_TERMINAL") ||
          msg.startsWith("SESSION_EXPIRED") ||
          msg.startsWith("SESSION_MAX_ROUNDS_EXCEEDED")
        ) {
          break;
        }
        console.error("[negotiations/start] auto-play executor error:", err);
        break;
      }

      if (TERMINAL.has(result.sessionStatus)) break;
      // Belt-and-suspenders: REJECT decisions should never roll forward as a
      // synthetic counter even if status mapping somehow leaves the session
      // ACTIVE. Stop the loop and let the UI render the final rejection.
      if (result.decision === "REJECT") break;
      // Guard against the (rare) case where outgoingPrice came back as 0
      // (e.g. REJECT without termination). Avoid offering $0 as a counter.
      if (!result.outgoingPrice || result.outgoingPrice <= 0) break;

      nextSenderRole = responderRole;
      prevOfferMinor = nextOfferMinor;
      // Buyer's counter must never go below their initial offer — clamp to [buyerTarget, ∞).
      nextOfferMinor =
        responderRole === "BUYER"
          ? Math.max(buyerTarget, result.outgoingPrice)
          : result.outgoingPrice;
      prevMessageText = result.message ?? null;
    }

    const finalSession = (await getSessionById(db, session.id)) ?? session;
    return reply.code(201).send({
      session_id: session.id,
      status: finalSession.status,
      ...(isGuest ? { guest_buyer_id: buyer.id } : {}),
    });
  });

  // POST /negotiations/sessions/expire-stale — cron 벌크 만료
  // Vercel Cron 또는 외부 scheduler에서 호출
  app.post("/negotiations/sessions/expire-stale", async (request, reply) => {
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
  });
}

function isAuthorizedSessionCreator(actorId: string, data: CreateSessionBody): boolean {
  return data.role === "BUYER" ? data.buyer_id === actorId : data.seller_id === actorId;
}

// Pull the buyer-side preset id out of negotiation_agent_snapshot. Sessions created by
// POST /negotiations/start nest it under buyer_requested_strategy.agent.preset_id;
// older code paths may store it at negotiation_agent_snapshot.agent.preset_id directly.
function extractBuyerNegotiationAgentPresetId(
  snapshot: Record<string, unknown> | null | undefined,
): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const buyerStrategy = (snapshot as Record<string, unknown>).buyer_requested_strategy as
    | Record<string, unknown>
    | undefined;
  const buyerAgent = buyerStrategy?.agent as Record<string, unknown> | undefined;
  if (typeof buyerAgent?.preset_id === "string") return buyerAgent.preset_id;
  const rootAgent = (snapshot as Record<string, unknown>).agent as
    | Record<string, unknown>
    | undefined;
  if (typeof rootAgent?.preset_id === "string") return rootAgent.preset_id;
  return null;
}

function toMinorOrUndefined(value: number | undefined | null): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

// Map a buyer-side negotiationStyle keyword to default alpha/threshold/concession
// numbers. The buyer's NegotiationAgentBuilderMemory only carries a coarse label ("defensive" |
// "balanced" | "aggressive"); the engine still needs concrete parameters.
function mapStyleToDefaults(style: string | undefined): {
  style: string;
  alpha: { price: number; time: number; reputation: number; satisfaction: number };
  thresholds: { accept: number; counter: number; reject: number; near_deal: number };
  concession: { beta: number; k: number };
} {
  switch (style) {
    case "aggressive":
      return {
        style: "aggressive",
        alpha: { price: 0.55, time: 0.15, reputation: 0.15, satisfaction: 0.15 },
        thresholds: { accept: 0.82, counter: 0.5, reject: 0.25, near_deal: 0.75 },
        concession: { beta: 0.35, k: 0.8 },
      };
    case "defensive":
      return {
        style: "patient",
        alpha: { price: 0.4, time: 0.15, reputation: 0.3, satisfaction: 0.15 },
        thresholds: { accept: 0.7, counter: 0.4, reject: 0.18, near_deal: 0.65 },
        concession: { beta: 0.5, k: 1.0 },
      };
    default:
      return {
        style: "balanced",
        alpha: { price: 0.4, time: 0.25, reputation: 0.2, satisfaction: 0.15 },
        thresholds: { accept: 0.78, counter: 0.45, reject: 0.2, near_deal: 0.72 },
        concession: { beta: 0.6, k: 1.2 },
      };
  }
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
):
  | { ok: true }
  | {
      ok: false;
      status: 403;
      error:
        | "SESSION_ACTOR_MISMATCH"
        | "HNP_SENDER_AGENT_MISMATCH"
        | "HNP_AGENT_DELEGATION_INVALID";
    } {
  if (actor.role === "admin") return { ok: true };
  const principalId = input.senderRole === "BUYER" ? session.buyerId : session.sellerId;
  if (actor.id !== principalId) {
    return { ok: false, status: 403, error: "SESSION_ACTOR_MISMATCH" };
  }
  if (!input.senderAgentId || input.senderAgentId === actor.id) return { ok: true };

  if (
    isValidAgentDelegation(input.agentDelegation, {
      principalUserId: actor.id,
      agentId: input.senderAgentId,
      action: input.action ?? "offer",
      nowMs: input.nowMs ?? Date.now(),
    })
  ) {
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
  return (
    delegation.scopes.includes("hnp:negotiate") ||
    delegation.scopes.includes(`hnp:${expected.action}`)
  );
}

function applyRoundLimitToStrategy(
  negotiationAgentSnapshot: Record<string, unknown>,
  maxRoundsPerSession: number,
): Record<string, unknown> {
  const current =
    typeof negotiationAgentSnapshot.max_rounds === "number"
      ? negotiationAgentSnapshot.max_rounds
      : Number(negotiationAgentSnapshot.max_rounds);
  const capped =
    Number.isFinite(current) && current > 0
      ? Math.min(current, maxRoundsPerSession)
      : maxRoundsPerSession;
  return { ...negotiationAgentSnapshot, max_rounds: capped };
}

function normalizeSubmitOffer(
  body: SubmitOfferBody,
  sessionId: string,
  nowMs: number,
):
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
  | { ok: false; status: number; body: Record<string, unknown> } {
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
):
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
  | { ok: false; status: number; body: Record<string, unknown> } {
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
  accepted: {
    acceptedMessageId?: string;
    acceptedProposalId?: string;
    acceptedProposalHash?: string;
  },
): boolean {
  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ??
    {}) as Record<string, unknown>;
  const messageId = typeof hnp.messageId === "string" ? hnp.messageId : undefined;
  const proposalId = typeof hnp.proposalId === "string" ? hnp.proposalId : undefined;
  const proposalHash = typeof hnp.proposalHash === "string" ? hnp.proposalHash : undefined;

  return Boolean(
    (!accepted.acceptedMessageId ||
      accepted.acceptedMessageId === messageId ||
      accepted.acceptedMessageId === round.id) &&
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
  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ??
    {}) as Record<string, unknown>;
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

function normalizeHnpIssues(
  issues: Array<{
    issue_id: string;
    value: string | number | boolean;
    unit?: string;
    kind?: "NEGOTIABLE" | "INFORMATIONAL";
  }>,
): Array<{
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
  const hnp = ((input.acceptedRound?.metadata?.protocol as Record<string, unknown> | undefined)
    ?.hnp ?? {}) as Record<string, unknown>;
  const acceptedMessageId =
    input.accepted.acceptedMessageId ??
    stringOrUndefined(hnp.messageId) ??
    input.acceptedRound?.id ??
    "";
  const acceptedProposalId =
    input.accepted.acceptedProposalId ?? stringOrUndefined(hnp.proposalId) ?? "";
  const acceptedProposalHash =
    input.accepted.acceptedProposalHash ?? stringOrUndefined(hnp.proposalHash);
  const acceptedIssues = input.accepted.acceptedIssues ?? hnpIssueArrayOrEmpty(hnp.issues);
  const currency = stringOrUndefined(hnp.currency) ?? "USD";
  const settlementPreconditions = stringArrayOrEmpty(hnp.settlementPreconditions);
  const agreedPriceMinor = numberFromUnknown(
    input.acceptedRound?.counterPriceMinor ??
      input.acceptedRound?.priceminor ??
      input.acceptedRound?.priceMinor ??
      input.session.lastOfferPriceMinor ??
      0,
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
    summary: validation.ok
      ? summarizeHnpTransactionHandoffChain([handoff], { verifyHash: true })
      : undefined,
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
      ? T extends { ok: true }
        ? T
        : never
      : never;
    agreement?: HnpAgreementObject;
    handoff?: {
      handoff: HnpTransactionHandoff;
      summary: HnpTransactionHandoffChainSummary | undefined;
    };
  },
) {
  return db.transaction(async (tx) => {
    const shouldPersistAcceptRound = Boolean(
      input.agreement && input.handoff && input.accepted.protocol,
    );
    const updated = await updateSessionState(
      tx as unknown as Database,
      input.session.id,
      input.session.version,
      {
        status: "ACCEPTED",
        ...(shouldPersistAcceptRound ? { currentRound: input.session.currentRound + 1 } : {}),
      },
    );
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

type NormalizedAcceptRequest =
  ReturnType<typeof normalizeAcceptRequest> extends infer T
    ? T extends { ok: true }
      ? T
      : never
    : never;

async function findIdempotentAcceptedRound(
  db: Database,
  sessionId: string,
  accepted: NormalizedAcceptRequest,
): Promise<{
  agreement: unknown;
  transactionHandoff: unknown;
  transactionHandoffSummary: unknown;
} | null> {
  if (!accepted.protocol) return null;

  const rounds = await getRoundsBySessionId(db, sessionId);
  const round = rounds.find((candidate) =>
    roundMatchesAcceptedRetry(candidate, {
      ...accepted,
      protocol: accepted.protocol!,
    }),
  );
  if (!round) return null;

  const metadata = round.metadata as Record<string, unknown> | null;
  const agreement = metadata?.agreement;
  if (!agreement || typeof agreement !== "object") return null;

  return {
    agreement,
    transactionHandoff: metadata?.transaction_handoff,
    transactionHandoffSummary: metadata?.transaction_handoff_summary,
  };
}

function roundMatchesAcceptedRetry(
  round: Awaited<ReturnType<typeof getRoundsBySessionId>>[number],
  accepted: NormalizedAcceptRequest & {
    protocol: NonNullable<NormalizedAcceptRequest["protocol"]>;
  },
): boolean {
  if (round.idempotencyKey !== accepted.protocol.idempotencyKey) return false;
  if (round.messageType !== "ACCEPT") return false;

  const hnp = ((round.metadata?.protocol as Record<string, unknown> | undefined)?.hnp ??
    {}) as Record<string, unknown>;
  const type =
    typeof hnp.type === "string"
      ? hnp.type
      : typeof hnp.messageType === "string"
        ? hnp.messageType
        : undefined;

  if (type !== "ACCEPT") return false;
  if (hnp.messageId !== accepted.protocol.messageId) return false;
  if (hnp.idempotencyKey !== accepted.protocol.idempotencyKey) return false;
  if (hnp.sequence !== accepted.protocol.sequence) return false;
  if (hnp.senderAgentId !== accepted.protocol.senderAgentId) return false;
  if (accepted.acceptedMessageId && hnp.acceptedMessageId !== accepted.acceptedMessageId)
    return false;
  if (accepted.acceptedProposalId && hnp.acceptedProposalId !== accepted.acceptedProposalId)
    return false;
  if (accepted.acceptedProposalHash && hnp.acceptedProposalHash !== accepted.acceptedProposalHash)
    return false;

  return true;
}

function getAcceptedEventPriceMinor(input: {
  agreement?: HnpAgreementObject;
  session: { lastOfferPriceMinor?: string | number | null };
}): number {
  return (
    input.agreement?.agreed_price?.units_minor ??
    numberFromUnknown(input.session.lastOfferPriceMinor ?? 0)
  );
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
