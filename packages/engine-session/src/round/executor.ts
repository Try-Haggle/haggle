import {
  computeUtility,
  makeDecision,
  computeCounterOffer,
  computeDynamicBeta,
  shouldAcceptNext,
  computeUtilitySpaceCounterOffer,
  type UtilityResult,
  type DecisionAction,
} from '@haggle/engine-core';
import { assembleContext } from '../strategy/assembler.js';
import { transition } from '../session/state-machine.js';
import { trackConcession } from './concession.js';
import { classifyMove } from './classify-move.js';
import { createOpponentModel, updateOpponentModel } from './opponent-model.js';
import { SessionError } from '../errors/types.js';
import type { MasterStrategy, RoundData } from '../strategy/types.js';
import type { NegotiationSession, NegotiationRound } from '../session/types.js';
import type { HnpMessage, HnpMessageType } from '../protocol/types.js';
import type { RoundResult, EscalationRequest, NegotiationRange } from './types.js';

/** Map engine DecisionAction to outgoing HNP message type. */
function decisionToMessageType(action: DecisionAction): HnpMessageType {
  switch (action) {
    case 'ACCEPT': return 'ACCEPT';
    case 'REJECT': return 'REJECT';
    case 'COUNTER': return 'COUNTER';
    case 'NEAR_DEAL': return 'COUNTER'; // NEAR_DEAL still counters, just flagged internally
    case 'ESCALATE': return 'ESCALATE';
  }
}

/** Determine the session event from the decision action and utility context. */
function decisionToSessionEvent(
  action: DecisionAction,
  isFirstRound: boolean,
): import('../session/state-machine.js').SessionEvent {
  if (isFirstRound) return 'first_offer';
  switch (action) {
    case 'ACCEPT': return 'user_accept';
    case 'REJECT': return 'user_reject';
    case 'NEAR_DEAL': return 'near_deal';
    case 'ESCALATE': return 'escalate';
    case 'COUNTER': return 'counter';
  }
}

/** Number of recent rounds to include in escalation requests. */
const ESCALATION_CONTEXT_ROUNDS = 5;
/** Number of consecutive no-concession rounds to trigger STALLED. */
const STALLED_THRESHOLD = 2;

/**
 * Execute a single negotiation round.
 *
 * Pipeline:
 * 1. Assemble NegotiationContext from strategy + round data
 * 2. Compute utility via engine-core
 * 3. Make decision (ACCEPT / COUNTER / REJECT / NEAR_DEAL / ESCALATE)
 * 4. If COUNTER or NEAR_DEAL:
 *    4a. Compute dynamic beta (competition + opponent concession rate)
 *    4b. Compute counter-offer (utility-space or price-space)
 *    4c. AC_next check: if incoming offer already better than counter → ACCEPT
 * 5. Track concession, classify move, update opponent model, update session state
 * 6. Generate outgoing HNP message
 * 7. Return RoundResult
 */
