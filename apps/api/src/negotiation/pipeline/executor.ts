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
import {
  createRound,
  getRoundByIdempotencyKey,
  getRoundsBySessionId,
} from "../../services/negotiation-round.service.js";
import { getSessionById, updateSessionState } from "../../services/negotiation-session.service.js";
import { loadUserMemoryBrief } from "../../services/user-memory-card.service.js";
import { DeepSeekAdapter } from "../adapters/deepseek-adapter.js";
import { DEFAULT_BUDDY_DNA } from "../config.js";
import { CheckpointStore } from "../memory/checkpoint-store.js";
import {
  type DbRoundForMemory,
  inferPhaseFromStatus,
  phaseToDbStatus,
  reconstructCoreMemory,
  reconstructOpponentPattern,
  reconstructRoundFacts,
} from "../memory/memory-reconstructor.js";
import { PgCheckpointPersistence } from "../memory/pg-checkpoint-persistence.js";
import { PgRoundFactSink } from "../memory/pg-round-fact-sink.js";
import { checkIntervention } from "../phase/human-intervention.js";
import { detectPhaseEvent, tryTransition } from "../phase/phase-machine.js";
import { computeBriefing } from "../referee/briefing.js";
import { computeCoachingAsync } from "../referee/coach.js";
import { screenMessage } from "../screening/auto-screening.js";
import { DefaultEngineSkill } from "../skills/default-engine-skill.js";
import { ElectronicsKnowledgeSkill } from "../skills/electronics-knowledge.js";
import { FaratinCoachingSkill } from "../skills/faratin-coaching.js";
import { HaggleEngineSkill } from "../skills/haggle-engine-skill.js";
import { registerSkill, resolveItemTags, SkillStack } from "../skills/skill-stack.js";
import { understand, understandFromStructured } from "../stages/understand.js";
import type {
  ConversationContext,
  ConversationTurn,
  CoreMemory,
  EngineDecision,
  NegotiationPhase,
  StageConfig,
} from "../types.js";
import { executePipeline } from "./pipeline.js";

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

const skill = new DefaultEngineSkill();
const adapter = new DeepSeekAdapter();

// Register built-in skills (once at startup)
// HaggleEngineSkill: free default — 4D utility, Faratin curves, rule-based decisions
registerSkill(new HaggleEngineSkill());
registerSkill(new ElectronicsKnowledgeSkill());
registerSkill(new FaratinCoachingSkill());

// Lazy-initialized DB-backed singletons (require db instance at first call)
let _checkpointStore: CheckpointStore | null = null;
const roundFactSink = new PgRoundFactSink();

