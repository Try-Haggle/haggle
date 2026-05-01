/**
 * llm-negotiation-executor.ts
 *
 * LLM-powered round execution pipeline. Same interface as negotiation-executor.ts
 * but routes through Step 56 RefereeService pipeline with optional LLM calls.
 *
 * Pipeline:
 *  1. Idempotency check
 *  2. BEGIN TX → SELECT FOR UPDATE
 *  3. Terminal/expiry check
 *  4. Load rounds → Memory reconstruction (DB → CoreMemory + RoundFact[] + OpponentPattern)
 *  5. Screening (spam check)
 *  6. Phase detection + transition
 *  7. Intervention check
 *  8. Decision: Skill evaluateOffer() → optional LLM call for BARGAINING
 *  9. RefereeService.process() (coach + validate + auto-fix + render)
 * 10. Phase transition
 * 11. Map ProtocolDecision → DB persist format
 * 12. Persist round + update session → COMMIT
 * 13. Dispatch events
 */

import { sql, type Database } from "@haggle/db";
import type { RoundExecutionInput, RoundExecutionResult } from "./negotiation-executor.js";
import { mapRawToDbSession } from "./negotiation-executor.js";
import { getRoundByIdempotencyKey, createRound, getRoundsBySessionId } from "../services/negotiation-round.service.js";
import { getSessionById, updateSessionState } from "../services/negotiation-session.service.js";
import { recordRoundConversationSignals } from "../services/conversation-signal-sink.js";
import type { EventDispatcher, PipelineEvent } from "./event-dispatcher.js";
import type { DbSession, DbRound } from "./session-reconstructor.js";

// Step 56 imports
import type {
  NegotiationPhase,
  ProtocolDecision,
  CoreMemory,
  RoundFact,
  OpponentPattern,
  RefereeCoaching,
  ValidationResult,
} from "../negotiation/types.js";
import { RefereeService } from "../negotiation/referee/referee-service.js";
import { DefaultEngineSkill } from "../negotiation/skills/default-engine-skill.js";
import { GrokFastAdapter } from "../negotiation/adapters/grok-fast-adapter.js";
import { screenMessage } from "../negotiation/screening/auto-screening.js";
import { tryTransition, detectPhaseEvent } from "../negotiation/phase/phase-machine.js";
import { checkIntervention } from "../negotiation/phase/human-intervention.js";
import { computeCoaching } from "../negotiation/referee/coach.js";

// Memory + Config
import {
  reconstructCoreMemory,
  reconstructRoundFacts,
  reconstructOpponentPattern,
  inferPhaseFromStatus,
  phaseToDbStatus,
  type DbRoundForMemory,
} from "../negotiation/memory/memory-reconstructor.js";
import { DEFAULT_BUDDY_DNA, shouldUseReasoning } from "../negotiation/config.js";

// LLM client
import { callLLM } from "../negotiation/adapters/xai-client.js";

// ---------------------------------------------------------------------------
// Singletons (stateless, safe to reuse)
// ---------------------------------------------------------------------------

const refereeService = new RefereeService();
const skill = new DefaultEngineSkill();
const adapter = new GrokFastAdapter();

// ---------------------------------------------------------------------------
// Terminal statuses
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = new Set(["ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"]);

// ---------------------------------------------------------------------------
// Main executor
// ---------------------------------------------------------------------------