export function executeRound(
  session: NegotiationSession,
  strategy: MasterStrategy,
  incomingOffer: HnpMessage,
  roundData: RoundData,
): RoundResult {
  // 1. Assemble context
  const ctx = assembleContext(strategy, roundData);

  // 2. Compute utility
  const utility: UtilityResult = computeUtility(ctx);

  // 2a. Propagate engine-core errors
  if (utility.error) {
    return {
      message: incomingOffer,
      utility,
      decision: 'REJECT',
      session,
      error: SessionError.ENGINE_ERROR,
    };
  }

  // 3. Make decision
  let decision: DecisionAction = makeDecision(
    utility,
    { u_threshold: strategy.u_threshold, u_aspiration: strategy.u_aspiration },
    { rounds_no_concession: session.rounds_no_concession },
  ).action;

  // 4. Compute counter-offer price if applicable
  let counterPrice: number | undefined;
  let acNextTriggered = false;

  if (decision === 'COUNTER' || decision === 'NEAR_DEAL') {
    // 4a. Compute dynamic beta
    const opponentRate = session.opponent_model?.concession_rate ?? 0;
    const nCompetitors = roundData.competition?.n_competitors ?? 0;

    const dynamicBeta = computeDynamicBeta({
      beta_base: strategy.beta,
      n_competitors: nCompetitors,
      opponent_concession_rate: opponentRate,
      kappa: strategy.kappa,
      lambda: strategy.lambda,
    });

    // 4b. Compute counter-offer
    if (strategy.use_utility_space) {
      counterPrice = computeUtilitySpaceCounterOffer({
        u_aspiration: strategy.u_aspiration,
        u_threshold: strategy.u_threshold,
        t: roundData.t_elapsed,
        T: strategy.t_deadline,
        beta: dynamicBeta,
        weights: strategy.weights,
        v_t: utility.v_t,
        v_r: utility.v_r,
        v_s: utility.v_s,
        p_target: strategy.p_target,
        p_limit: strategy.p_limit,
      });
    } else {
      const p_start = session.last_offer_price ?? strategy.p_target;
      counterPrice = computeCounterOffer({
        p_start,
        p_limit: strategy.p_limit,
        t: roundData.t_elapsed,
        T: strategy.t_deadline,
        beta: dynamicBeta,
      });
    }

    // 4c. AC_next check
    if (shouldAcceptNext(incomingOffer.price, counterPrice, strategy.p_target, strategy.p_limit)) {
      decision = 'ACCEPT';
      counterPrice = undefined;
      acNextTriggered = true;
    }
  }

  // 5. Track concession, classify move, update opponent model, update session state
  const negotiationRange: NegotiationRange = {
    p_target: strategy.p_target,
    p_limit: strategy.p_limit,
  };
  const updatedSession = updateSession(
    session,
    incomingOffer,
    utility,
    decision,
    counterPrice,
    negotiationRange,
  );

  // 6. Generate outgoing HNP message
  const outgoingPrice = counterPrice ?? incomingOffer.price;
  const message: HnpMessage = {
    session_id: session.session_id,
    round: updatedSession.current_round,
    type: decisionToMessageType(decision),
    price: outgoingPrice,
    sender_role: session.role,
    timestamp: Date.now(),
  };

  // 7. Build escalation request if needed
  let escalation: EscalationRequest | undefined;
  if (decision === 'ESCALATE') {
    const recentRounds = updatedSession.rounds.slice(-ESCALATION_CONTEXT_ROUNDS);
    escalation = {
      type: updatedSession.rounds_no_concession >= STALLED_THRESHOLD
        ? 'STRATEGY_REVIEW'
        : 'UNKNOWN_PROPOSAL',
      session_id: session.session_id,
      context: buildEscalationContext(updatedSession, strategy),
      current_strategy: strategy,
      recent_rounds: recentRounds,
    };
  }

  return {
    message,
    utility,
    decision,
    session: updatedSession,
    escalation,
    ...(acNextTriggered ? { ac_next_triggered: true } : {}),
  };
}

/**
 * Create an updated session with the new round recorded and state machine advanced.
 * Returns a new object — does not mutate the input session.
 */
function updateSession(
  session: NegotiationSession,
  incomingOffer: HnpMessage,
  utility: UtilityResult,
  decision: DecisionAction,
  counterPrice: number | undefined,
  negotiationRange: NegotiationRange,
): NegotiationSession {
  const nextRoundNo = session.current_round + 1;
  const isFirstRound = session.status === 'CREATED';

  // Track concession from incoming offer (existing logic)
  let roundsNoConcession = session.rounds_no_concession;
  if (session.last_offer_price !== null) {
    const conceded = trackConcession(
      session.last_offer_price,
      incomingOffer.price,
      incomingOffer.sender_role,
    );
    roundsNoConcession = conceded ? 0 : roundsNoConcession + 1;
  }

  // Classify opponent move and update opponent model
  let opponentModel = session.opponent_model ?? createOpponentModel();
  if (session.last_offer_price !== null) {
    const move = classifyMove(
      session.last_offer_price,
      incomingOffer.price,
      incomingOffer.sender_role,
      negotiationRange,
    );
    opponentModel = updateOpponentModel(opponentModel, move);
  }

  // Determine session event and advance state machine
  let event = decisionToSessionEvent(decision, isFirstRound);

  // Check for STALLED condition: 2+ rounds of no concession overrides to 'stalled'
  if (roundsNoConcession >= STALLED_THRESHOLD && event === 'counter') {
    event = 'stalled';
  }

  const newStatus = transition(session.status, event) ?? session.status;

  // Record the round
  const round: NegotiationRound = {
    round_no: nextRoundNo,
    message: incomingOffer,
    utility,
    decision,
    counter_price: counterPrice,
  };

  return {
    ...session,
    status: newStatus,
    current_round: nextRoundNo,
    rounds: [...session.rounds, round],
    rounds_no_concession: roundsNoConcession,
    last_offer_price: incomingOffer.price,
    last_utility: utility,
    updated_at: Date.now(),
    opponent_model: opponentModel,
  };
}

/** Build a human-readable escalation context string for the LLM. */
function buildEscalationContext(session: NegotiationSession, strategy: MasterStrategy): string {
  const lines = [
    `Session ${session.session_id} — Role: ${session.role}`,
    `Status: ${session.status} — Round: ${session.current_round}`,
    `Rounds without concession: ${session.rounds_no_concession}`,
    `Strategy persona: ${strategy.persona}`,
    `Target: ${strategy.p_target}, Limit: ${strategy.p_limit}`,
    `Utility thresholds: aspiration=${strategy.u_aspiration}, threshold=${strategy.u_threshold}`,
  ];
  if (session.last_utility) {
    lines.push(`Last utility: ${session.last_utility.u_total.toFixed(4)}`);
  }
  return lines.join('\n');
}
