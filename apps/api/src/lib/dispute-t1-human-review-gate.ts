/**
 * T1 → human review gate (CTO ticket E2b).
 *
 * After Tier-1 `POST /disputes/:id/ai/assess` reaches COMPLETED, money movement
 * via resolve / finalizeDisputeResolution / refund / release is blocked until
 * an admin (or designated reviewer) explicitly approves the assessment.
 *
 * Assess alone remains advisory (`auto_applied: false`, B5). Auto-release is a
 * future flag only and is forbidden/default-off now (Jeonghaeng 2026-09-07:
 * 초기 human, 이후 auto). When design-prompt “T1 final call” wording conflicts,
 * this human-first policy wins.
 *
 * See docs/wip/dispute-start-api-design.md (B5 money-inert assess).
 */

/** Future auto-release switch — must stay false until product explicitly enables. */
export const DISPUTE_T1_AUTO_RELEASE_ENABLED = false as const;

export const DISPUTE_T1_HUMAN_REVIEW_PENDING = "PENDING_APPROVAL" as const;
export const DISPUTE_T1_HUMAN_REVIEW_APPROVED = "APPROVED" as const;

export type DisputeT1HumanReviewStatus =
  | typeof DISPUTE_T1_HUMAN_REVIEW_PENDING
  | typeof DISPUTE_T1_HUMAN_REVIEW_APPROVED;

export type DisputeT1HumanReviewState = {
  status: DisputeT1HumanReviewStatus;
  assessment_id?: string | null;
  evidence_snapshot_hash?: string | null;
  required: true;
  auto_release_enabled: typeof DISPUTE_T1_AUTO_RELEASE_ENABLED;
  approved_at?: string | null;
  approved_by?: string | null;
  notes?: string | null;
  created_at?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Runtime guard: auto-release must remain off. */
export function assertT1AutoReleaseForbidden(): void {
  if (DISPUTE_T1_AUTO_RELEASE_ENABLED) {
    throw new Error(
      "T1 auto-release is forbidden; human approval is required before resolve/finalizer money movement",
    );
  }
}

export function buildPendingT1HumanReview(params: {
  assessment_id?: string | null;
  evidence_snapshot_hash?: string | null;
  created_at?: string;
}): DisputeT1HumanReviewState {
  assertT1AutoReleaseForbidden();
  return {
    status: DISPUTE_T1_HUMAN_REVIEW_PENDING,
    assessment_id: params.assessment_id ?? null,
    evidence_snapshot_hash: params.evidence_snapshot_hash ?? null,
    required: true,
    auto_release_enabled: DISPUTE_T1_AUTO_RELEASE_ENABLED,
    approved_at: null,
    approved_by: null,
    notes: null,
    created_at: params.created_at ?? new Date().toISOString(),
  };
}

export function buildApprovedT1HumanReview(params: {
  previous?: DisputeT1HumanReviewState | Record<string, unknown> | null;
  assessment_id?: string | null;
  evidence_snapshot_hash?: string | null;
  approved_by: string;
  approved_at?: string;
  notes?: string | null;
}): DisputeT1HumanReviewState {
  assertT1AutoReleaseForbidden();
  const prev = isRecord(params.previous) ? params.previous : {};
  return {
    status: DISPUTE_T1_HUMAN_REVIEW_APPROVED,
    assessment_id:
      params.assessment_id ?? (typeof prev.assessment_id === "string" ? prev.assessment_id : null),
    evidence_snapshot_hash:
      params.evidence_snapshot_hash ??
      (typeof prev.evidence_snapshot_hash === "string" ? prev.evidence_snapshot_hash : null),
    required: true,
    auto_release_enabled: DISPUTE_T1_AUTO_RELEASE_ENABLED,
    approved_at: params.approved_at ?? new Date().toISOString(),
    approved_by: params.approved_by,
    notes: params.notes ?? null,
    created_at: typeof prev.created_at === "string" ? prev.created_at : undefined,
  };
}

/**
 * True when current tier is T1, a COMPLETED AI assessment exists, and human
 * approval has not been granted for that assessment. Money paths must block.
 */
export function t1HumanApprovalBlocksMoneyMovement(params: {
  tier: number | null | undefined;
  ai_resolution_assessor: unknown;
  t1_human_review: unknown;
}): boolean {
  assertT1AutoReleaseForbidden();
  const tier = params.tier ?? 1;
  if (tier !== 1) return false;

  const assessment = params.ai_resolution_assessor;
  if (!isRecord(assessment) || assessment.status !== "COMPLETED") {
    return false;
  }

  const review = params.t1_human_review;
  if (!isRecord(review)) {
    // Completed T1 assess with no review record → treat as pending (fail closed).
    return true;
  }
  if (review.status === DISPUTE_T1_HUMAN_REVIEW_APPROVED) {
    const assessmentId =
      typeof assessment.assessment_id === "string"
        ? assessment.assessment_id
        : typeof assessment.id === "string"
          ? assessment.id
          : null;
    const reviewAssessmentId =
      typeof review.assessment_id === "string" ? review.assessment_id : null;
    // Approval must bind to the current completed assessment when ids are present.
    if (assessmentId && reviewAssessmentId && assessmentId !== reviewAssessmentId) {
      return true;
    }
    return false;
  }
  return true;
}
