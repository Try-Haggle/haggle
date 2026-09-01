/**
 * pipeline/executor.ts
 *
 * New entry point for LLM negotiation rounds using the 6-Stage pipeline.
 * Replaces lib/llm-negotiation-executor.ts when NEGOTIATION_PIPELINE=staged.
 *
 * Responsibilities:
 * 1. BEGIN TX + SELECT FOR UPDATE
 * 2. Terminal/expiry check
 * 3. Memory reconstruction
 * 4. Screening
 * 5. executePipeline() — 6-Stage execution
 * 6. COMMIT
 */

import { type Database, eq, negotiationSessions, sql } from "@haggle/db";
import type { EventDispatcher, PipelineEvent } from "../../lib/event-dispatcher.js";
import type { RoundExecutionInput, RoundExecutionResult } from "../../lib/negotiation-executor.js";
import { mapRawToDbSession } from "../../lib/negotiation-executor.js";
import type { DbRound, DbSession } from "../../lib/session-reconstructor.js";
import { recordRoundConversationSignals } from "../../services/conversation-signal-sink.js";
import { loadEvermemoBrief } from "../../services/evermemo-bridge.service.js";
import { getL5SignalsProvider } from "../../services/l5-signals.service.js";
import { withPrivatePlanOnActingSide } from "../../services/negotiation-auto-play.service.js";
import {
  createRound,
  getRoundByIdempotencyKey,
  getRoundsBySessionId,
} from "../../services/negotiation-round.service.js";
import { getSessionById, updateSessionState } from "../../services/negotiation-session.service.js";
import { loadUserMemoryBrief } from "../../services/user-memory-card.service.js";
import { DeepSeekAdapter } from "../adapters/deepseek-adapter.js";
import { DEFAULT_BUDDY_DNA } from "../config.js";
import { buildConversationContext } from "../memory/conversation-memory.js";
import {
  type DbRoundForMemory,
  inferPhaseFromStatus,
  phaseToDbStatus,
  type RoundOffers,
  reconstructCoreMemory,
  reconstructOpponentPattern,
  reconstructRoundFacts,
} from "../memory/memory-reconstructor.js";
import { PgRoundFactSink } from "../memory/pg-round-fact-sink.js";
import { checkIntervention } from "../phase/human-intervention.js";
import { detectPhaseEvent, tryTransition } from "../phase/phase-machine.js";
import {
  detectSellerCriteriaPause,
  readSellerCriteriaFromSnapshot,
  SELLER_CRITERIA_PAUSE_MARKER,
  sellerCriteriaHoldChatMessage,
} from "../phase/seller-criteria-pause.js";
import { sanitizePrivatePlan } from "../prompts/private-plan.js";
import { computeBriefing } from "../referee/briefing.js";
import { computeCoachingAsync } from "../referee/coach.js";
import { screenMessage } from "../screening/auto-screening.js";
import { resolveCategoryProfile } from "../skills/category-profiles.js";
import { DefaultEngineSkill } from "../skills/default-engine-skill.js";
import { ElectronicsKnowledgeSkill } from "../skills/electronics-knowledge.js";
import { FaratinCoachingSkill } from "../skills/faratin-coaching.js";
import { HaggleEngineSkill } from "../skills/haggle-engine-skill.js";
import { RetailMsrpSkill } from "../skills/retail-msrp-skill.js";
import { registerSkill, resolveItemTags, SkillStack } from "../skills/skill-stack.js";
import { understand, understandFromStructured } from "../stages/understand.js";
import type {
  ConversationContext,
  CoreMemory,
  EngineDecision,
  NegotiationPhase,
  StageConfig,
} from "../types.js";
import { isDealClosingAction } from "../types.js";
import { executePipeline } from "./pipeline.js";

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

const adapter = new DeepSeekAdapter();

// Tag-matched plugins. Clothing/cars = new skills on this interface.
// Do not add if (category) in decide-user-prompt.
registerSkill(new HaggleEngineSkill());
registerSkill(new ElectronicsKnowledgeSkill());
registerSkill(new FaratinCoachingSkill());
registerSkill(new RetailMsrpSkill());

const roundFactSink = new PgRoundFactSink();

const TERMINAL_STATUSES = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);

// ---------------------------------------------------------------------------
// Default StageConfig
// ---------------------------------------------------------------------------

