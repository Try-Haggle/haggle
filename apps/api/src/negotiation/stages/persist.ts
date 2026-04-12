/**
 * Stage 6: Persist
 *
 * DB persistence + phase transition + memo hash recording.
 * This is the only stage with DB dependency.
 * When used in pure-pipeline mode (tests, external agents), persistFn is injected.
 */

import type { PersistInput, PersistOutput } from '../pipeline/types.js';
import type { NegotiationPhase } from '../types.js';
import { detectPhaseEvent, tryTransition } from '../phase/phase-machine.js';

/**
 * Persist round results.
 *
 * 1. Detect post-decision phase transition
 * 2. Call persistFn if provided (DB write)
 * 3. Return phase transition info and session completion flag
 */
export function persist(
  input: PersistInput,
  currentPhase: NegotiationPhase,
): PersistOutput {
  const { decision, round_number } = input;
  const { final_decision } = decision;
  const action = final_decision.action;

  // Detect phase transition based on final decision
  const isNearDeal = action === 'ACCEPT';
  const bothConfirmed = action === 'CONFIRM';

  const phaseEvent = detectPhaseEvent(action, currentPhase, isNearDeal, bothConfirmed);
  let phaseTransition: PersistOutput['phase_transition'];

  if (phaseEvent) {
    const result = tryTransition(currentPhase, phaseEvent);
    if (result.transitioned) {
      phaseTransition = {
        from: result.from,
        to: result.to,
        event: result.event,
      };
    }
  }

  // Session done when entering SETTLEMENT
  const sessionDone = phaseTransition?.to === 'SETTLEMENT' ||
    action === 'ACCEPT' ||
    action === 'REJECT';

  return {
    phase_transition: phaseTransition,
    session_done: sessionDone,
  };
}

/**
 * Persist with an async DB callback.
 * Used by the pipeline executor for actual DB writes.
 */
export async function persistWithDb(
  input: PersistInput,
  currentPhase: NegotiationPhase,
  persistFn: (input: PersistInput) => Promise<PersistOutput>,
): Promise<PersistOutput> {
  const pureResult = persist(input, currentPhase);

  // Delegate DB write to the injected function
  const dbResult = await persistFn(input);

  // Merge: pure logic provides phase transition, DB provides actual persistence state
  return {
    phase_transition: pureResult.phase_transition ?? dbResult.phase_transition,
    session_done: pureResult.session_done || dbResult.session_done,
  };
}
