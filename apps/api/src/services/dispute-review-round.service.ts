import { type Database, disputeCases, eq } from "@haggle/db";
import type { DisputeCase } from "@haggle/dispute-core";

export const REVIEW_CLOSED_STATUSES = [
  "RESOLVED_BUYER_FAVOR",
  "RESOLVED_SELLER_FAVOR",
  "PARTIAL_REFUND",
  "CLOSED",
];

export function reviewTier(dispute: DisputeCase): number {
  return Number(dispute.metadata?.tier ?? 1);
}

export function escalationIssue(dispute: DisputeCase, expectedTier?: number): string | null {
  const tier = reviewTier(dispute);
  if (REVIEW_CLOSED_STATUSES.includes(dispute.status)) return "DISPUTE_ALREADY_RESOLVED";
  if (![1, 2, 3].includes(tier)) return "INVALID_REVIEW_TIER";
  if (expectedTier !== undefined && tier !== expectedTier) return "REVIEW_TIER_CHANGED";
  if (tier === 3) return "MAX_TIER_REACHED";
  if (dispute.status !== "UNDER_REVIEW") return "REVIEW_NOT_STARTED";
  const meta = dispute.metadata ?? {};
  if (tier === 2 && meta.review_phase !== "ACTIVE") return "REVIEW_BONDS_NOT_CONFIRMED";
  if (meta.ai_assessment_stale === true) return "ASSESSMENT_STALE";
  const decision = (tier === 1 ? meta.ai_resolution_assessor : meta.panel_review_evaluation) as
    | Record<string, unknown>
    | undefined;
  if (tier === 1 && decision?.status !== "COMPLETED") return "T1_ASSESSMENT_NOT_COMPLETED";
  if (tier === 2 && (decision?.ready !== true || decision.tier !== 2))
    return "PANEL_REVIEW_NOT_READY";
  const appeal = meta.appeal_review as Record<string, unknown> | undefined;
  if (appeal?.status === "OPEN" || appeal?.status === "REOPENED") return "APPEAL_REVIEW_REQUIRED";
  return null;
}

/** Every panel mutation takes the case lock before assignment/profile locks. */
export async function withReviewRoundLock<T>(
  db: Database,
  disputeId: string,
  run: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: disputeCases.id })
      .from(disputeCases)
      .where(eq(disputeCases.id, disputeId))
      .for("update");
    return run(tx as unknown as Database);
  });
}
