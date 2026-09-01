import { type Database, sql } from "@haggle/db";
import {
  buyerChoiceOptionsForCheck,
  type CategoryCriterion,
  unresolvedSellerRequirements,
} from "@haggle/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  applyHnpAccept,
  getAcceptedEventPriceMinor,
  normalizeAcceptRequest,
} from "../hnp/accept-session.js";
import { hnpAcceptEnvelopeSchema, hnpOfferEnvelopeSchema } from "../hnp/envelope-schema.js";
import { buildHostHnpOfferEnvelope, wrapPriceOnlyAsHostEnvelope } from "../hnp/host-envelope.js";
import { normalizeSubmitOffer } from "../hnp/normalize-offer.js";
import { submitHnpOffer } from "../hnp/submit-offer.js";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import { getExecutor } from "../lib/executor-factory.js";
import { executeGroupOrchestration, executeGroupTerminal } from "../lib/group-executor.js";
import { negotiationChatUrl } from "../lib/public-urls.js";
import { validateSessionParticipant, validateSessionWriteAccess } from "../lib/session-access.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  applyBuyerPauseAnswer,
  buyerCriteriaRequiredReject,
  isSellerCriteriaPauseReasoning,
  readSellerCriteriaFromSnapshot,
  SELLER_CRITERIA_PAUSE_MARKER,
  unresolvedBuyerPauseAsks,
} from "../negotiation/phase/seller-criteria-pause.js";
import { getNotificationUserInfo } from "../notification/get-user-info.js";
import type { NotificationBus } from "../notification/index.js";
import {
  type AttemptControlSnapshot,
  defaultAttemptControlPolicy,
  evaluateAttemptControl,
} from "../services/attempt-control.service.js";
import { getListingPlaybackSummaryByInternalId } from "../services/draft.service.js";
import { validateHnpIngress } from "../services/hnp-ingress.service.js";
import {
  assertListingAcceptsNewSession,
  LISTING_CLAIM_HTTP,
  ListingClaimError,
} from "../services/listing-claim.service.js";
import {
  attachNegotiationAutoPlayContext,
  getNegotiationAutoPlayContext,
  isNegotiationAutoPlayTerminal,
  planNegotiationAutoPlayRound,
  validateNegotiationAutoPlayToken,
} from "../services/negotiation-auto-play.service.js";
import { evaluateNegotiationStartReadiness } from "../services/negotiation-readiness.service.js";
import {
  getRoundsBySessionId,
  recordPauseAnswersOnRound,
} from "../services/negotiation-round.service.js";
import {
  createSession,
  getSessionById,
  getSessionsByUserId,
  setSessionPerspective,
  updateSessionState,
} from "../services/negotiation-session.service.js";
import {
  startBuyerNegotiation,
  startBuyerNegotiationSchema,
} from "../services/start-buyer-negotiation.service.js";
import { loadUserMemoryBrief } from "../services/user-memory-card.service.js";
import { projectLastUtility, projectRoundEngineFields } from "./session-projection.js";

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

const startSessionSchema = startBuyerNegotiationSchema;

const runNextAutoPlayRoundSchema = z.object({
  run_token: z.string().min(32).optional(),
});

