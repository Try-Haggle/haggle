/**
 * Settlement Auto-Release Job
 *
 * Automatically releases escrowed product payments to sellers when the
 * buyer review deadline passes without dispute or manual confirmation.
 *
 * Schedule: every 5 minutes
 * Batch limit: 100 records per run
 */

import {
  type Database,
  settlementReleases,
  commerceOrders,
  eq,
  and,
  lt,
} from "@haggle/db";

const BATCH_LIMIT = 100;

export async function runSettlementAutoRelease(db: Database): Promise<void> {
  const now = new Date();

  // Find settlement releases in BUYER_REVIEW where deadline has passed
  const overdue = await db
    .select({
      id: settlementReleases.id,
      orderId: settlementReleases.orderId,
    })
    .from(settlementReleases)
    .where(
      and(
        eq(settlementReleases.productReleaseStatus, "BUYER_REVIEW"),
        lt(settlementReleases.buyerReviewDeadline, now),
      ),
    )
    .limit(BATCH_LIMIT);

  if (overdue.length === 0) return;

  let released = 0;

  for (const row of overdue) {
    try {
      // Update settlement release to RELEASED
      await db
        .update(settlementReleases)
        .set({
          productReleaseStatus: "RELEASED",
          productReleasedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(settlementReleases.id, row.id),
            // Re-check status to prevent race conditions
            eq(settlementReleases.productReleaseStatus, "BUYER_REVIEW"),
          ),
        );

      // Update linked commerce order to CLOSED
      await db
        .update(commerceOrders)
        .set({ status: "CLOSED", updatedAt: now })
        .where(
          and(
            eq(commerceOrders.id, row.orderId),
            // Only close if order is in DELIVERED state (guard against race)
            eq(commerceOrders.status, "DELIVERED"),
          ),
        );

      released += 1;
    } catch (error) {
      console.error(
        `[settlement-auto-release] Failed to release ${row.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (released > 0) {
    console.log(`[settlement-auto-release] Released ${released} settlement(s)`);
  }
}
