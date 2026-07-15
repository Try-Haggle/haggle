import { and, type Database, disputeOperationLeases, eq, lte } from "@haggle/db";

const DISPUTE_OPERATION_LEASE_MS = 60 * 1000;

export type DisputeOperation =
  | "appeal_submission"
  | "appeal_assignment"
  | "appeal_review"
  | "dispute_resolution";

export interface DisputeOperationLease {
  key: string;
  disputeId: string;
  operation: DisputeOperation;
  leaseId: string;
  ownerId: string;
  expiresAt: Date;
}

export function disputeOperationLeaseKey(disputeId: string, operation: DisputeOperation): string {
  return `${disputeId}:${operation}`;
}

export async function acquireDisputeOperationLease(
  db: Database,
  input: Omit<DisputeOperationLease, "key" | "expiresAt">,
  now = new Date(),
): Promise<DisputeOperationLease | null> {
  const key = disputeOperationLeaseKey(input.disputeId, input.operation);
  const expiresAt = new Date(now.getTime() + DISPUTE_OPERATION_LEASE_MS);
  const [row] = await db
    .insert(disputeOperationLeases)
    .values({ key, ...input, expiresAt, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: disputeOperationLeases.key,
      set: {
        leaseId: input.leaseId,
        ownerId: input.ownerId,
        expiresAt,
        updatedAt: now,
      },
      setWhere: lte(disputeOperationLeases.expiresAt, now),
    })
    .returning();
  return row ? { ...row, operation: row.operation as DisputeOperation } : null;
}

export async function releaseDisputeOperationLease(
  db: Database,
  key: string,
  leaseId: string,
): Promise<void> {
  await db
    .delete(disputeOperationLeases)
    .where(and(eq(disputeOperationLeases.key, key), eq(disputeOperationLeases.leaseId, leaseId)));
}
