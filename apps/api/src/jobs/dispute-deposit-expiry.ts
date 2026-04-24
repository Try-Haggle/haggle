/**
 * Dispute Deposit Expiry Job
 *
 * When a dispute deposit deadline passes without the required deposit
 * being made, the deposit is forfeited and the dispute is resolved
 * in the buyer's favor (default judgment).
 *
 * Schedule: every hour
 * Batch limit: 100 records per run
 */

import {
  type Database,
  disputeDeposits,
  disputeCases,
  eq,
  and,
  lt,
  inArray,
} from "@haggle/db";

const BATCH_LIMIT = 100;

export async function runDisputeDepositExpiry(db: Database): Promise<void> {
  const now = new Date();

  // Find pending deposits past their deadline
  const expired = await db
    .select({
      id: disputeDeposits.id,
      disputeId: disputeDeposits.disputeId,
    })
    .from(disputeDeposits)
    .where(
      and(
        eq(disputeDeposits.status, "PENDING"),
        lt(disputeDeposits.deadlineAt, now),
      ),
    )
    .limit(BATCH_LIMIT);

  if (expired.length === 0) return;

  let forfeited = 0;

  for (const row of expired) {
    try {
      // Forfeit the deposit
      await db
        .update(disputeDeposits)
        .set({
          status: "FORFEITED",
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(disputeDeposits.id, row.id),
            // Re-check status to prevent race conditions
            eq(disputeDeposits.status, "PENDING"),
          ),
        );

      // Resolve the linked dispute in buyer's favor (default judgment)
      // Only update disputes that are still in an active state
      await db
        .update(disputeCases)
        .set({
          status: "RESOLVED_BUYER_FAVOR",
          resolutionSummary: "Default judgment: dispute deposit deadline expired without payment",
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(disputeCases.id, row.disputeId),
            inArray(disputeCases.status, ["OPEN", "UNDER_REVIEW", "WAITING_FOR_BUYER", "WAITING_FOR_SELLER"]),
          ),
        );

      forfeited += 1;
    } catch (error) {
      console.error(
        `[dispute-deposit-expiry] Failed to forfeit deposit ${row.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (forfeited > 0) {
    console.log(`[dispute-deposit-expiry] Forfeited ${forfeited} deposit(s)`);
  }
}