function buildDefaultStageConfig(): StageConfig {
  return {
    adapters: {
      UNDERSTAND: adapter,
      DECIDE: adapter,
      RESPOND: adapter,
    },
    modes: {
      RESPOND: "template",
      VALIDATE: "full",
    },
    memoEncoding: "codec",
  };
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

/**
 * Everything the LLM (Phase 2) and persist (Phase 3) steps need, produced by the
 * Phase 1 read+prepare transaction. Captured under a short row lock that is
 * released (tx commits) BEFORE the LLM call, so no DB transaction is ever held
 * across the multi-second DECIDE round-trip.
 */
interface PreparedRoundContext {
  dbSession: DbSession;
  nextRound: number;
  dbRounds: DbRound[];
  updatedMemory: CoreMemory;
  coaching: import("../types.js").RefereeCoaching;
  facts: import("../types.js").RoundFact[];
  opponentPattern: ReturnType<typeof reconstructOpponentPattern>;
  currentPhase: NegotiationPhase;
  understood: Parameters<typeof executePipeline>[0];
  skill: DefaultEngineSkill;
  skillStack: SkillStack;
  stageConfig: StageConfig;
  previousMoves: ReturnType<typeof extractPreviousMoves>;
  briefing: ReturnType<typeof computeBriefing>;
  memoryBrief: Awaited<ReturnType<typeof loadUserMemoryBrief>>;
  evermemoBrief: Awaited<ReturnType<typeof loadEvermemoBrief>>;
  conversation: ConversationContext;
  isNearDeal: boolean;
}

/**
 * Phase 1 either short-circuits with an already-persisted round (idempotent hit,
 * spam, seller-criteria pause, human-intervention hold) or hands off a context
 * for the LLM + persist phases.
 */
type PreparedRoundOutcome =
  | { early: RoundExecutionResult; ctx?: undefined }
  | { early?: undefined; ctx: PreparedRoundContext };

export async function executeStagedNegotiationRound(
  db: Database,
  input: RoundExecutionInput,
  eventDispatcher?: EventDispatcher,
): Promise<RoundExecutionResult> {
  // --- Idempotency check (outside transaction for speed) ---
  const existingRound = await getRoundByIdempotencyKey(db, input.sessionId, input.idempotencyKey);
  if (existingRound) {
    return buildIdempotentResult(existingRound, db, input.sessionId);
  }

  // --- Phase 1: read + prepare (short tx; row lock released before the LLM call) ---
  // The DECIDE LLM call must NOT run inside a DB transaction. It can take up to 45s,
  // and holding `SELECT … FOR UPDATE` + a pooled connection across it piles up
  // `idle in transaction` backends that exhaust the connection pool and wedge the
  // whole auto-play loop. So we prepare under a short lock, COMMIT (releasing the
  // lock), run the LLM lock-free (Phase 2), then persist in a second short tx
  // guarded by the same optimistic `version` check (Phase 3).
  const prep = await db.transaction(async (tx): Promise<PreparedRoundOutcome> => {
    // 1. Lock session row
    const lockedRows = await tx.execute(
      sql`SELECT * FROM negotiation_sessions WHERE id = ${input.sessionId} FOR UPDATE`,
    );
    const lockedRow = (lockedRows as unknown as Record<string, unknown>[])[0];
    if (!lockedRow) throw new Error(`SESSION_NOT_FOUND: ${input.sessionId}`);

    const dbSession = mapRawToDbSession(lockedRow);

    // 2. Terminal check
    if (TERMINAL_STATUSES.has(dbSession.status)) {
      throw new Error(`SESSION_TERMINAL: ${dbSession.status}`);
    }

    // 2b. Expiry check
    if (dbSession.expiresAt && dbSession.expiresAt.getTime() < input.nowMs) {
      await updateSessionState(tx as unknown as Database, input.sessionId, dbSession.version, {
        status: "EXPIRED",
      });
      throw new Error("SESSION_EXPIRED");
    }

    const maxRounds = extractNum(dbSession.negotiationAgentSnapshot, "max_rounds") ?? 15;
    if (dbSession.currentRound >= maxRounds) {
      await updateSessionState(tx as unknown as Database, input.sessionId, dbSession.version, {
        status: "REJECTED",
      });
      throw new Error("ROUND_LIMIT_EXCEEDED");
    }

    // 3. Double-check idempotency inside TX
    const existingInTx = await getRoundByIdempotencyKey(
      tx as unknown as Database,
      input.sessionId,
      input.idempotencyKey,
    );
    if (existingInTx) {
      return { early: buildIdempotentResultFromRound(existingInTx, dbSession) };
    }

    // 4. Load rounds + reconstruct memory.
    // Do not cache services constructed with `tx` at module scope. A transaction DB
    // handle is valid only inside this callback; retaining it made later negotiations
    // wait forever on an already-finished transaction. The old checkpoint hydration
    // was also dead work here: this live path never consumed the hydrated store.
    const dbRounds = (await getRoundsBySessionId(
      tx as unknown as Database,
      input.sessionId,
    )) as DbRound[];
    const nextRound = dbSession.currentRound + 1;

    const roundsForMemory: DbRoundForMemory[] = dbRounds.map((r) => {
      const raw = r as unknown as Record<string, unknown>;
      return {
        roundNo: r.roundNo,
        senderRole: r.senderRole as "BUYER" | "SELLER",
        priceminor: r.priceminor,
        counterPriceMinor: r.counterPriceMinor,
        decision: r.decision,
        utility: r.utility as DbRound["utility"],
        metadata: r.metadata,
        createdAt: r.createdAt,
        coaching: (raw.coaching as Record<string, unknown> | null) ?? null,
        phaseAtRound: (raw.phase_at_round as string | null) ?? null,
      };
    });

    const role = dbSession.role.toLowerCase() as "buyer" | "seller";
    const facts = reconstructRoundFacts(roundsForMemory, dbSession.role);
    const opponentPattern = reconstructOpponentPattern(facts, role);

    // The two live prices, measured from the transcript rather than inferred from the
    // session row (which only remembers what the previous round replied to). Without
    // these the engine anchored purely on its own target and produced offers that
    // ignored the price on the table.
    const myLastOffer = lastOutgoingOfferMinor(roundsForMemory, dbSession.role);
    const offers: RoundOffers = {
      incomingOfferMinor: input.offerPriceMinor,
      ...(myLastOffer !== undefined ? { myLastOfferMinor: myLastOffer } : {}),
    };

    // Compute coaching first (needed for CoreMemory.coaching which is still RefereeCoaching type)
    // Uses trust score from DB when counterpartyId is available
    const dummyMemory = buildInitialMemory(dbSession, facts, offers);
    const coaching = await computeCoachingAsync(
      dummyMemory,
      facts,
      opponentPattern,
      DEFAULT_BUDDY_DNA,
      tx as unknown as Database,
      dbSession.counterpartyId,
    );

    // Full CoreMemory with actual coaching (RefereeCoaching, needed for validator + context-assembly)
    const memory = reconstructCoreMemory(
      dbSession,
      dbSession.negotiationAgentSnapshot,
      coaching,
      offers,
    );

    // Compute briefing (facts-only, replaces coaching in pipeline ContextOutput)
    const briefing = computeBriefing(memory, facts, opponentPattern);

    // Update memory with incoming offer
    const updatedMemory: CoreMemory = {
      ...memory,
      boundaries: {
        ...memory.boundaries,
        opponent_offer: input.offerPriceMinor,
        gap: Math.abs(memory.boundaries.current_offer - input.offerPriceMinor),
      },
      session: {
        ...memory.session,
        round: nextRound,
        rounds_remaining: Math.max(0, memory.session.max_rounds - nextRound),
      },
    };

    // 5. Screening
    const screening = screenMessage({
      messageText: `Offer: $${input.offerPriceMinor / 100}`,
      senderTrustScore: input.roundData.r_score,
      priceDeviation: computePriceDeviation(
        input.offerPriceMinor,
        updatedMemory.boundaries.my_target,
      ),
    });

    if (screening.is_spam) {
      const spamResult = await persistSpamRound(
        tx as unknown as Database,
        dbSession,
        input,
        nextRound,
        updatedMemory,
        coaching,
      );
      return { early: spamResult };
    }

    // 6. Phase detection
    // NEAR_DEAL is only checked from round 3 onward and uses a tight 5% threshold
    // so the auto-play loop has time to actually negotiate (counter, concede, re-counter)
    // before being declared "near a deal". A loose threshold on round 1 killed
    // multi-round transcripts entirely.
    let currentPhase = updatedMemory.session.phase;
    const NEAR_DEAL_MIN_ROUND = 3;
    const NEAR_DEAL_GAP_RATIO = 0.05;
    const isNearDeal =
      nextRound >= NEAR_DEAL_MIN_ROUND &&
      updatedMemory.boundaries.gap > 0 &&
      updatedMemory.boundaries.gap /
        Math.abs(updatedMemory.boundaries.my_target - updatedMemory.boundaries.my_floor || 1) <
        NEAR_DEAL_GAP_RATIO;

    const phaseEvent = detectPhaseEvent("COUNTER", currentPhase, isNearDeal, false);
    if (phaseEvent) {
      const transition = tryTransition(currentPhase, phaseEvent);
      if (transition.transitioned) {
        currentPhase = transition.to;
      }
    }

    // 6.5 Seller-criteria PAUSE (Phase G, Flow 3). Independent of intervention_mode
    // (which is pinned FULL_AUTO): if the seller declared a REQUIRED criterion the
    // buyer never addressed, hold this buyer round ONCE to surface the question, then
    // let the negotiation continue (fire-once — the buyer's stored criteria are
    // immutable mid-session, so without this guard the identical unresolved set would
    // re-hold every buyer round and stall the auto-play loop). The seller's required
    // criteria + the buyer's own criteria ride on the responder snapshot; pre-Phase-G
    // sessions carry neither, so this never fires for them.
    // The interactive resume IS wired: this WAITING round blocks the auto-play loop
    // (route auto-play/next resume gate), the buyer answers via POST /pause/answer
    // (applyBuyerPauseAnswer writes their stance → the unresolved set empties), and the
    // next round proceeds with the answer as a factor.
    const alreadyPaused = roundsForMemory.some((r) => {
      const reasoning = (r.metadata as Record<string, unknown> | null)?.reasoning;
      return typeof reasoning === "string" && reasoning.includes(SELLER_CRITERIA_PAUSE_MARKER);
    });
    // Only pause in OPENING/BARGAINING. In CLOSING a HOLD maps to DB status
    // NEAR_DEAL, which the auto-play loop treats as terminal — pausing there would
    // permanently stop the negotiation instead of surfacing one question.
    const pausablePhase = currentPhase === "OPENING" || currentPhase === "BARGAINING";
    const pauseInputs = readSellerCriteriaFromSnapshot(dbSession.negotiationAgentSnapshot);
    const sellerCriteriaPause =
      alreadyPaused || !pausablePhase
        ? null
        : detectSellerCriteriaPause({
            responderRole: role,
            sellerRequired: pauseInputs.sellerRequired,
            buyerCriteria: pauseInputs.buyerCriteria,
            round: nextRound,
          });
    if (sellerCriteriaPause) {
      const pauseResult = await persistHoldRound(
        tx as unknown as Database,
        dbSession,
        input,
        nextRound,
        updatedMemory,
        coaching,
        currentPhase,
        {
          pendingReview: {
            reason: `${SELLER_CRITERIA_PAUSE_MARKER}: ${sellerCriteriaPause.reason}`,
          },
        },
        sellerCriteriaHoldChatMessage({
          incomingMessage: input.messageText,
          incomingPriceMinor: input.offerPriceMinor,
          senderRole: input.senderRole,
          pauseQuestions: sellerCriteriaPause.questions,
        }),
        {
          pause_questions: sellerCriteriaPause.questions,
          pause_check_ids: sellerCriteriaPause.unresolvedCheckIds,
        },
      );
      return { early: pauseResult };
    }

    // 7. Intervention check
    const intervention = checkIntervention(
      { action: "COUNTER", reasoning: "pending" },
      currentPhase,
      updatedMemory.session.intervention_mode,
    );
    if (!intervention.autoApproved) {
      const holdResult = await persistHoldRound(
        tx as unknown as Database,
        dbSession,
        input,
        nextRound,
        updatedMemory,
        coaching,
        currentPhase,
        intervention,
      );
      return { early: holdResult };
    }

    // 8. Prepare pipeline inputs (L5 market signals are fetched in Phase 2, outside
    // the transaction, since that is external I/O.)
    const stageConfig = buildDefaultStageConfig();
    const senderRole = role === "buyer" ? "seller" : "buyer";
    const understood = input.messageText
      ? {
          ...understand({
            raw_message: input.messageText,
            sender_role: senderRole,
            known_shipping_terms: Boolean(
              updatedMemory.fulfillment_context ||
                updatedMemory.terms.active.some((term) => term.term_id === "shipping_method"),
            ),
          }),
          price_offer: input.offerPriceMinor,
        }
      : understandFromStructured(input.offerPriceMinor, senderRole);

    // L3/H5-a: surface sensor-extracted features on the working memory. This is a
    // SHADOW for now — it rides into coreMemorySnapshot for observation but does not
    // affect price until L5 wires category rules.
    if (understood.extracted_features?.length) {
      updatedMemory.extracted_features = understood.extracted_features;
      // Redacted shadow log — omit raw_span (verbatim message text) to keep PII out of logs.
      console.info(
        `[sensor] round ${updatedMemory.session.round} features:`,
        understood.extracted_features.map((f) => ({ key: f.key, type: f.type, value: f.value })),
      );
    }

    const previousMoves = extractPreviousMoves(dbRounds);
    const memoryBrief = await loadUserMemoryBrief(tx as unknown as Database, {
      userId: userIdForAgentRole(dbSession),
    });
    const evermemoBrief = await loadEvermemoBrief(tx as unknown as Database, {
      userId: userIdForAgentRole(dbSession),
      query: buildEvermemoRetrievalQuery(dbSession, input, understood),
      topK: 5,
    });

    // Build the per-session skill + SkillStack from the listing's category + tags.
    // Previously the executor read a nonexistent `dbSession.category` column, so
    // every session fell back to ["electronics"]: the v2 electronics knowledge
    // skill AND the v1 DefaultEngineSkill's iPhone/IMEI content leaked onto all
    // items. Sourcing from listing_context lets non-electronics resolve neutral.
    const itemTags = resolveItemTags(updatedMemory.listing_context);
    const skillStack = SkillStack.fromTags(itemTags);
    const skill = new DefaultEngineSkill(resolveCategoryProfile(itemTags));

    const conversation = buildConversationContext(
      dbRounds,
      input.messageText,
      input.senderRole,
      input.offerPriceMinor,
    );

    // Phase 1 done: hand everything the LLM + persist phases need to the caller. The
    // transaction COMMITs here, releasing the row lock BEFORE the LLM runs.
    return {
      ctx: {
        dbSession,
        nextRound,
        dbRounds,
        updatedMemory,
        coaching,
        facts,
        opponentPattern,
        currentPhase,
        understood,
        skill,
        skillStack,
        stageConfig,
        previousMoves,
        briefing,
        memoryBrief,
        evermemoBrief,
        conversation,
        isNearDeal,
      },
    };
  });

  // Phase 1 short-circuited with an already-persisted round.
  if (prep.early) return prep.early;
  const ctx = prep.ctx;

  // --- Phase 2: LLM DECIDE + market signals (NO transaction, NO row lock held) ---
  // This is the slow, external part of the round. Running it here — after the Phase 1
  // tx has committed — is the whole point of the split: a hung/slow LLM call can no
  // longer hold a DB lock or a pooled connection.
  const l5Signals = await getL5SignalsProvider()
    .getMarketSignals({
      category: "electronics",
      item_model: extractItemModel(ctx.dbSession.negotiationAgentSnapshot),
    })
    .catch((err) => {
      console.warn(
        "[executor] L5 signals fetch failed, continuing without:",
        (err as Error).message,
      );
      return undefined;
    }); // Non-fatal: continue without signals

  const pipelineResult = await executePipeline(ctx.understood, input.offerPriceMinor, {
    skill: ctx.skill,
    skillStack: ctx.skillStack,
    config: ctx.stageConfig,
    memory: ctx.updatedMemory,
    facts: ctx.facts,
    opponent: ctx.opponentPattern ?? {
      aggression: 0.5,
      concession_rate: 0,
      preferred_tactics: ["unknown"],
      condition_flexibility: 0.5,
      estimated_floor: 0,
    },
    phase: ctx.currentPhase,
    buddyDna: DEFAULT_BUDDY_DNA,
    previousMoves: ctx.previousMoves,
    round: ctx.nextRound,
    briefing: ctx.briefing,
    memoEncoding: "codec",
    l5_signals: l5Signals,
    memory_brief: ctx.memoryBrief,
    evermemo_brief: ctx.evermemoBrief,
    conversation: ctx.conversation,
  });

  // --- Phase 3: persist (short tx; optimistic version guard vs concurrent writers) ---
  const result = await db.transaction(async (tx) => {
    const { dbSession, nextRound, updatedMemory, coaching, opponentPattern, isNearDeal } = ctx;
    let currentPhase = ctx.currentPhase;

    // A concurrent writer may have committed this exact round while the LLM ran.
    // Re-check idempotency before inserting so we return the winner's round instead
    // of colliding on the unique idempotency key.
    const raced = await getRoundByIdempotencyKey(
      tx as unknown as Database,
      input.sessionId,
      input.idempotencyKey,
    );
    if (raced) return buildIdempotentResultFromRound(raced, dbSession);

    // Extract results from pipeline
    const finalDecision = pipelineResult.stages.validate.final_decision;
    const message = pipelineResult.stages.respond.message;
    const validation = pipelineResult.stages.validate.validation;
    const _pipelineBriefing = pipelineResult.stages.context.briefing;

    // Post-decision phase transition
    const postDecisionEvent = detectPhaseEvent(
      finalDecision.action,
      currentPhase,
      isNearDeal || finalDecision.action === "ACCEPT",
      finalDecision.action === "CONFIRM",
    );
    if (postDecisionEvent) {
      const transition = tryTransition(currentPhase, postDecisionEvent);
      if (transition.transitioned) {
        currentPhase = transition.to;
      }
    }

    // Persist to DB
    // NOTE: persistPipelineRound still takes RefereeCoaching for DB column compatibility.
    // Pass the original coaching object (from computeCoachingAsync).
    const roundResult = await persistPipelineRound(tx as unknown as Database, {
      dbSession,
      input,
      nextRound,
      decision: finalDecision,
      memory: updatedMemory,
      coaching,
      validation,
      phase: currentPhase,
      message,
      llmTokensUsed: pipelineResult.cost.tokens,
      reasoningUsed: pipelineResult.stages.decide.reasoning_mode,
      explainability: pipelineResult.explainability,
    });

    // Stage 6 post-persist: flush round facts with hash chain
    // coaching_given uses the old coaching for backward compat with RoundFact schema
    const currentFact: import("../types.js").RoundFact = {
      round: nextRound,
      phase: currentPhase,
      buyer_offer:
        input.senderRole === "BUYER" ? input.offerPriceMinor : (finalDecision.price ?? 0),
      seller_offer:
        input.senderRole === "SELLER" ? input.offerPriceMinor : (finalDecision.price ?? 0),
      gap: updatedMemory.boundaries.gap,
      buyer_tactic:
        input.senderRole === "BUYER" ? undefined : (finalDecision.tactic_used ?? undefined),
      seller_tactic:
        input.senderRole === "SELLER" ? undefined : (finalDecision.tactic_used ?? undefined),
      conditions_changed: {},
      coaching_given: {
        recommended: coaching.recommended_price,
        tactic: coaching.suggested_tactic,
      },
      coaching_followed:
        finalDecision.price != null
          ? Math.abs(finalDecision.price - coaching.recommended_price) < 500
          : false,
      human_intervened: false,
      timestamp: Date.now(),
    };
    roundFactSink.add(input.sessionId, nextRound, currentFact);
    const finalHashes = await roundFactSink.flush(tx as unknown as Database);
    const sessionChainHash = finalHashes.get(input.sessionId) ?? null;

    // Terminal snapshot: save opponent_model, core_memory_snapshot, session_fact_chain_hash
    if (TERMINAL_STATUSES.has(roundResult.sessionStatus) && sessionChainHash) {
      await (tx as unknown as Database)
        .update(negotiationSessions)
        .set({
          opponentModel: (opponentPattern as unknown as Record<string, unknown>) ?? undefined,
          coreMemorySnapshot: updatedMemory as unknown as Record<string, unknown>,
          sessionFactChainHash: sessionChainHash,
          updatedAt: new Date(),
        })
        .where(eq(negotiationSessions.id, input.sessionId));
    }

    return roundResult;
  });

  // --- Post-commit: dispatch pipeline events ---
  if (eventDispatcher && !result.idempotent) {
    const finalSession = await getSessionById(db, input.sessionId);
    const terminalEvent = buildTerminalEvent(
      input.sessionId,
      result.sessionStatus,
      result.decision,
      finalSession ?? undefined,
    );
    if (terminalEvent) {
      await eventDispatcher.dispatch(terminalEvent).catch((err) => {
        console.error("[staged-executor] event dispatch error:", err);
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Persist helpers
// ---------------------------------------------------------------------------

interface PersistRoundParams {
  dbSession: DbSession;
  input: RoundExecutionInput;
  nextRound: number;
  decision: EngineDecision;
  memory: CoreMemory;
  coaching: import("../types.js").RefereeCoaching;
  validation: import("../types.js").ValidationResult;
  phase: NegotiationPhase;
  message: string;
  llmTokensUsed: number;
  reasoningUsed: boolean;
  explainability?: import("../types.js").RoundExplainability;
  metadataExtras?: Record<string, unknown>;
}

async function persistPipelineRound(
  tx: Database,
  params: PersistRoundParams,
): Promise<RoundExecutionResult> {
  const {
    dbSession,
    input,
    nextRound,
    decision,
    memory,
    coaching,
    validation,
    phase,
    message,
    llmTokensUsed,
    reasoningUsed,
  } = params;

  const dbDecision = mapActionToDbDecision(decision.action);
  const dbStatus = phaseToDbStatus(phase, decision.action, dbSession.roundsNoConcession);
  // For REJECT, we do NOT fall back to the incoming offer price — otherwise the
  // auto-play loop reuses the rejected price as the next "counter", producing
  // self-contradictory transcripts.
  //
  // Closing actions use the incoming price, unconditionally. This used to read
  // `decision.price ?? input.offerPriceMinor`, which only reached the incoming offer
  // when the engine left the price unset — so a stale `boundaries.current_offer`
  // (the responder's OWN prior counter) won instead, and the round recorded a
  // different number than the one being accepted. The pipeline already pins
  // `decision.price` for these actions; stating it here too keeps the persisted
  // round and its signals correct independently of stage ordering.
  const outgoingPrice =
    decision.action === "REJECT"
      ? 0
      : isDealClosingAction(decision.action)
        ? input.offerPriceMinor
        : (decision.price ?? input.offerPriceMinor);
  const messageType = mapActionToMessageType(decision.action, nextRound);

  const createdRound = await createRound(tx, {
    sessionId: input.sessionId,
    roundNo: nextRound,
    senderRole: input.senderRole,
    messageType,
    priceminor: String(input.offerPriceMinor),
    // COUNTER carries the new offer; a HOLD with a carried price (seller-criteria
    // pause) records the responder's standing offer so the price ladder survives.
    counterPriceMinor:
      decision.action === "COUNTER" || (decision.action === "HOLD" && decision.price != null)
        ? String(outgoingPrice)
        : undefined,
    utility: memory.coaching.utility_snapshot
      ? {
          u_total: memory.coaching.utility_snapshot.u_total,
          v_p: memory.coaching.utility_snapshot.u_price,
          v_t: memory.coaching.utility_snapshot.u_time,
          v_r: memory.coaching.utility_snapshot.u_risk,
          v_s: memory.coaching.utility_snapshot.u_quality,
        }
      : undefined,
    decision: dbDecision,
    metadata: {
      tactic: decision.tactic_used,
      reasoning: decision.reasoning,
      engine: "staged-pipeline",
      protocol: input.protocol ? { hnp: input.protocol } : undefined,
      explainability: params.explainability ?? undefined,
      ...params.metadataExtras,
    },
    idempotencyKey: input.idempotencyKey,
    coaching: coaching as unknown as Record<string, unknown>,
    validation: validation as unknown as Record<string, unknown>,
    llmTokensUsed,
    reasoningUsed,
    message,
    phaseAtRound: phase,
  });

  await recordSignalsForCreatedRound(tx, params, createdRound.id, outgoingPrice);

  const roundsNoConcession =
    decision.action === "COUNTER" && decision.price
      ? Math.abs(decision.price - (Number(dbSession.lastOfferPriceMinor) || 0)) < 1
        ? dbSession.roundsNoConcession + 1
        : 0
      : dbSession.roundsNoConcession;

  const nextSnapshot = nextSnapshotWithPlan(
    dbSession.negotiationAgentSnapshot,
    dbSession.role,
    decision,
  );
  const updated = await updateSessionState(tx, input.sessionId, dbSession.version, {
    status: dbStatus as
      | "CREATED"
      | "ACTIVE"
      | "NEAR_DEAL"
      | "STALLED"
      | "ACCEPTED"
      | "REJECTED"
      | "EXPIRED"
      | "SUPERSEDED"
      | "WAITING",
    currentRound: nextRound,
    roundsNoConcession,
    lastOfferPriceMinor: String(input.offerPriceMinor),
    lastUtility: memory.coaching.utility_snapshot
      ? {
          u_total: memory.coaching.utility_snapshot.u_total,
          v_p: memory.coaching.utility_snapshot.u_price,
          v_t: memory.coaching.utility_snapshot.u_time,
          v_r: memory.coaching.utility_snapshot.u_risk,
          v_s: memory.coaching.utility_snapshot.u_quality,
        }
      : undefined,
    phase,
    coachingSnapshot: coaching as unknown as Record<string, unknown>,
    ...(nextSnapshot ? { negotiationAgentSnapshot: nextSnapshot } : {}),
  });

  if (!updated) {
    throw new Error("CONCURRENT_MODIFICATION: session version conflict");
  }

  return {
    idempotent: false,
    roundId: createdRound.id,
    roundNo: nextRound,
    decision: dbDecision,
    outgoingPrice,
    utility: memory.coaching.utility_snapshot
      ? {
          u_total: memory.coaching.utility_snapshot.u_total,
          v_p: memory.coaching.utility_snapshot.u_price,
          v_t: memory.coaching.utility_snapshot.u_time,
          v_r: memory.coaching.utility_snapshot.u_risk,
          v_s: memory.coaching.utility_snapshot.u_quality,
        }
      : { u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0 },
    sessionStatus: dbStatus,
    message,
    phase,
    reasoningUsed,
    explainability: params.explainability,
  } as RoundExecutionResult;
}

async function recordSignalsForCreatedRound(
  tx: Database,
  params: PersistRoundParams,
  roundId: string,
  outgoingPrice: number,
): Promise<void> {
  const { dbSession, input, nextRound, message } = params;
  const incomingText = input.messageText ?? `Offer: $${(input.offerPriceMinor / 100).toFixed(2)}`;
  const outgoingText = message || `Counter: $${(outgoingPrice / 100).toFixed(2)}`;

  await recordRoundConversationSignals(tx, {
    sessionId: input.sessionId,
    roundId,
    roundNo: nextRound,
    listingId: dbSession.listingId,
    buyerId: dbSession.buyerId,
    sellerId: dbSession.sellerId,
    incomingRole: input.senderRole,
    agentRole: dbSession.role,
    incomingText,
    outgoingText,
    engine: "staged-pipeline",
    idempotencyKey: input.idempotencyKey,
    decision: params.decision.action,
  });
}

function nextSnapshotWithPlan(
  snapshot: Record<string, unknown> | null | undefined,
  role: "BUYER" | "SELLER",
  decision: EngineDecision,
): Record<string, unknown> | undefined {
  const plan = sanitizePrivatePlan(decision.private_plan);
  if (!plan) return undefined;
  const current = snapshot ?? {};
  if (current.private_plan === plan) return undefined;
  return withPrivatePlanOnActingSide(current, role, plan);
}

function userIdForAgentRole(dbSession: DbSession): string {
  return dbSession.role === "BUYER" ? dbSession.buyerId : dbSession.sellerId;
}

function buildEvermemoRetrievalQuery(
  dbSession: DbSession,
  input: RoundExecutionInput,
  understood: ReturnType<typeof understand> | ReturnType<typeof understandFromStructured>,
): string {
  return [
    "Haggle negotiation memory retrieval",
    `role: ${dbSession.role}`,
    `listing_id: ${dbSession.listingId}`,
    `incoming_offer_minor: ${input.offerPriceMinor}`,
    `intent: ${understood.action_intent}`,
    understood.conversation_type ? `conversation_type: ${understood.conversation_type}` : null,
    understood.missing_information?.length
      ? `missing_information: ${understood.missing_information.map((need) => need.slot).join(",")}`
      : null,
    input.messageText ? `message: ${input.messageText}` : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");
}

async function persistSpamRound(
  tx: Database,
  dbSession: DbSession,
  input: RoundExecutionInput,
  nextRound: number,
  memory: CoreMemory,
  coaching: import("../types.js").RefereeCoaching,
): Promise<RoundExecutionResult> {
  const spamDecision: EngineDecision = {
    action: "REJECT",
    reasoning: "Screening blocked: spam detected",
  };
  return persistPipelineRound(tx, {
    dbSession,
    input,
    nextRound,
    decision: spamDecision,
    memory,
    coaching,
    validation: { passed: true, hardPassed: true, violations: [] },
    phase: memory.session.phase,
    message: "This offer has been automatically declined.",
    llmTokensUsed: 0,
    reasoningUsed: false,
  });
}

async function persistHoldRound(
  tx: Database,
  dbSession: DbSession,
  input: RoundExecutionInput,
  nextRound: number,
  memory: CoreMemory,
  coaching: import("../types.js").RefereeCoaching,
  phase: NegotiationPhase,
  intervention: { pendingReview?: { reason: string } },
  /** Buyer-facing message for the held round. Defaults to the approval-wait copy. */
  message = "Waiting for your approval to proceed.",
  metadataExtras?: Record<string, unknown>,
): Promise<RoundExecutionResult> {
  const holdDecision: EngineDecision = {
    action: "HOLD",
    reasoning: intervention.pendingReview?.reason ?? "Human approval required.",
  };
  // Carry the responder's OWN standing offer across the hold so the auto-play price
  // ladder is preserved. Without this the HOLD round stores no outgoing price, and
  // the next round reads the incoming (counterparty) price as the responder's
  // "outgoing" and echoes it back — collapsing the negotiation to the counterparty's
  // number (e.g. the buyer would re-offer the seller's ask and close at full price).
  const heldOffer = memory.boundaries.current_offer;
  if (Number.isFinite(heldOffer) && heldOffer > 0) {
    holdDecision.price = heldOffer;
  }
  return persistPipelineRound(tx, {
    dbSession,
    input,
    nextRound,
    decision: holdDecision,
    memory,
    coaching,
    validation: { passed: true, hardPassed: true, violations: [] },
    phase,
    message,
    llmTokensUsed: 0,
    reasoningUsed: false,
    metadataExtras,
  });
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * The most recent price THIS side actually put on the table, read from the transcript.
 *
 * One round row holds BOTH sides of an exchange: `priceminor` is the offer the SENDER
 * brought, `counterPriceMinor` is what the responder — the other role — answered with.
 * So a party's own price is `priceminor` on rounds they sent and `counterPriceMinor` on
 * rounds they answered. Reading `counterPriceMinor` off their own sent rounds returns
 * the OPPONENT's number, which is how a buyer who had offered $96 came back holding the
 * seller's $115 and effectively conceded the whole gap.
 *
 * Returns undefined before this side has priced anything.
 */
export function lastOutgoingOfferMinor(
  rounds: readonly DbRoundForMemory[],
  role: string,
): number | undefined {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i]!;
    const mine = round.senderRole === role ? round.priceminor : round.counterPriceMinor;
    if (mine === null || mine === undefined) continue;
    const value = Number(mine);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

/**
 * A minimal CoreMemory used ONLY to compute this round's coaching, before the real one
 * is rebuilt with that coaching attached.
 *
 * It must carry the same live prices as the real memory: the coach clamps its
 * recommendation and its acceptable range to the price envelope, and the envelope is
 * derived from `opponent_offer` / `my_last_offer`. Built without them, the coach bounds
 * against a stale session-row price and hands the LLM a box that was never narrowed —
 * the referee would still catch the final number, but every recommendation upstream of
 * it would be computed against the wrong negotiation.
 */
export function buildInitialMemory(
  dbSession: DbSession,
  _facts: import("../types.js").RoundFact[],
  offers: RoundOffers = {},
): CoreMemory {
  const strategy = dbSession.negotiationAgentSnapshot;
  const myTarget = extractNum(strategy, "p_target") ?? extractNum(strategy, "target_price") ?? 0;
  const myFloor = extractNum(strategy, "p_limit") ?? extractNum(strategy, "floor_price") ?? 0;
  const maxRounds = extractNum(strategy, "max_rounds") ?? 15;
  const storedOffer = dbSession.lastOfferPriceMinor
    ? Number(dbSession.lastOfferPriceMinor)
    : undefined;
  const currentOffer = offers.myLastOfferMinor ?? storedOffer ?? myTarget;
  const opponentOffer = offers.incomingOfferMinor ?? storedOffer ?? currentOffer;
  const role = dbSession.role.toLowerCase() as "buyer" | "seller";
  const phase = inferPhaseFromStatus(
    dbSession.status,
    dbSession.currentRound,
    dbSession.roundsNoConcession,
  );

  return {
    session: {
      session_id: dbSession.id,
      phase,
      round: dbSession.currentRound,
      rounds_remaining: Math.max(0, maxRounds - dbSession.currentRound),
      role,
      max_rounds: maxRounds,
      intervention_mode: "FULL_AUTO",
    },
    boundaries: {
      my_target: myTarget,
      my_floor: myFloor,
      current_offer: currentOffer,
      opponent_offer: opponentOffer,
      gap: Math.abs(currentOffer - opponentOffer),
      ...(offers.myLastOfferMinor !== undefined ? { my_last_offer: offers.myLastOfferMinor } : {}),
    },
    terms: { active: [], resolved_summary: "" },
    coaching: {
      recommended_price: 0,
      acceptable_range: { min: 0, max: 0 },
      suggested_tactic: "",
      hint: "",
      opponent_pattern: "UNKNOWN",
      convergence_rate: 0,
      time_pressure: 0,
      utility_snapshot: { u_price: 0, u_time: 0, u_risk: 0, u_quality: 0, u_total: 0 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: "electronics-iphone-pro-v1",
  };
}

function extractNum(obj: Record<string, unknown>, key: string): number | null {
  const val = obj[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function extractPreviousMoves(dbRounds: DbRound[]): EngineDecision[] {
  return dbRounds
    .filter((r) => r.decision)
    .map((r) => ({
      action: r.decision as EngineDecision["action"],
      price: r.counterPriceMinor ? Number(r.counterPriceMinor) : undefined,
      reasoning: ((r.metadata as Record<string, unknown>)?.reasoning as string) ?? "",
      tactic_used: (r.metadata as Record<string, unknown>)?.tactic as string | undefined,
    }));
}

function extractItemModel(strategy: Record<string, unknown>): string {
  const model = strategy.item_model ?? strategy.itemModel ?? strategy.model;
  return typeof model === "string" ? model : "iphone-14-pro-128";
}

function computePriceDeviation(offerPrice: number, targetPrice: number): number {
  if (targetPrice === 0) return 0;
  return Math.abs((offerPrice - targetPrice) / targetPrice) * 100;
}

function mapActionToDbDecision(
  action: string,
): "ACCEPT" | "COUNTER" | "REJECT" | "NEAR_DEAL" | "ESCALATE" {
  switch (action) {
    case "COUNTER":
      return "COUNTER";
    case "ACCEPT":
      return "ACCEPT";
    case "REJECT":
      return "REJECT";
    case "HOLD":
      return "NEAR_DEAL";
    case "CONFIRM":
      return "ACCEPT";
    case "ESCALATE":
      return "ESCALATE";
    default:
      return "COUNTER";
  }
}

function mapActionToMessageType(
  action: string,
  roundNo: number,
): "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE" {
  switch (action) {
    case "ACCEPT":
    case "CONFIRM":
      return "ACCEPT";
    case "REJECT":
      return "REJECT";
    case "HOLD":
    case "DISCOVER":
    case "ESCALATE":
      return "ESCALATE";
    default:
      return roundNo === 1 ? "OFFER" : "COUNTER";
  }
}

async function buildIdempotentResult(
  existingRound: Record<string, unknown>,
  db: Database,
  sessionId: string,
): Promise<RoundExecutionResult> {
  const session = await getSessionById(db, sessionId);
  return {
    idempotent: true,
    roundId: existingRound.id as string,
    roundNo: existingRound.roundNo as number,
    decision: (existingRound.decision as string) ?? "COUNTER",
    outgoingPrice: Number(existingRound.counterPriceMinor ?? existingRound.priceminor),
    utility: (existingRound.utility as RoundExecutionResult["utility"]) ?? {
      u_total: 0,
      v_p: 0,
      v_t: 0,
      v_r: 0,
      v_s: 0,
    },
    sessionStatus: session?.status ?? "ACTIVE",
  };
}

function buildIdempotentResultFromRound(
  existingRound: Record<string, unknown>,
  dbSession: DbSession,
): RoundExecutionResult {
  return {
    idempotent: true,
    roundId: existingRound.id as string,
    roundNo: existingRound.roundNo as number,
    decision: (existingRound.decision as string) ?? "COUNTER",
    outgoingPrice: Number(existingRound.counterPriceMinor ?? existingRound.priceminor),
    utility: (existingRound.utility as RoundExecutionResult["utility"]) ?? {
      u_total: 0,
      v_p: 0,
      v_t: 0,
      v_r: 0,
      v_s: 0,
    },
    sessionStatus: dbSession.status,
  };
}

function buildTerminalEvent(
  sessionId: string,
  sessionStatus: string,
  decision: string,
  session?: {
    buyerId: string;
    sellerId: string;
    lastOfferPriceMinor: string | null;
    intentId: string | null;
  },
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

  return null;
}