// Phase G Flow 3 resume: the buyer's answer to a mid-negotiation seller-criteria pause.
// Either per-check `stances` or a single `answer` applied to every unresolved check.
const pauseAnswerSchema = z.object({
  run_token: z.string().min(32).optional(),
  answer: z.string().max(2000).optional(),
  stances: z
    .array(z.object({ checkId: z.string().min(1), stance: z.string().max(2000) }))
    .optional(),
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
    hnp: hnpOfferEnvelopeSchema.optional(),
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
    const negotiationAgentSnapshot = stripClientModelEntitlement(
      applyRoundLimitToStrategy(data.negotiation_agent_snapshot, roundLimit),
    );
    try {
      await assertListingAcceptsNewSession(db, data.listing_id);
    } catch (error) {
      if (error instanceof ListingClaimError) {
        const mapped = LISTING_CLAIM_HTTP[error.code];
        return reply.code(mapped.status).send({
          error: mapped.error,
          message: error.code,
        });
      }
      throw error;
    }
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
    let viewer: "guest" | "participant" = "guest";
    if (request.user) {
      const access = validateSessionParticipant(request.user, session);
      if (!access.ok) {
        return reply.code(access.status).send({ error: access.error });
      }
      viewer = "participant";
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

    const latestRound = rounds.at(-1);
    const latestMeta = (latestRound?.metadata as Record<string, unknown> | null) ?? null;
    const heldForCriteriaPause = isSellerCriteriaPauseReasoning(latestMeta?.reasoning);
    const pauseSnapshot =
      getNegotiationAutoPlayContext(session.negotiationAgentSnapshot)?.buyerSnapshot ??
      session.negotiationAgentSnapshot;
    const pendingPauseAsks =
      heldForCriteriaPause && !latestMeta?.buyer_pause_answers
        ? unresolvedBuyerPauseAsks(pauseSnapshot)
        : [];

    return reply.send({
      session: {
        id: session.id,
        group_id: session.groupId,
        listing_id: session.listingId,
        role: session.role,
        status: session.status,
        current_round: session.currentRound,
        last_offer_price_minor: session.lastOfferPriceMinor,
        last_utility: projectLastUtility(session.lastUtility, viewer),
        version: session.version,
        expires_at: session.expiresAt,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
        buyer_negotiation_agent_preset_id: buyerNegotiationAgentPresetId,
        driver: session.driver === "mcp" ? "mcp" : "web",
        chat_url: negotiationChatUrl(session.id),
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
      paused_for_buyer: pendingPauseAsks.length > 0,
      pause_questions: pendingPauseAsks.map((c) => c.ask),
      pause_check_ids: pendingPauseAsks.map((c) => c.checkId),
      pause_checks: pendingPauseAsks.map((c) => ({
        checkId: c.checkId,
        ask: c.ask,
        options: buyerChoiceOptionsForCheck(c.checkId).map((o) => ({
          label: o.label,
          stance: o.stance,
        })),
      })),
      rounds: rounds.map((r) => {
        const meta = (r.metadata as Record<string, unknown> | null) ?? null;
        const held = isSellerCriteriaPauseReasoning(meta?.reasoning);
        const storedQuestions = Array.isArray(meta?.pause_questions)
          ? meta.pause_questions.filter(
              (q): q is string => typeof q === "string" && Boolean(q.trim()),
            )
          : [];
        return {
          id: r.id,
          round_no: r.roundNo,
          sender_role: r.senderRole,
          message_type: r.messageType,
          price_minor: r.priceminor,
          counter_price_minor: r.counterPriceMinor,
          decision: r.decision,
          message: r.message,
          phase_at_round: r.phaseAtRound,
          created_at: r.createdAt,
          held_for_criteria_pause: held,
          pause_questions: storedQuestions.length > 0 ? storedQuestions : null,
          // The buyer's reply to a mid-negotiation pause, so the transcript can show it
          // under the question that asked for it.
          pause_answers: meta?.buyer_pause_answers ?? null,
          ...projectRoundEngineFields(viewer, {
            utility: r.utility,
            tactic_used: r.tacticUsed,
            concession_rate: r.concessionRate,
          }),
        };
      }),
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

      let offer = normalized;
      let hostMinted = false;
      if (!offer.hnp) {
        const envelope = wrapPriceOnlyAsHostEnvelope({
          sessionId: session.id,
          currentRound: session.currentRound,
          senderRole: offer.senderRole,
          priceMinor: offer.offerPriceMinor,
          idempotencyKey: offer.idempotencyKey,
          nowMs,
        });
        const wrapped = normalizeSubmitOffer({ hnp: envelope }, session.id, nowMs);
        if (!wrapped.ok) {
          return reply.code(wrapped.status).send(wrapped.body);
        }
        offer = wrapped;
        hostMinted = true;
      }

      const hnpIngress = await validateHnpIngress(db, request.params.id, {
        envelope: offer.hnp,
        protocol: offer.protocol,
        requireSignature: hostMinted ? false : undefined,
      });
      if (!hnpIngress.ok) {
        return reply.code(hnpIngress.status).send(hnpIngress.body);
      }

      try {
        const executor = getExecutor();
        const result = await executor(
          db,
          {
            sessionId: request.params.id,
            offerPriceMinor: offer.offerPriceMinor,
            messageText: data.message_text,
            senderRole: offer.senderRole,
            idempotencyKey: offer.idempotencyKey,
            protocol: offer.protocol,
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
          responseBody.utility = result.utility;
        }
        if (offer.hnp) {
          responseBody.hnp = {
            spec_version: offer.hnp.spec_version,
            capability: offer.hnp.capability,
            message_id: offer.hnp.message_id,
            sequence: offer.hnp.sequence,
            proposal_id: offer.hnp.payload.proposal_id,
            proposal_hash: offer.protocol?.proposalHash,
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
      }

      const applied = await applyHnpAccept(db, session, accepted);
      if (!applied.ok) {
        return reply.code(applied.status).send(applied.body);
      }

      if (applied.idempotent || !applied.updated) {
        return reply.send({
          updated: false,
          idempotent: true,
          session_status: "ACCEPTED",
          agreement: applied.agreement,
          transaction_handoff: applied.transaction_handoff,
          transaction_handoff_summary: applied.transaction_handoff_summary,
        });
      }

      // ── Notification: negotiation.offer.accepted (→ seller)
      void (async () => {
        try {
          const listing = await db.query.listingsPublished.findFirst({
            where: (f, ops) => ops.eq(f.id, session.listingId),
          });
          const buyerInfo = await getNotificationUserInfo(db, session.buyerId);
          const agreedPrice = getAcceptedEventPriceMinor({
            agreement: applied.agreement,
            session,
          });
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
            agreed_price_minor: getAcceptedEventPriceMinor({
              agreement: applied.agreement,
              session,
            }),
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
        agreement: applied.agreement,
        transaction_handoff: applied.transaction_handoff,
        transaction_handoff_summary: applied.transaction_handoff_summary,
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
    const isGuest = !request.user;
    const buyerId = request.user?.id ?? crypto.randomUUID();
    const started = await startBuyerNegotiation(db, {
      body: parsed.data,
      buyerId,
      isGuest,
      driver: "web",
      allowGuest: true,
      chatUrl: undefined,
    });
    if (!started.ok) {
      if (started.body.retry_after) {
        reply.header("retry-after", String(started.body.retry_after));
      }
      return reply.code(started.status).send(started.body);
    }
    return reply.code(202).send({
      session_id: started.body.session_id,
      status: started.body.status,
      run_token: started.body.run_token,
      ...(started.body.guest_buyer_id ? { guest_buyer_id: started.body.guest_buyer_id } : {}),
      ...(started.body.attempt_control ? { attempt_control: started.body.attempt_control } : {}),
      ...(started.body.buyer_criteria_required
        ? {
            buyer_criteria_required: true,
            required_check_ids: started.body.required_check_ids,
          }
        : {}),
    });
  });

  // POST /negotiations/sessions/:id/auto-play/next — execute exactly one round
  //
  // The browser calls this endpoint sequentially. This keeps every LLM round
  // within a bounded request and lets the UI display committed rounds as they
  // arrive instead of waiting for an in-process background loop.
  app.post<{ Params: { id: string } }>(
    "/negotiations/sessions/:id/auto-play/next",
    async (request, reply) => {
      const parsed = runNextAutoPlayRoundSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "INVALID_AUTO_PLAY_REQUEST", issues: parsed.error.issues });
      }

      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }
      if (session.driver === "mcp") {
        return reply.code(409).send({ error: "DRIVER_MISMATCH" });
      }
      const context = getNegotiationAutoPlayContext(session.negotiationAgentSnapshot);
      if (!context) {
        return reply.code(409).send({ error: "AUTO_PLAY_CONTEXT_MISSING" });
      }

      if (request.user) {
        const access = validateSessionParticipant(request.user, session);
        if (!access.ok) {
          return reply.code(access.status).send({ error: access.error });
        }
      } else if (!validateNegotiationAutoPlayToken(context, parsed.data.run_token)) {
        return reply.code(401).send({ error: "AUTO_PLAY_TOKEN_INVALID" });
      }

      if (isNegotiationAutoPlayTerminal(session.status)) {
        return reply.send({
          complete: true,
          session_status: session.status,
          current_round: session.currentRound,
        });
      }

      // Expiry must be committed outside the round executor transaction. Throwing
      // SESSION_EXPIRED inside that transaction rolls its status update back, leaving
      // a CREATED session that clients can retry forever without producing a round.
      if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
        const expired = await updateSessionState(db, session.id, session.version, {
          status: "EXPIRED",
        });
        if (!expired) {
          return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
        }
        return reply.send({
          complete: true,
          session_status: expired.status,
          current_round: expired.currentRound,
        });
      }

      if (session.currentRound >= context.maxRounds) {
        const stalled = await updateSessionState(db, session.id, session.version, {
          status: "STALLED",
        });
        if (!stalled) {
          return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
        }
        return reply.send({
          complete: true,
          session_status: stalled.status,
          current_round: stalled.currentRound,
        });
      }

      const criteriaReject = buyerCriteriaRequiredReject(context.buyerSnapshot);
      if (criteriaReject) {
        return reply.code(409).send(criteriaReject);
      }

      const rounds = await getRoundsBySessionId(db, session.id);

      // Phase G Flow 3 resume gate: if the last round is a seller-criteria PAUSE and the
      // buyer still has not addressed the seller's required criteria, BLOCK the auto-play
      // loop here and surface the question(s). The negotiation resumes only once the
      // buyer answers via POST /pause/answer (which fills the stances so the unresolved
      // set empties). Empty for pre-Phase-G sessions → never blocks.
      const latestRound = rounds.at(-1);
      const latestReasoning = (latestRound?.metadata as Record<string, unknown> | null)?.reasoning;
      if (
        typeof latestReasoning === "string" &&
        latestReasoning.includes(SELLER_CRITERIA_PAUSE_MARKER)
      ) {
        const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(
          context.buyerSnapshot,
        );
        // Keep only requirements that yield a real buyer-facing question, so the
        // surfaced questions and check ids stay aligned and never include `undefined`.
        const unresolved = unresolvedSellerRequirements(sellerRequired, buyerCriteria)
          .map((c) => ({ checkId: c.checkId, ask: (c.buyerAskKo ?? c.questionKo)?.trim() }))
          .filter((c): c is { checkId: string; ask: string } => Boolean(c.ask));
        if (unresolved.length > 0) {
          return reply.send({
            paused_for_buyer: true,
            // Each blocked check with the canonical answers Quick Setup would have
            // offered. Without them the buyer types free text at a yes/no question and
            // the stance recorded never lines up with the one a tap would have produced.
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
          });
        }
      }

      const plan = planNegotiationAutoPlayRound(session, rounds, context);
      if (!plan) {
        return reply.code(409).send({ error: "AUTO_PLAY_ROUND_UNAVAILABLE" });
      }

      const claimed = await setSessionPerspective(
        db,
        session.id,
        plan.responderRole,
        attachNegotiationAutoPlayContext(plan.responderSnapshot, context),
        session.version,
      );
      if (!claimed) {
        return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
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
          eventDispatcher,
          requireSignature: false,
        });
        if (!submitted.ok) {
          return reply.code(submitted.status).send(submitted.body);
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
        return reply.code(result.idempotent ? 200 : 201).send({
          complete: isNegotiationAutoPlayTerminal(finalStatus),
          session_status: finalStatus,
          current_round: finalSession?.currentRound ?? result.roundNo,
          round_id: result.roundId,
          round_no: result.roundNo,
          decision: result.decision,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.startsWith("SESSION_NOT_FOUND")) {
          return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
        }
        // The deadline can pass while an LLM round is running. The executor reports
        // that race after rolling back its transaction, so persist the terminal state
        // here and answer successfully instead of feeding the browser another retry.
        if (message.startsWith("SESSION_EXPIRED")) {
          const latest = await getSessionById(db, session.id);
          if (!latest) {
            return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
          }
          const expired = isNegotiationAutoPlayTerminal(latest.status)
            ? latest
            : await updateSessionState(db, latest.id, latest.version, { status: "EXPIRED" });
          if (!expired) {
            return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
          }
          return reply.send({
            complete: true,
            session_status: expired.status,
            current_round: expired.currentRound,
          });
        }
        if (
          message.startsWith("SESSION_TERMINAL") ||
          message.startsWith("SESSION_MAX_ROUNDS_EXCEEDED") ||
          message.startsWith("ROUND_LIMIT_EXCEEDED")
        ) {
          const latest = await getSessionById(db, session.id);
          return reply.code(409).send({
            error: "SESSION_TERMINAL",
            session_status: latest?.status,
            current_round: latest?.currentRound,
          });
        }
        if (message.startsWith("CONCURRENT_MODIFICATION")) {
          return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
        }
        request.log.error({ err, sessionId: session.id }, "auto-play round failed");
        return reply.code(502).send({ error: "AUTO_PLAY_ROUND_FAILED" });
      }
    },
  );

  // POST /negotiations/sessions/:id/pause/answer — Phase G Flow 3 resume
  //
  // When the round loop paused to ask the buyer about a seller-required criterion the
  // buyer never addressed, this records the buyer's answer (a stance) into the buyer's
  // criteria on the auto-play snapshot. The next auto-play/next then no longer blocks
  // (the unresolved set is empty) and the negotiation resumes with the answer as a factor.
  app.post<{ Params: { id: string } }>(
    "/negotiations/sessions/:id/pause/answer",
    async (request, reply) => {
      const parsed = pauseAnswerSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: "INVALID_PAUSE_ANSWER", issues: parsed.error.issues });
      }

      const session = await getSessionById(db, request.params.id);
      if (!session) {
        return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      }
      const context = getNegotiationAutoPlayContext(session.negotiationAgentSnapshot);
      if (!context) {
        return reply.code(409).send({ error: "AUTO_PLAY_CONTEXT_MISSING" });
      }

      if (request.user) {
        const access = validateSessionParticipant(request.user, session);
        if (!access.ok) {
          return reply.code(access.status).send({ error: access.error });
        }
        // Only the BUYER may answer their own agent's criteria. This endpoint writes
        // buyer-side data, so — unlike auto-play/next, which only advances rounds — the
        // seller (or anyone else) must not mutate the buyer's stance (buyer AI ≠ seller
        // AI fairness). The run-token path below only ever reaches the buyer/guest.
        if (request.user.id !== session.buyerId) {
          return reply.code(403).send({ error: "PAUSE_ANSWER_BUYER_ONLY" });
        }
      } else if (!validateNegotiationAutoPlayToken(context, parsed.data.run_token)) {
        return reply.code(401).send({ error: "AUTO_PLAY_TOKEN_INVALID" });
      }

      const startReject = buyerCriteriaRequiredReject(context.buyerSnapshot);
      if (startReject) {
        return reply.code(409).send(startReject);
      }

      const { sellerRequired, buyerCriteria } = readSellerCriteriaFromSnapshot(
        context.buyerSnapshot,
      );
      const unresolved = unresolvedSellerRequirements(sellerRequired, buyerCriteria);
      if (unresolved.length === 0) {
        return reply.send({ ok: true, resolved: true, remaining_check_ids: [] });
      }

      // Explicit per-check stances win; otherwise a single `answer` applies to all.
      const stanceByCheckId = new Map<string, string>();
      for (const s of parsed.data.stances ?? []) {
        const trimmed = s.stance.trim();
        if (trimmed) stanceByCheckId.set(s.checkId, trimmed);
      }
      const { buyerSnapshot: newBuyerSnapshot, applied } = applyBuyerPauseAnswer(
        context.buyerSnapshot,
        unresolved,
        stanceByCheckId,
        parsed.data.answer,
      );
      if (applied === 0) {
        return reply
          .code(400)
          .send({ error: "PAUSE_ANSWER_EMPTY", pause_check_ids: unresolved.map((c) => c.checkId) });
      }
      const criteria = (
        newBuyerSnapshot.buyer_negotiation_agent_builder_memory as {
          categoryCriteria: CategoryCriterion[];
        }
      ).categoryCriteria;
      const newContext = { ...context, buyerSnapshot: newBuyerSnapshot };
      const persisted = await setSessionPerspective(
        db,
        session.id,
        session.role,
        attachNegotiationAutoPlayContext(newBuyerSnapshot, newContext),
        session.version,
      );
      if (!persisted) {
        return reply.code(409).send({ error: "CONCURRENT_MODIFICATION" });
      }

      // Leave the answer on the round that asked for it, so the transcript shows the
      // reply under the question — both now and after a reload. Best-effort: the stance
      // is already saved, and failing to decorate the transcript must not fail the
      // resume the buyer is waiting on.
      try {
        const answeredRounds = await getRoundsBySessionId(db, session.id);
        const askingRound = [...answeredRounds]
          .reverse()
          .find((r) =>
            String((r.metadata as Record<string, unknown> | null)?.reasoning ?? "").includes(
              SELLER_CRITERIA_PAUSE_MARKER,
            ),
          );
        if (askingRound) {
          await recordPauseAnswersOnRound(
            db,
            askingRound.id,
            unresolved.flatMap((c) => {
              const stance = stanceByCheckId.get(c.checkId) ?? parsed.data.answer?.trim();
              if (!stance) return [];
              const ask = (c.buyerAskKo ?? c.questionKo)?.trim() ?? c.checkId;
              const label = buyerChoiceOptionsForCheck(c.checkId).find(
                (o) => o.stance === stance,
              )?.label;
              return [{ checkId: c.checkId, ask, stance, ...(label ? { label } : {}) }];
            }),
          );
        }
      } catch (err) {
        request.log.warn({ err }, "could not attach pause answers to the round");
      }

      const remaining = unresolvedSellerRequirements(sellerRequired, criteria);
      return reply.send({
        ok: true,
        resolved: remaining.length === 0,
        remaining_check_ids: remaining.map((c) => c.checkId),
      });
    },
  );

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

function stripClientModelEntitlement(
  negotiationAgentSnapshot: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...negotiationAgentSnapshot };
  delete next.pro_model_credit;
  delete next.allowed_model;
  return next;
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
