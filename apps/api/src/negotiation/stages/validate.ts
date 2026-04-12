/**
 * Stage 4: Validate
 *
 * Wraps RefereeService validation + auto-fix loop.
 * Builds RoundExplainability structure for audit trail.
 */

import type { ValidateInput, ValidateOutput } from '../pipeline/types.js';
import type {
  ProtocolDecision,
  RoundExplainability,
  ValidationResult,
  RefereeCoaching,
  CoreMemory,
  NegotiationPhase,
} from '../types.js';
import { validateMove } from '../referee/validator.js';

const MAX_RETRY = 2;

/**
 * Validate a decision against referee rules and build explainability.
 *
 * 1. Run validateMove() (V1-V7 rules)
 * 2. Auto-fix HARD violations (up to MAX_RETRY)
 * 3. Build RoundExplainability for audit
 */
export function validateStage(
  input: ValidateInput,
  previousMoves: ProtocolDecision[],
): ValidateOutput {
  const { decision: decideOutput, coaching, memory, phase } = input;
  let currentDecision = { ...decideOutput.decision };

  // Validate + auto-fix loop
  let validation: ValidationResult;
  let retryCount = 0;
  let autoFixApplied = false;
  const allViolations: import('../types.js').ValidationViolation[] = [];

  validation = validateMove(currentDecision, memory, coaching, previousMoves, phase);
  allViolations.push(...validation.violations);

  while (!validation.hardPassed && retryCount < MAX_RETRY) {
    const hardViolations = validation.violations.filter((v) => v.severity === 'HARD');
    for (const violation of hardViolations) {
      if (violation.suggested_fix) {
        currentDecision = { ...currentDecision, ...violation.suggested_fix };
        autoFixApplied = true;
      }
    }
    retryCount++;
    validation = validateMove(currentDecision, memory, coaching, previousMoves, phase);
    allViolations.push(...validation.violations);
  }

  // Build RoundExplainability — use all violations (including pre-fix) for audit
  const explainability = buildExplainability(
    memory.session.round,
    coaching,
    decideOutput.source,
    decideOutput.decision,
    currentDecision,
    allViolations,
    validation,
    autoFixApplied,
  );

  return {
    final_decision: currentDecision,
    validation,
    auto_fix_applied: autoFixApplied,
    retry_count: retryCount,
    explainability,
  };
}

// ---------------------------------------------------------------------------
// Explainability builder
// ---------------------------------------------------------------------------

function buildExplainability(
  round: number,
  coaching: RefereeCoaching,
  source: 'llm' | 'skill',
  originalDecision: ProtocolDecision,
  finalDecision: ProtocolDecision,
  allViolations: import('../types.js').ValidationViolation[],
  finalValidation: ValidationResult,
  autoFixApplied: boolean,
): RoundExplainability {
  // Determine referee action — use autoFixApplied flag (not just final violations)
  let refereeAction: RoundExplainability['referee_result']['action'];
  if (autoFixApplied) {
    refereeAction = 'AUTO_FIX';
  } else if (!finalValidation.hardPassed) {
    refereeAction = 'BLOCK';
  } else if (allViolations.length > 0) {
    refereeAction = 'WARN_AND_PASS';
  } else {
    refereeAction = 'PASS';
  }

  // Deduplicate violations for explainability
  const uniqueViolations = deduplicateViolations(allViolations);

  return {
    round,
    coach_recommendation: {
      price: coaching.recommended_price,
      basis: coaching.suggested_tactic,
      acceptable_range: coaching.acceptable_range,
    },
    decision: {
      source,
      price: originalDecision.price,
      action: originalDecision.action,
      tactic_used: originalDecision.tactic_used,
      reasoning_summary: originalDecision.reasoning.slice(0, 200),
    },
    referee_result: {
      violations: uniqueViolations.map((v) => ({
        rule: v.rule,
        severity: v.severity,
        detail: v.guidance,
      })),
      action: refereeAction,
      auto_fix_applied: autoFixApplied,
    },
    final_output: {
      price: finalDecision.price,
      action: finalDecision.action,
    },
  };
}

function deduplicateViolations(violations: import('../types.js').ValidationViolation[]): import('../types.js').ValidationViolation[] {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.rule}:${v.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
