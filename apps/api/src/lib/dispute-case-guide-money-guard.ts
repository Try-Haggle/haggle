/**
 * Case Guide money-safety invariant (CTO ticket F1).
 *
 * `POST /disputes/:id/case-guide` is party-scoped evidence/claim organization
 * only via dispute-core `runCaseGuide` / `dispute_ai_case_guide_v1`.
 * It must never alone refund, release, settle, or call
 * `finalizeDisputeResolution`. Completely separate from Assessor / resolve /
 * approve / finalizer money paths (B5 + E2b stay intact).
 *
 * See docs/wip/dispute-module-boundary-design.md — AI Review Harness:
 * Case Guide = party-specific evidence and claim organization.
 * See docs/wip/product-decisions-2026-09-07.md §6 — design labels vs wiring.
 */

/** Hard-coded: Case Guide must never auto-apply a money outcome. */
export const DISPUTE_CASE_GUIDE_AUTO_APPLIED = false as const;

/** Hard-coded: Case Guide responses are always money-inert. */
export const DISPUTE_CASE_GUIDE_MONEY_MOVED = false as const;

/**
 * Side-effect names that Case Guide must not trigger.
 * Used by regression tests to prove the path stays money-inert.
 */
export const DISPUTE_CASE_GUIDE_FORBIDDEN_MONEY_SIDE_EFFECTS = [
  "finalizeDisputeResolution",
  "executeRefund",
  "refundDeposit",
  "createRefundRecord",
  "createSettlementReleaseRecord",
  "updateCommerceOrderStatus",
] as const;

export type DisputeCaseGuideForbiddenMoneySideEffect =
  (typeof DISPUTE_CASE_GUIDE_FORBIDDEN_MONEY_SIDE_EFFECTS)[number];

/** Persistable / response money-safety fields stamped onto every Case Guide result. */
export function buildDisputeCaseGuideMoneySafetyFields(): {
  money_moved: typeof DISPUTE_CASE_GUIDE_MONEY_MOVED;
  auto_applied: typeof DISPUTE_CASE_GUIDE_AUTO_APPLIED;
} {
  return {
    money_moved: DISPUTE_CASE_GUIDE_MONEY_MOVED,
    auto_applied: DISPUTE_CASE_GUIDE_AUTO_APPLIED,
  };
}

/**
 * Runtime guard: Case Guide payloads must remain advisory / money-inert.
 * Throws if a caller tries to mark Case Guide as money-moving.
 */
export function assertDisputeCaseGuideDoesNotMoveMoney(payload: {
  money_moved?: unknown;
  auto_applied?: unknown;
}): void {
  if (payload.money_moved === true) {
    throw new Error(
      "Case Guide must not set money_moved=true; money movement requires a separate resolve/finalizer call",
    );
  }
  if (payload.money_moved !== undefined && payload.money_moved !== false) {
    throw new Error("Case Guide money_moved must be false when present");
  }
  if (payload.auto_applied === true) {
    throw new Error(
      "Case Guide must not set auto_applied=true; money movement requires a separate resolve/finalizer call",
    );
  }
  if (payload.auto_applied !== undefined && payload.auto_applied !== false) {
    throw new Error("Case Guide auto_applied must be false when present");
  }
}
