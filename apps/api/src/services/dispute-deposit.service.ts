import {
  eq,
  and,
  lt,
  sql,
  disputeDeposits,
  type Database,
} from "@haggle/db";

type DepositStatus = "PENDING" | "DEPOSITED" | "FORFEITED" | "REFUNDED";

export async function getDepositByDisputeId(db: Database, disputeId: string) {
  const rows = await db
    .select()
    .from(disputeDeposits)
    .where(eq(disputeDeposits.disputeId, disputeId))
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
  },
) {
  const [row] = await db
    .insert(disputeDeposits)
    .values({
      disputeId: data.disputeId,
      tier: data.tier,
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
    .where(
      and(
        eq(disputeDeposits.status, "PENDING"),
        lt(disputeDeposits.deadlineAt, sql`now()`),
      ),
    )
    .limit(100);

  return rows;
}
