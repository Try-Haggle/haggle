/**
 * Contingent Clause Evaluator
 *
 * Evaluates contingent clauses against real-world events.
 * Section 8: "if trigger fires past threshold, apply remedy"
 *
 * Section 9: Shipping Verification for Electronics v1
 *   - carrier acceptance scan
 *   - late shipment rebate
 *   - buyer cancel right
 */

import type {
  ContingentClause,
  ShippingTerms,
  ShippingVerificationResult,
} from '../protocol/hnp-types.js';

// ---------------------------------------------------------------------------
// Generic Clause Evaluation
// ---------------------------------------------------------------------------

/** An observed event that may trigger a clause. */
export interface ClauseEvent {
  /** Event name (must match clause trigger). */
  event_name: string;
  /** Observed value for the trigger (e.g. hours elapsed). */
  observed_value: number;
  /** ISO 8601 timestamp of the event. */
  timestamp: string;
}

/** Result of evaluating a single clause. */
export interface ClauseEvalResult {
  clause: ContingentClause;
  /** Whether the clause trigger condition is met. */
  triggered: boolean;
  /** Computed remedy details (null if not triggered). */
  remedy_result: RemedyResult | null;
}

/** Computed remedy based on clause parameters and observed event. */
export interface RemedyResult {
  type: string;
  /** Monetary amount (for price_rebate). */
  amount?: number;
  /** Whether a cancel right has been activated. */
  cancel_right?: boolean;
  /** Extension duration (for extension remedy). */
  extension_hours?: number;
}

/**
 * Evaluate a single contingent clause against an observed event.
 */
export function evaluateClause(
  clause: ContingentClause,
  event: ClauseEvent,
): ClauseEvalResult {
  // Check if event matches trigger
  if (event.event_name !== clause.trigger) {
    return { clause, triggered: false, remedy_result: null };
  }

  // Check if observed value exceeds threshold
  if (event.observed_value <= clause.threshold) {
    return { clause, triggered: false, remedy_result: null };
  }

  // Clause triggered — compute remedy
  const remedy_result = computeRemedy(clause, event.observed_value);
  return { clause, triggered: true, remedy_result };
}

/**
 * Evaluate all clauses in an offer against a set of events.
 */
export function evaluateClauses(
  clauses: ContingentClause[],
  events: ClauseEvent[],
): ClauseEvalResult[] {
  const results: ClauseEvalResult[] = [];

  for (const clause of clauses) {
    for (const event of events) {
      const result = evaluateClause(clause, event);
      if (result.triggered) {
        results.push(result);
      }
    }
  }

  // Also include non-triggered clauses for completeness
  for (const clause of clauses) {
    const alreadyTriggered = results.some((r) => r.clause === clause);
    if (!alreadyTriggered) {
      results.push({ clause, triggered: false, remedy_result: null });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Remedy Computation
// ---------------------------------------------------------------------------

function computeRemedy(
  clause: ContingentClause,
  observedValue: number,
): RemedyResult {
  switch (clause.remedy.type) {
    case 'price_rebate': {
      const perUnit = (clause.remedy.params['amount_per_24h'] as number) ?? 0;
      const cap = (clause.remedy.params['cap'] as number) ?? Infinity;
      const excessUnits = Math.ceil((observedValue - clause.threshold) / 24);
      const amount = Math.min(perUnit * excessUnits, cap);
      return { type: 'price_rebate', amount };
    }

    case 'cancel_right':
      return { type: 'cancel_right', cancel_right: true };

    case 'extension': {
      const hours = (clause.remedy.params['hours'] as number) ?? 24;
      return { type: 'extension', extension_hours: hours };
    }

    case 'replacement_right':
      return { type: 'replacement_right' };

    default:
      return { type: clause.remedy.type };
  }
}

// ---------------------------------------------------------------------------
// Section 9: Shipping Verification (Electronics v1)
// ---------------------------------------------------------------------------

/** Shipping event data from carrier/tracking API. */
export interface ShippingEvent {
  /** Hours since order was placed. */
  carrier_acceptance_hours: number | null;
  /** Whether tracking was uploaded. */
  tracking_uploaded: boolean;
  /** Shipping method actually used. */
  actual_shipping_method?: string;
}

/**
 * Verify shipping obligation against agreed terms.
 *
 * Logic (Section 9.3):
 *   if carrier_acceptance_time <= agreed_deadline:
 *     seller_obligation = fulfilled
 *   else:
 *     seller_obligation = late
 *     rebate = min(cap, rebate_per_24h * delayed_days)
 */
export function verifyShipping(
  terms: ShippingTerms,
  event: ShippingEvent,
): ShippingVerificationResult {
  // No carrier acceptance yet
  if (event.carrier_acceptance_hours === null) {
    return {
      obligation: 'unverified',
      rebate_amount: 0,
      cancel_right_activated: false,
      delay_hours: 0,
    };
  }

  const deadline = terms.carrier_acceptance_deadline_hours;
  const acceptanceHours = event.carrier_acceptance_hours;

  // On time
  if (acceptanceHours <= deadline) {
    return {
      obligation: 'fulfilled',
      rebate_amount: 0,
      cancel_right_activated: false,
      delay_hours: 0,
    };
  }

  // Late
  const delayHours = acceptanceHours - deadline;
  const delayDays = Math.ceil(delayHours / 24);
  const rebate = Math.min(
    terms.late_acceptance_rebate_per_24h * delayDays,
    terms.late_acceptance_rebate_cap,
  );
  const cancelRight = acceptanceHours >= terms.cancel_if_no_acceptance_after_hours;

  return {
    obligation: 'late',
    rebate_amount: rebate,
    cancel_right_activated: cancelRight,
    delay_hours: delayHours,
  };
}
