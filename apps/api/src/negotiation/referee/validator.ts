import type {
  ProtocolDecision,
  CoreMemory,
  RefereeCoaching,
  NegotiationPhase,
  ValidationResult,
  ValidationViolation,
} from '../types.js';
import type { ValidationMode } from '../config.js';
import { PHASE_ALLOWED_ACTIONS } from '../prompts/protocol-rules.js';

const STAGNATION_WINDOW = 4;
const STAGNATION_THRESHOLD = 0.02;
const ONE_SIDED_WINDOW = 3;
const LARGE_CONCESSION_MULTIPLIER = 2;

/**
 * Validate a negotiation move against 7 rules.
 * V1-V3: HARD violations (must block). V4-V7: SOFT violations (coach + retry).
 */
export function validateMove(
  move: ProtocolDecision,
  memory: CoreMemory,
  coaching: RefereeCoaching,
  previousMoves: ProtocolDecision[],
  currentPhase: NegotiationPhase,
  mode: ValidationMode = 'full',
): ValidationResult {
  const violations: ValidationViolation[] = [];

  // ─── V1 (HARD): Price exceeds floor ───
  if (move.price != null) {
    const { role } = memory.session;
    const floor = memory.boundaries.my_floor;
    if (role === 'buyer' && move.price > floor) {
      violations.push({
        rule: 'V1',
        severity: 'HARD',
        guidance: `Buyer price $${move.price} exceeds floor $${floor}. Must stay at or below floor.`,
        suggested_fix: { price: floor },
      });
    } else if (role === 'seller' && move.price < floor) {
      violations.push({
        rule: 'V1',
        severity: 'HARD',
        guidance: `Seller price $${move.price} below floor $${floor}. Must stay at or above floor.`,
        suggested_fix: { price: floor },
      });
    }
  }

  // ─── V2 (HARD): Action not allowed in current phase ───
  const allowedActions = PHASE_ALLOWED_ACTIONS[currentPhase];
  if (allowedActions && !allowedActions.includes(move.action)) {
    violations.push({
      rule: 'V2',
      severity: 'HARD',
      guidance: `Action '${move.action}' not allowed in ${currentPhase}. Allowed: ${allowedActions.join(', ')}.`,
      suggested_fix: { action: allowedActions[0] },
    });
  }

  // ─── V3 (HARD): COUNTER when no rounds remaining ───
  if (move.action === 'COUNTER' && memory.session.rounds_remaining === 0) {
    violations.push({
      rule: 'V3',
      severity: 'HARD',
      guidance: 'Cannot COUNTER with 0 rounds remaining. Must ACCEPT or REJECT.',
      suggested_fix: { action: 'ACCEPT' },
    });
  }

  // ─── Lite mode: skip V4-V7 SOFT rules ───
  if (mode === 'lite') {
    const hardViolations = violations.filter((v) => v.severity === 'HARD');
    return {
      passed: violations.length === 0,
      hardPassed: hardViolations.length === 0,
      violations,
    };
  }

  // ─── V4 (SOFT): Concession direction reversal ───
  if (move.price != null && previousMoves.length >= 2) {
    const myMoves = previousMoves.filter((m) => m.price != null);
    if (myMoves.length >= 2) {
      const prev = myMoves[myMoves.length - 1]!;
      const prevPrev = myMoves[myMoves.length - 2]!;
      if (prev.price != null && prevPrev.price != null) {
        const prevDirection = prev.price - prevPrev.price;
        const currDirection = move.price - prev.price;
        if (prevDirection !== 0 && currDirection !== 0 && Math.sign(prevDirection) !== Math.sign(currDirection)) {
          violations.push({
            rule: 'V4',
            severity: 'SOFT',
            guidance: 'Concession direction reversed. This may signal inconsistency to the opponent.',
          });
        }
      }
    }
  }

  // ─── V5 (SOFT): Stagnation — last N rounds concession < threshold ───
  if (previousMoves.length >= STAGNATION_WINDOW) {
    const recentWithPrice = previousMoves
      .filter((m) => m.price != null)
      .slice(-STAGNATION_WINDOW);
    if (recentWithPrice.length >= STAGNATION_WINDOW) {
      const first = recentWithPrice[0]!.price!;
      const last = recentWithPrice[recentWithPrice.length - 1]!.price!;
      const totalConcession = first !== 0 ? Math.abs(last - first) / Math.abs(first) : 0;
      if (totalConcession < STAGNATION_THRESHOLD) {
        violations.push({
          rule: 'V5',
          severity: 'SOFT',
          guidance: `Stagnation: last ${STAGNATION_WINDOW} rounds show < ${STAGNATION_THRESHOLD * 100}% concession. Consider a larger move.`,
        });
      }
    }
  }

  // ─── V6 (SOFT): One-sided concession ───
  if (previousMoves.length >= ONE_SIDED_WINDOW && move.price != null) {
    // Check if only one side is conceding by looking at gap changes
    // We approximate by checking if all our recent moves are concessions
    const recentMoves = previousMoves.filter((m) => m.price != null).slice(-ONE_SIDED_WINDOW);
    if (recentMoves.length >= ONE_SIDED_WINDOW) {
      const role = memory.session.role;
      let allConceding = true;
      for (let i = 1; i < recentMoves.length; i++) {
        const prev = recentMoves[i - 1]!.price!;
        const curr = recentMoves[i]!.price!;
        // Buyer concedes by raising price; seller concedes by lowering price
        const isConcession = role === 'buyer' ? curr > prev : curr < prev;
        if (!isConcession) {
          allConceding = false;
          break;
        }
      }
      if (allConceding) {
        violations.push({
          rule: 'V6',
          severity: 'SOFT',
          guidance: `One-sided concession detected for ${ONE_SIDED_WINDOW}+ rounds. Opponent may be exploiting.`,
        });
      }
    }
  }

  // ─── V7 (SOFT): Concession too large (> 2x recommended step) ───
  if (move.price != null && previousMoves.length > 0 && coaching.recommended_price > 0) {
    const lastMove = [...previousMoves].reverse().find((m) => m.price != null);
    if (lastMove?.price != null) {
      const actualStep = Math.abs(move.price - lastMove.price);
      const recommendedStep = Math.abs(coaching.recommended_price - lastMove.price);
      if (recommendedStep > 0 && actualStep > recommendedStep * LARGE_CONCESSION_MULTIPLIER) {
        violations.push({
          rule: 'V7',
          severity: 'SOFT',
          guidance: `Concession too large: $${actualStep.toFixed(2)} vs recommended ~$${recommendedStep.toFixed(2)}. May leave value on the table.`,
        });
      }
    }
  }

  const hardViolations = violations.filter((v) => v.severity === 'HARD');

  return {
    passed: violations.length === 0,
    hardPassed: hardViolations.length === 0,
    violations,
  };
}
