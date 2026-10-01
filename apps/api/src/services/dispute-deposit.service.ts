import { and, type Database, disputeDeposits, eq, lt, sql } from "@haggle/db";

type DepositStatus = "PENDING" | "DEPOSITED" | "FORFEITED" | "REFUNDED" | "CANCELLED";

export async function getDepositByDisputeId(db: Database, disputeId: string) {
  const rows = await db
    .select()
    .from(disputeDeposits)
    .where(and(eq(disputeDeposits.disputeId, disputeId), eq(disputeDeposits.policyVersion, 1)))
    .limit(1);

  return rows[0] ?? null;
}

export async function getReviewDeposits(db: Database, disputeId: string, tier?: 2 | 3) {
  return db
    .select()
    .from(disputeDeposits)
    .where(
      and(
        eq(disputeDeposits.disputeId, disputeId),
        eq(disputeDeposits.policyVersion, 2),
        ...(tier === undefined ? [] : [eq(disputeDeposits.tier, tier)]),
      ),
    );
}

export async function getDepositById(db: Database, depositId: string) {
  const rows = await db
    .select()
    .from(disputeDeposits)
    .where(eq(disputeDeposits.id, depositId))
    .limit(1);

  return rows[0] ?? null;
}

export async function createDeposit(
  db: Database,
  data: {
    disputeId: string;
    tier: number;
    amountCents: number;
    deadlineHours: number;
    deadlineAt: Date;
    party?: "buyer" | "seller";
    policyVersion?: 1 | 2;
  },
) {
  const [row] = await db
    .insert(disputeDeposits)
    .values({
      disputeId: data.disputeId,
      tier: data.tier,
      party: data.party ?? "seller",
      policyVersion: data.policyVersion ?? 1,
      amountCents: data.amountCents,
      deadlineHours: data.deadlineHours,
      deadlineAt: data.deadlineAt,
      status: "PENDING",
    })
    .returning();

  return row;
}

export async function updateDepositStatus(
  db: Database,
  depositId: string,
  status: DepositStatus,
  extraFields?: {
    depositedAt?: Date;
    resolvedAt?: Date;
    metadata?: Record<string, unknown>;
  },
) {
  const setFields: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (extraFields?.depositedAt !== undefined) {
    setFields.depositedAt = extraFields.depositedAt;
  }
  if (extraFields?.resolvedAt !== undefined) {
    setFields.resolvedAt = extraFields.resolvedAt;
  }
  if (extraFields?.metadata !== undefined) {
    setFields.metadata = extraFields.metadata;
  }

  const [row] = await db
    .update(disputeDeposits)
    .set(setFields)
    .where(eq(disputeDeposits.id, depositId))
    .returning();

  return row;
}

export async function updateDepositMetadata(
  db: Database,
  depositId: string,
  metadata: Record<string, unknown>,
) {
  const [row] = await db
    .update(disputeDeposits)
    .set({
      metadata,
      updatedAt: new Date(),
    })
    .where(eq(disputeDeposits.id, depositId))
    .returning();

  return row;
}

export async function getPendingExpiredDeposits(db: Database) {
  const rows = await db
    .select()
    .from(disputeDeposits)
    .where(and(eq(disputeDeposits.status, "PENDING"), lt(disputeDeposits.deadlineAt, sql`now()`)))
    .limit(100);

  return rows;
}