function getCheckpointStore(db: Database): CheckpointStore {
  if (!_checkpointStore) {
    _checkpointStore = new CheckpointStore(new PgCheckpointPersistence(db));
  }
  return _checkpointStore;
}

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
    reasoningEnabled: true,
  };
}

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

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

  // --- Transaction ---
  const result = await db.transaction(async (tx) => {
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
      return buildIdempotentResultFromRound(existingInTx, dbSession);
    }

    // 4. Load rounds + reconstruct memory
    // Hydrate checkpoint store from DB for this session
    const checkpointStore = getCheckpointStore(tx as unknown as Database);
    await checkpointStore.hydrate(input.sessionId);

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

    // Compute coaching first (needed for CoreMemory.coaching which is still RefereeCoaching type)
    // Uses trust score from DB when counterpartyId is available
    const dummyMemory = buildInitialMemory(dbSession, facts);
    const coaching = await computeCoachingAsync(
      dummyMemory,
      facts,
      opponentPattern,
      DEFAULT_BUDDY_DNA,
      tx as unknown as Database,
      dbSession.counterpartyId,
    );

    // Full CoreMemory with actual coaching (RefereeCoaching, needed for validator + context-assembly)
    const memory = reconstructCoreMemory(dbSession, dbSession.negotiationAgentSnapshot, coaching);

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
      return await persistSpamRound(
        tx as unknown as Database,
        dbSession,
        input,
        nextRound,
        updatedMemory,
        coaching,
      );
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

    // 7. Intervention check
    const intervention = checkIntervention(
      { action: "COUNTER", reasoning: "pending" },
      currentPhase,
      updatedMemory.session.intervention_mode,
    );
    if (!intervention.autoApproved) {
      return await persistHoldRound(
        tx as unknown as Database,
        dbSession,
        input,
        nextRound,
        updatedMemory,
        coaching,
        currentPhase,
        intervention,
      );
    }

    // 8. Fetch L5 market signals
    const l5Provider = getL5SignalsProvider();
    const l5Signals = await l5Provider
      .getMarketSignals({
        category: "electronics",
        item_model: extractItemModel(dbSession.negotiationAgentSnapshot),
      })
      .catch((err) => {
        console.warn(
          "[executor] L5 signals fetch failed, continuing without:",
          (err as Error).message,
        );
        return undefined;
      }); // Non-fatal: continue without signals

    // 9. Execute 6-Stage Pipeline
    const stageConfig = buildDefaultStageConfig();
    const senderRole = role === "buyer" ? "seller" : "buyer";
    const understood = input.messageText
      ? {
          ...understand({ raw_message: input.messageText, sender_role: senderRole }),
          price_offer: input.offerPriceMinor,
        }
      : understandFromStructured(input.offerPriceMinor, senderRole);

    const previousMoves = extractPreviousMoves(dbRounds);
    const memoryBrief = await loadUserMemoryBrief(tx as unknown as Database, {
      userId: userIdForAgentRole(dbSession),
    });
    const evermemoBrief = await loadEvermemoBrief(tx as unknown as Database, {
      userId: userIdForAgentRole(dbSession),
      query: buildEvermemoRetrievalQuery(dbSession, input, understood),
      topK: 5,
    });

    // Build SkillStack for this session from the listing's category + tags.
    // Previously this read a nonexistent `dbSession.category` column, so every
    // session fell back to ["electronics"] and category-gated skills (e.g. the
    // iPhone/IMEI electronics knowledge skill) misfired on all items. Sourcing
    // from listing_context lets non-electronics items resolve only '*' skills.
    const skillStack = SkillStack.fromTags(resolveItemTags(updatedMemory.listing_context));

    const conversation = buildConversationContext(
      dbRounds,
      input.messageText,
      input.senderRole,
      input.offerPriceMinor,
    );

    const pipelineResult = await executePipeline(understood, input.offerPriceMinor, {
      skill,
      skillStack,
      config: stageConfig,
      memory: updatedMemory,
      facts: facts.slice(-5),
      opponent: opponentPattern ?? {
        aggression: 0.5,
        concession_rate: 0,
        preferred_tactics: ["unknown"],
        condition_flexibility: 0.5,
        estimated_floor: 0,
      },
      phase: currentPhase,
      buddyDna: DEFAULT_BUDDY_DNA,
      previousMoves,
      round: nextRound,
      briefing,
      memoEncoding: "codec",
      l5_signals: l5Signals,
      memory_brief: memoryBrief,
      evermemo_brief: evermemoBrief,
      conversation,
    });

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
  // self-contradictory transcripts. ACCEPT/CONFIRM use the incoming price.
  const outgoingPrice =
    decision.action === "REJECT" ? 0 : (decision.price ?? input.offerPriceMinor);
  const messageType = mapActionToMessageType(decision.action, nextRound);

  const createdRound = await createRound(tx, {
    sessionId: input.sessionId,
    roundNo: nextRound,
    senderRole: input.senderRole,
    messageType,
    priceminor: String(input.offerPriceMinor),
    counterPriceMinor: decision.action === "COUNTER" ? String(outgoingPrice) : undefined,
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
): Promise<RoundExecutionResult> {
  const holdDecision: EngineDecision = {
    action: "HOLD",
    reasoning: intervention.pendingReview?.reason ?? "Human approval required.",
  };
  return persistPipelineRound(tx, {
    dbSession,
    input,
    nextRound,
    decision: holdDecision,
    memory,
    coaching,
    validation: { passed: true, hardPassed: true, violations: [] },
    phase,
    message: "Waiting for your approval to proceed.",
    llmTokensUsed: 0,
    reasoningUsed: false,
  });
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function buildInitialMemory(
  dbSession: DbSession,
  _facts: import("../types.js").RoundFact[],
): CoreMemory {
  const strategy = dbSession.negotiationAgentSnapshot;
  const myTarget = extractNum(strategy, "p_target") ?? extractNum(strategy, "target_price") ?? 0;
  const myFloor = extractNum(strategy, "p_limit") ?? extractNum(strategy, "floor_price") ?? 0;
  const maxRounds = extractNum(strategy, "max_rounds") ?? 15;
  const currentOffer = dbSession.lastOfferPriceMinor
    ? Number(dbSession.lastOfferPriceMinor)
    : myTarget;
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
      opponent_offer: currentOffer,
      gap: 0,
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

/**
 * Build the conversation thread the LLM sees this round.
 *
 * - `opponent_message` is the message we are responding to right now (from
 *   `input.messageText` if the API caller supplied one, else a short price
 *   placeholder so the LLM still has *something* to react to).
 * - `recent_turns` is the last few persisted rounds rendered as buyer/seller
 *   chat turns. We use the column whose author actually generated the text
 *   (see the sender-semantics note in page.tsx: when a row has a generated
 *   `message`, the responder is the side OPPOSITE `sender_role`).
 */
function buildConversationContext(
  dbRounds: DbRound[],
  incomingMessage: string | undefined,
  incomingSenderRole: "BUYER" | "SELLER",
  incomingPriceMinor: number,
): ConversationContext {
  const turns: ConversationTurn[] = [];
  for (const r of dbRounds) {
    const raw = r as unknown as Record<string, unknown>;
    const text = typeof raw.message === "string" ? raw.message.trim() : "";
    if (!text) continue;
    // Generated message → speaker is the responder, i.e. opposite of sender_role.
    const speaker: "BUYER" | "SELLER" = r.senderRole === "BUYER" ? "SELLER" : "BUYER";
    const priceStr = r.counterPriceMinor ?? r.priceminor;
    const price = priceStr != null ? Number(priceStr) : undefined;
    turns.push({
      round: r.roundNo,
      sender: speaker,
      text,
      price_minor: Number.isFinite(price) ? price : undefined,
    });
  }

  // Cap to the last 6 turns so the prompt stays compact.
  const recent_turns = turns.slice(-6);

  const opponent_message =
    typeof incomingMessage === "string" && incomingMessage.trim().length > 0
      ? incomingMessage.trim()
      : undefined;

  // Always append the incoming offer as the most recent turn so the LLM sees
  // exactly what it's responding to. If no text, leave it implicit via memory.
  if (opponent_message) {
    recent_turns.push({
      round: (dbRounds[dbRounds.length - 1]?.roundNo ?? 0) + 1,
      sender: incomingSenderRole,
      text: opponent_message,
      price_minor: incomingPriceMinor,
    });
  }

  return { opponent_message, recent_turns };
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
