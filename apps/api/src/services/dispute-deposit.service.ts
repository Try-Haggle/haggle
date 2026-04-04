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
  },
) {
  const [row] = await db
    .update(disputeDeposits)
    .set({
      status,
      depositedAt: extraFields?.depositedAt,
      resolvedAt: extraFields?.resolvedAt,
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
    );

  return rows;
}
