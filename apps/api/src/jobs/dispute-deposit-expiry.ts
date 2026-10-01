/**
 * Expired review quotes require funding reconciliation before an outcome.
 * A timer cannot forfeit an unreceived bond or decide a dispute from a single
 * PENDING row. The admin default route verifies both parties and on-chain state.
 */
import { and, type Database, disputeDeposits, eq, lt } from "@haggle/db";

export async function runDisputeDepositExpiry(db: Database): Promise<void> {
  const expired = await db
    .select({ id: disputeDeposits.id, disputeId: disputeDeposits.disputeId })
    .from(disputeDeposits)
    .where(
      and(
        eq(disputeDeposits.policyVersion, 2),
        eq(disputeDeposits.party, "seller"),
        eq(disputeDeposits.status, "PENDING"),
        lt(disputeDeposits.deadlineAt, new Date()),
      ),
    )
    .limit(100);
  if (expired.length > 0) {
    console.warn(
      `[dispute-deposit-expiry] ${expired.length} seller bonds need funding reconciliation`,
    );
  }
}