export async function executeLLMNegotiationRound(
  db: Database,
  input: RoundExecutionInput,
  eventDispatcher?: EventDispatcher,
): Promise<RoundExecutionResult> {
  // --- Idempotency check (outside transaction for speed) ---
  const existingRound = await getRoundByIdempotencyKey(db, input.idempotencyKey);
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

    // 3. Double-check idempotency inside TX
    const existingInTx = await getRoundByIdempotencyKey(tx as unknown as Database, input.idempotencyKey);
    if (existingInTx) {
      return buildIdempotentResultFromRound(existingInTx, dbSession);
    }

    // 4. Load rounds + reconstruct memory
    const dbRounds = await getRoundsBySessionId(tx as unknown as Database, input.sessionId) as DbRound[];
    const nextRound = dbSession.currentRound + 1;

    // Convert DbRound to DbRoundForMemory
    const roundsForMemory: DbRoundForMemory[] = dbRounds.map((r) => {
      const raw = r as unknown as Record<string, unknown>;
      return {
        roundNo: r.roundNo,
        senderRole: r.senderRole as 'BUYER' | 'SELLER',
        priceminor: r.priceminor,
        counterPriceMinor: r.counterPriceMinor,
        decision: r.decision,
        utility: r.utility as DbRound['utility'],
        metadata: r.metadata,
        createdAt: r.createdAt,
        coaching: (raw.coaching as Record<string, unknown> | null) ?? null,
        phaseAtRound: (raw.phase_at_round as string | null) ?? null,
      };
    });

    const role = dbSession.role.toLowerCase() as 'buyer' | 'seller';
    const facts = reconstructRoundFacts(roundsForMemory, dbSession.role);
    const opponentPattern = reconstructOpponentPattern(facts, role);

    // Compute coaching first (needed for CoreMemory)
    const dummyMemory = buildInitialMemory(dbSession, facts, opponentPattern);
    const coaching = computeCoaching(dummyMemory, facts, opponentPattern, DEFAULT_BUDDY_DNA);

    // Full CoreMemory with actual coaching
    const memory = reconstructCoreMemory(dbSession, dbSession.strategySnapshot, coaching);

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
      // Spam → immediate REJECT
      const spamDecision: ProtocolDecision = {
        action: 'REJECT',
        reasoning: `Screening blocked: ${screening.reason}`,
      };
      return await persistLLMRound(tx as unknown as Database, {
        dbSession,
        input,
        nextRound,
        decision: spamDecision,
        memory: updatedMemory,
        coaching,
        validation: { passed: true, hardPassed: true, violations: [] },
        phase: updatedMemory.session.phase,
        message: 'This offer has been automatically declined.',
        llmTokensUsed: 0,
        reasoningUsed: false,
      });
    }

    // 6. Phase detection
    let currentPhase = updatedMemory.session.phase;
    const isNearDeal = updatedMemory.boundaries.gap > 0 &&
      (updatedMemory.boundaries.gap / Math.abs(updatedMemory.boundaries.my_target - updatedMemory.boundaries.my_floor || 1)) < 0.10;

    const phaseEvent = detectPhaseEvent('COUNTER', currentPhase, isNearDeal, false);
    if (phaseEvent) {
      const transition = tryTransition(currentPhase, phaseEvent);
      if (transition.transitioned) {
        currentPhase = transition.to;
      }
    }

    // 7. Intervention check
    const intervention = checkIntervention(
      { action: 'COUNTER', reasoning: 'pending' },
      currentPhase,
      updatedMemory.session.intervention_mode,
    );
    if (!intervention.autoApproved) {
      // HOLD — requires human approval
      const holdDecision: ProtocolDecision = {
        action: 'HOLD',
        reasoning: intervention.pendingReview?.reason ?? 'Human approval required.',
      };
      return await persistLLMRound(tx as unknown as Database, {
        dbSession,
        input,
        nextRound,
        decision: holdDecision,
        memory: updatedMemory,
        coaching,
        validation: { passed: true, hardPassed: true, violations: [] },
        phase: currentPhase,
        message: 'Waiting for your approval to proceed.',
        llmTokensUsed: 0,
        reasoningUsed: false,
      });
    }

    // 8. Decision
    let decision: ProtocolDecision;
    let llmTokensUsed = 0;
    let reasoningUsed = false;

    // 8a. Skill evaluateOffer (rule-based baseline, LLM augments)
    decision = await skill.evaluateOffer(
      updatedMemory,
      { price: input.offerPriceMinor },
      facts,
      currentPhase,
    );

    // 8b. BARGAINING + COUNTER → LLM augmentation
    if (currentPhase === 'BARGAINING' && decision.action === 'COUNTER') {
      try {
        // Determine reasoning mode
        const useReasoning = shouldUseReasoning({
          gap: updatedMemory.boundaries.gap,
          gapRatio: updatedMemory.boundaries.gap /
            Math.abs(updatedMemory.boundaries.my_target - updatedMemory.boundaries.my_floor || 1),
          coachWarnings: coaching.warnings,
          opponentPattern: coaching.opponent_pattern,
          softViolationCount: 0, // Will be computed after first validation
        });

        reasoningUsed = useReasoning;

        // Build prompts
        const systemPrompt = adapter.buildSystemPrompt(skill.getLLMContext());
        const userPrompt = adapter.buildUserPrompt(updatedMemory, facts.slice(-5));

        // Call LLM
        const llmResponse = await callLLM(systemPrompt, userPrompt, {
          reasoning: useReasoning,
          correlationId: input.sessionId,
        });

        llmTokensUsed = llmResponse.usage.prompt_tokens + llmResponse.usage.completion_tokens;

        // Parse response
        const llmDecision = adapter.parseResponse(llmResponse.content);

        // Use LLM decision if it looks reasonable (has a price for COUNTER)
        if (llmDecision.action === 'COUNTER' && llmDecision.price && llmDecision.price > 0) {
          decision = llmDecision;
        } else if (['ACCEPT', 'REJECT', 'HOLD'].includes(llmDecision.action)) {
          decision = llmDecision;
        }
        // Otherwise, keep skill decision as fallback
      } catch (err) {
        // LLM failure → graceful fallback to skill decision
        console.warn(
          `[llm-negotiation-executor] LLM call failed for session ${input.sessionId}, falling back to rule-based:`,
          err instanceof Error ? err.message : err,
        );
        // decision already set from skill.evaluateOffer()
      }
    }

    // 9. RefereeService.process() — coach + validate + auto-fix + render
    const refereeResult = await refereeService.process({
      decision,
      memory: updatedMemory,
      recentFacts: facts.slice(-5),
      opponentPattern,
      buddyDna: DEFAULT_BUDDY_DNA,
      previousMoves: extractPreviousMoves(dbRounds),
      phase: currentPhase,
    });

    decision = refereeResult.decision;

    // 10. Phase transition based on final decision
    const postDecisionEvent = detectPhaseEvent(
      decision.action,
      currentPhase,
      isNearDeal || decision.action === 'ACCEPT',
      decision.action === 'CONFIRM',
    );
    if (postDecisionEvent) {
      const transition = tryTransition(currentPhase, postDecisionEvent);
      if (transition.transitioned) {
        currentPhase = transition.to;
      }
    }

    // 11-12. Persist
    return await persistLLMRound(tx as unknown as Database, {
      dbSession,
      input,
      nextRound,
      decision,
      memory: updatedMemory,
      coaching: refereeResult.coaching,
      validation: refereeResult.validation,
      phase: currentPhase,
      message: refereeResult.move.message,
      llmTokensUsed,
      reasoningUsed,
    });
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
        console.error("[llm-negotiation-executor] event dispatch error:", err);
      });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Persist helper
