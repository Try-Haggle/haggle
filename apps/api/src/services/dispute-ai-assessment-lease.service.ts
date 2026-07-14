import { and, disputeAiAssessmentLeases, eq, lte, type Database } from "@haggle/db";

const AI_ASSESSMENT_LEASE_MS = 15 * 60 * 1000;

export interface DisputeAiAssessmentLease {
  disputeId: string;
  leaseId: string;
  ownerId: string;
  expiresAt: Date;
}

export async function acquireDisputeAiAssessmentLease(
  db: Database,
  input: Omit<DisputeAiAssessmentLease, "expiresAt">,
  now = new Date(),
): Promise<DisputeAiAssessmentLease | null> {
  const expiresAt = new Date(now.getTime() + AI_ASSESSMENT_LEASE_MS);
  const [row] = await db
    .insert(disputeAiAssessmentLeases)
    .values({
      disputeId: input.disputeId,
      leaseId: input.leaseId,
      ownerId: input.ownerId,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: disputeAiAssessmentLeases.disputeId,
      set: {
        leaseId: input.leaseId,
        ownerId: input.ownerId,
        expiresAt,
        updatedAt: now,
      },
      setWhere: lte(disputeAiAssessmentLeases.expiresAt, now),
    })
    .returning();

  return row
    ? {
        disputeId: row.disputeId,
        leaseId: row.leaseId,
        ownerId: row.ownerId,
        expiresAt: row.expiresAt,
      }
    : null;
}

export async function releaseDisputeAiAssessmentLease(
  db: Database,
  disputeId: string,
  leaseId: string,
): Promise<void> {
  await db
    .delete(disputeAiAssessmentLeases)
    .where(and(
      eq(disputeAiAssessmentLeases.disputeId, disputeId),
      eq(disputeAiAssessmentLeases.leaseId, leaseId),
    ));
}
