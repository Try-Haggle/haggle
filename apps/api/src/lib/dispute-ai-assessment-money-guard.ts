/**
 * L1 AI assessment money-safety invariant (CTO ticket B5).
 *
 * AI resolution assessment is advisory only. Completing
 * `POST /disputes/:id/ai/assess` must never alone refund, release, or otherwise
 * move funds. Money movement requires a separate operator resolve path that
 * calls `finalizeDisputeResolution`.
 *
 * See docs/wip/dispute-start-api-design.md — "AI assessment alone never
 * releases or refunds funds."
 */

/** Hard-coded: L1 AI assessment must never auto-apply a money outcome. */
export const DISPUTE_AI_ASSESSMENT_AUTO_APPLIED = false as const;

/**
 * Side-effect names that L1 AI assessment must not trigger.
 * Used by regression tests to prove the assess path stays money-inert.
 */
export const DISPUTE_AI_ASSESSMENT_FORBIDDEN_MONEY_SIDE_EFFECTS = [
  "finalizeDisputeResolution",
  "executeRefund",
  "refundDeposit",
  "createRefundRecord",
  "createSettlementReleaseRecord",
  "updateCommerceOrderStatus",
] as const;

export type DisputeAiAssessmentForbiddenMoneySideEffect =
  (typeof DISPUTE_AI_ASSESSMENT_FORBIDDEN_MONEY_SIDE_EFFECTS)[number];

/** Persistable money-safety fields stamped onto every completed AI assessment. */
export function buildDisputeAiAssessmentMoneySafetyFields(): {
  auto_applied: typeof DISPUTE_AI_ASSESSMENT_AUTO_APPLIED;
} {
  return { auto_applied: DISPUTE_AI_ASSESSMENT_AUTO_APPLIED };
}

/**
 * Runtime guard: completed assessment payloads must remain advisory.
 * Throws if a caller tries to mark assessment as auto-applied / money-moving.
 */
export function assertDisputeAiAssessmentDoesNotMoveMoney(assessment: {
  auto_applied?: unknown;
  status?: unknown;
}): void {
  if (assessment.auto_applied === true) {
    throw new Error(
      "L1 AI assessment must not set auto_applied=true; money movement requires a separate resolve call",
    );
  }
  if (assessment.auto_applied !== undefined && assessment.auto_applied !== false) {
    throw new Error("L1 AI assessment auto_applied must be false when present");
  }
}
