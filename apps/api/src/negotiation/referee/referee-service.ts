import type {
  CoreMemory,
  RoundFact,
  OpponentPattern,
  BuddyDNA,
  ProtocolDecision,
  NegotiationMove,
  NegotiationPhase,
  RefereeCoaching,
  ValidationResult,
} from '../types.js';
import { computeCoaching } from './coach.js';
import { validateMove } from './validator.js';
import { TemplateMessageRenderer } from '../rendering/message-renderer.js';

const MAX_RETRY = 2;

export interface RefereeResult {
  decision: ProtocolDecision;
  move: NegotiationMove;
  coaching: RefereeCoaching;
  validation: ValidationResult;
  retryCount: number;
}

/**
 * Referee Service — orchestrates the full decision pipeline:
 * 1. Compute coaching
 * 2. Validate decision
 * 3. If HARD violation → apply suggested_fix and re-validate (up to MAX_RETRY)
 * 4. Render message via BuddyTone
 */
export class RefereeService {
  private renderer = new TemplateMessageRenderer();

  async process(params: {
    decision: ProtocolDecision;
    memory: CoreMemory;
    recentFacts: RoundFact[];
    opponentPattern: OpponentPattern | null;
    buddyDna: BuddyDNA;
    previousMoves: ProtocolDecision[];
    phase: NegotiationPhase;
    locale?: string;
  }): Promise<RefereeResult> {
    const { memory, recentFacts, opponentPattern, buddyDna, previousMoves, phase, locale } = params;
    let decision = { ...params.decision };

    // 1. Compute coaching
    const coaching = computeCoaching(memory, recentFacts, opponentPattern, buddyDna);

    // 2. Validate + auto-fix loop
    let validation: ValidationResult;
    let retryCount = 0;

    validation = validateMove(decision, memory, coaching, previousMoves, phase);

    while (!validation.hardPassed && retryCount < MAX_RETRY) {
      // Apply suggested fixes from HARD violations only
      const hardViolations = validation.violations.filter((v) => v.severity === 'HARD');

      for (const violation of hardViolations) {
        if (violation.suggested_fix) {
          decision = { ...decision, ...violation.suggested_fix };
        }
      }

      retryCount++;
      validation = validateMove(decision, memory, coaching, previousMoves, phase);
    }

    // 3. Render message using BuddyTone
    const message = this.renderer.render(decision, {
      phase,
      role: memory.session.role,
      locale: locale ?? 'en',
      activeTerms: memory.terms.active,
      tone: buddyDna.tone,
    });

    const move: NegotiationMove = {
      ...decision,
      message,
    };

    return {
      decision,
      move,
      coaching,
      validation,
      retryCount,
    };
  }
}