// ---------------------------------------------------------------------------

interface PersistParams {
  dbSession: DbSession;
  input: RoundExecutionInput;
  nextRound: number;
  decision: ProtocolDecision;
  memory: CoreMemory;
  coaching: RefereeCoaching;
  validation: ValidationResult;
  phase: NegotiationPhase;
  message: string;
  llmTokensUsed: number;
  reasoningUsed: boolean;
}

async function persistLLMRound(
  tx: Database,
  params: PersistParams,
): Promise<RoundExecutionResult> {
  const { dbSession, input, nextRound, decision, memory, coaching, validation, phase, message, llmTokensUsed, reasoningUsed } = params;

  // Map ProtocolDecision.action → DB decision
  const dbDecision = mapActionToDbDecision(decision.action);
  const dbStatus = phaseToDbStatus(phase, decision.action, dbSession.roundsNoConcession);
  const outgoingPrice = decision.price ?? input.offerPriceMinor;

  // Map message type
  const messageType = mapActionToMessageType(decision.action, nextRound);

  const createdRound = await createRound(tx, {
    sessionId: input.sessionId,
    roundNo: nextRound,
    senderRole: input.senderRole,
    messageType,
    priceminor: String(input.offerPriceMinor),
    counterPriceMinor: decision.action === 'COUNTER' ? String(outgoingPrice) : undefined,
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
      engine: 'llm',
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

  // Track concession
  const roundsNoConcession = decision.action === 'COUNTER' && decision.price
    ? (Math.abs(decision.price - (Number(dbSession.lastOfferPriceMinor) || 0)) < 1
        ? dbSession.roundsNoConcession + 1
        : 0)
    : dbSession.roundsNoConcession;

  const updated = await updateSessionState(
    tx,
    input.sessionId,
    dbSession.version,
    {
      status: dbStatus as "CREATED" | "ACTIVE" | "NEAR_DEAL" | "STALLED" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "SUPERSEDED" | "WAITING",
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
    },
  );

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
    // Extended response for LLM executor
    message,
    phase,
    reasoningUsed,
  } as RoundExecutionResult;
}

async function recordSignalsForCreatedRound(
  tx: Database,
  params: PersistParams,
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
    engine: "llm",
    idempotencyKey: input.idempotencyKey,
    decision: params.decision.action,
  });
}

