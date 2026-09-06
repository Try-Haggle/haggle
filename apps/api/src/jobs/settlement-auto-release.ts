/**
 * Settlement Auto-Release Job
 *
 * Automatically releases escrowed product payments to sellers when the
 * buyer review deadline passes without dispute or manual confirmation.
 *
 * Dispute guard: never release while the commerce order is IN_DISPUTE or
 * an active (non-terminal) dispute case exists for the order.
 *
 * Schedule: every 5 minutes
 * Batch limit: 100 records per run
 */

import {
  and,
  commerceOrders,
  type Database,
  eq,
  inArray,
  lt,
  settlementReleases,
  sql,
} from "@haggle/db";

const BATCH_LIMIT = 100;

const TERMINAL_DISPUTE_STATUSES = [
  "RESOLVED_BUYER_FAVOR",
  "RESOLVED_SELLER_FAVOR",
  "PARTIAL_REFUND",
  "CLOSED",
] as const;

async function isOrderBlockedByDispute(db: Database, orderId: string): Promise<boolean> {
  const order = await db.query.commerceOrders.findFirst({
    where: (fields, ops) => ops.eq(fields.id, orderId),
    columns: { id: true, status: true },
  });
  if (!order || order.status === "IN_DISPUTE") {
    return true;
  }

  const activeDispute = await db.query.disputeCases.findFirst({
    where: (fields) => sql`
      ${fields.orderId} = ${orderId}
      AND ${fields.status} NOT IN (
        ${sql.join(
          TERMINAL_DISPUTE_STATUSES.map((status) => sql`${status}`),
          sql`, `,
        )}
      )
    `,
    columns: { id: true },
  });
  return Boolean(activeDispute);
}

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
  let skippedDispute = 0;

  for (const row of overdue) {
    try {
      if (await isOrderBlockedByDispute(db, row.orderId)) {
        skippedDispute += 1;
        continue;
      }

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
            // Physical DELIVERED + no-shipping FULFILLMENT_* (digital never DELIVERED)
            inArray(commerceOrders.status, [
              "DELIVERED",
              "FULFILLMENT_PENDING",
              "FULFILLMENT_ACTIVE",
            ]),
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

  if (released > 0 || skippedDispute > 0) {
    console.log(
      `[settlement-auto-release] Released ${released} settlement(s); skipped ${skippedDispute} in-dispute`,
    );
  }
}
