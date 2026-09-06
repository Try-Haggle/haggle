/**
 * T2/T3 panel evaluate money-safety invariant (CTO ticket E2).
 *
 * Panel tally (`POST /disputes/:id/tally` / auto-evaluate after votes) is
 * judgment/outcome computation only via dispute-core `evaluatePanelReview`.
 * It must never alone refund, release, or otherwise move funds.
 * Money movement requires the existing resolve path that calls
 * `finalizeDisputeResolution`.
 *
 * See docs/wip/dispute-module-boundary-design.md — Tier 2/3 Panel Review:
 * "The API finalizer remains responsible for money movement..."
 * See docs/wip/dispute-start-api-design.md — AI assessment invariant (B5)
 * as the parallel L1 money-inert pattern.
 */

/** Hard-coded: panel evaluate must never auto-apply a money outcome. */
export const DISPUTE_PANEL_EVALUATE_AUTO_APPLIED = false as const;

/**
 * Side-effect names that panel evaluate / panel tally must not trigger.
 * Used by regression tests to prove the path stays money-inert.
 */
export const DISPUTE_PANEL_EVALUATE_FORBIDDEN_MONEY_SIDE_EFFECTS = [
  "finalizeDisputeResolution",
  "executeRefund",
  "refundDeposit",
  "createRefundRecord",
  "createSettlementReleaseRecord",
  "updateCommerceOrderStatus",
] as const;

export type DisputePanelEvaluateForbiddenMoneySideEffect =
  (typeof DISPUTE_PANEL_EVALUATE_FORBIDDEN_MONEY_SIDE_EFFECTS)[number];

/** Persistable money-safety fields stamped onto every panel evaluation. */
export function buildDisputePanelEvaluateMoneySafetyFields(): {
  auto_applied: typeof DISPUTE_PANEL_EVALUATE_AUTO_APPLIED;
} {
  return { auto_applied: DISPUTE_PANEL_EVALUATE_AUTO_APPLIED };
}

/**
 * Runtime guard: panel evaluation payloads must remain advisory.
 * Throws if a caller tries to mark evaluation as auto-applied / money-moving.
 */
export function assertDisputePanelEvaluateDoesNotMoveMoney(evaluation: {
  auto_applied?: unknown;
  ready?: unknown;
}): void {
  if (evaluation.auto_applied === true) {
    throw new Error(
      "Panel evaluate must not set auto_applied=true; money movement requires a separate resolve/finalizer call",
    );
  }
  if (evaluation.auto_applied !== undefined && evaluation.auto_applied !== false) {
    throw new Error("Panel evaluate auto_applied must be false when present");
  }
}