// ---------------------------------------------------------------------------
// Idempotent result helpers
// ---------------------------------------------------------------------------

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
      u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0,
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
      u_total: 0, v_p: 0, v_t: 0, v_r: 0, v_s: 0,
    },
    sessionStatus: dbSession.status,
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/** ProtocolDecision.action → DB DecisionAction */
function mapActionToDbDecision(
  action: string,
): "ACCEPT" | "COUNTER" | "REJECT" | "NEAR_DEAL" | "ESCALATE" {
  switch (action) {
    case 'COUNTER': return 'COUNTER';
    case 'ACCEPT': return 'ACCEPT';
    case 'REJECT': return 'REJECT';
    case 'HOLD': return 'NEAR_DEAL';
    case 'CONFIRM': return 'ACCEPT';
    case 'ESCALATE': return 'ESCALATE';
    default: return 'COUNTER';
  }
}

/** ProtocolDecision.action → DB MessageType */
function mapActionToMessageType(
  action: string,
  roundNo: number,
): "OFFER" | "COUNTER" | "ACCEPT" | "REJECT" | "ESCALATE" {
  switch (action) {
    case 'ACCEPT':
    case 'CONFIRM':
      return 'ACCEPT';
    case 'REJECT':
      return 'REJECT';
    case 'HOLD':
    case 'DISCOVER':
    case 'ESCALATE':
      return 'ESCALATE';
    default:
      return roundNo === 1 ? 'OFFER' : 'COUNTER';
  }
}

/** Extract previous ProtocolDecision[] from DB rounds for referee validation */
function extractPreviousMoves(dbRounds: DbRound[]): ProtocolDecision[] {
  return dbRounds
    .filter((r) => r.decision)
    .map((r) => ({
      action: r.decision as ProtocolDecision['action'],
      price: r.counterPriceMinor ? Number(r.counterPriceMinor) : undefined,
      reasoning: (r.metadata as Record<string, unknown>)?.reasoning as string ?? '',
      tactic_used: (r.metadata as Record<string, unknown>)?.tactic as string | undefined,
    }));
}

/** Compute price deviation % from target */
function computePriceDeviation(offerPrice: number, targetPrice: number): number {
  if (targetPrice === 0) return 0;
  return Math.abs((offerPrice - targetPrice) / targetPrice) * 100;
}

/** Build a minimal CoreMemory for initial coaching computation */
function buildInitialMemory(
  dbSession: DbSession,
  facts: RoundFact[],
  opponentPattern: OpponentPattern | null,
): CoreMemory {
  const strategy = dbSession.strategySnapshot;
  const myTarget = extractNum(strategy, 'p_target') ?? extractNum(strategy, 'target_price') ?? 0;
  const myFloor = extractNum(strategy, 'p_limit') ?? extractNum(strategy, 'floor_price') ?? 0;
  const maxRounds = extractNum(strategy, 'max_rounds') ?? 15;
  const currentOffer = dbSession.lastOfferPriceMinor ? Number(dbSession.lastOfferPriceMinor) : myTarget;
  const role = dbSession.role.toLowerCase() as 'buyer' | 'seller';

  const phase = inferPhaseFromStatus(dbSession.status, dbSession.currentRound, dbSession.roundsNoConcession);

  return {
    session: {
      session_id: dbSession.id,
      phase,
      round: dbSession.currentRound,
      rounds_remaining: Math.max(0, maxRounds - dbSession.currentRound),
      role,
      max_rounds: maxRounds,
      intervention_mode: 'FULL_AUTO',
    },
    boundaries: {
      my_target: myTarget,
      my_floor: myFloor,
      current_offer: currentOffer,
      opponent_offer: currentOffer,
      gap: 0,
    },
    terms: { active: [], resolved_summary: '' },
    coaching: {
      recommended_price: 0,
      acceptable_range: { min: 0, max: 0 },
      suggested_tactic: '',
      hint: '',
      opponent_pattern: 'UNKNOWN',
      convergence_rate: 0,
      time_pressure: 0,
      utility_snapshot: { u_price: 0, u_time: 0, u_risk: 0, u_quality: 0, u_total: 0 },
      strategic_hints: [],
      warnings: [],
    },
    buddy_dna: DEFAULT_BUDDY_DNA,
    skill_summary: 'electronics-iphone-pro-v1',
  };
}

function extractNum(obj: Record<string, unknown>, key: string): number | null {
  const val = obj[key];
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event helpers (same logic as negotiation-executor.ts)
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

  return null;
}
