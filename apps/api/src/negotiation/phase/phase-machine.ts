import type { NegotiationPhase, PhaseTransitionEvent } from '../types.js';

/** Phase transition rules */
const TRANSITIONS: Record<NegotiationPhase, Partial<Record<PhaseTransitionEvent, NegotiationPhase>>> = {
  DISCOVERY: {
    INITIAL_OFFER_MADE: 'OPENING',
    TIMEOUT: 'OPENING', // auto-advance after discovery timeout
    ABORT: 'SETTLEMENT',
  },
  OPENING: {
    COUNTER_OFFER_MADE: 'BARGAINING',
    TIMEOUT: 'BARGAINING',
    ABORT: 'SETTLEMENT',
  },
  BARGAINING: {
    NEAR_DEAL_DETECTED: 'CLOSING',
    TIMEOUT: 'CLOSING',
    ABORT: 'SETTLEMENT',
    REVERT_REQUESTED: 'OPENING',
  },
  CLOSING: {
    BOTH_CONFIRMED: 'SETTLEMENT',
    REVERT_REQUESTED: 'BARGAINING',
    TIMEOUT: 'SETTLEMENT',
    ABORT: 'SETTLEMENT',
  },
  SETTLEMENT: {
    // Terminal state — no transitions
  },
};

export interface PhaseTransitionResult {
  from: NegotiationPhase;
  to: NegotiationPhase;
  event: PhaseTransitionEvent;
  transitioned: boolean;
}

/**
 * Attempt a phase transition. Returns result indicating if transition occurred.
 */
export function tryTransition(
  currentPhase: NegotiationPhase,
  event: PhaseTransitionEvent,
): PhaseTransitionResult {
  const phaseTransitions = TRANSITIONS[currentPhase];
  const nextPhase = phaseTransitions?.[event];

  if (!nextPhase) {
    return {
      from: currentPhase,
      to: currentPhase,
      event,
      transitioned: false,
    };
  }

  return {
    from: currentPhase,
    to: nextPhase,
    event,
    transitioned: true,
  };
}

/** Check if a phase is terminal */
export function isTerminal(phase: NegotiationPhase): boolean {
  return phase === 'SETTLEMENT';
}

/** Get valid events for a given phase */
export function getValidEvents(phase: NegotiationPhase): PhaseTransitionEvent[] {
  const transitions = TRANSITIONS[phase];
  return Object.keys(transitions) as PhaseTransitionEvent[];
}

/**
 * Detect which phase transition event should fire based on a ProtocolDecision.
 */
export function detectPhaseEvent(
  action: string,
  currentPhase: NegotiationPhase,
  isNearDeal: boolean,
  bothConfirmed: boolean,
): PhaseTransitionEvent | null {
  if (bothConfirmed && currentPhase === 'CLOSING') return 'BOTH_CONFIRMED';
  if (isNearDeal && currentPhase === 'BARGAINING') return 'NEAR_DEAL_DETECTED';

  if (currentPhase === 'DISCOVERY' && action === 'COUNTER') return 'INITIAL_OFFER_MADE';
  if (currentPhase === 'OPENING' && action === 'COUNTER') return 'COUNTER_OFFER_MADE';

  return null;
}
