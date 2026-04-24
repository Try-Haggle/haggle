/**
 * Payment Intent Expiry Job
 *
 * Cancels stale payment intents that remain in CREATED or QUOTED
 * status for more than 1 hour. Prevents dangling intents from
 * blocking order workflows.
 *
 * Schedule: every 15 minutes
 * Batch limit: 100 records per run
 */

import {
  type Database,
  paymentIntents,
  eq,
  and,
  lt,
  inArray,
} from "@haggle/db";

const BATCH_LIMIT = 100;
const EXPIRY_MS = 60 * 60 * 1000; // 1 hour

export async function runPaymentIntentExpiry(db: Database): Promise<void> {
  const cutoff = new Date(Date.now() - EXPIRY_MS);
  const now = new Date();

  // Find stale payment intents
  const stale = await db
    .select({ id: paymentIntents.id })
    .from(paymentIntents)
    .where(
      and(
        inArray(paymentIntents.status, ["CREATED", "QUOTED"]),
        lt(paymentIntents.createdAt, cutoff),
      ),
    )
    .limit(BATCH_LIMIT);

  if (stale.length === 0) return;

  let canceled = 0;

  for (const row of stale) {
    try {
      await db
        .update(paymentIntents)
        .set({ status: "CANCELED", updatedAt: now })
        .where(
          and(
            eq(paymentIntents.id, row.id),
            // Re-check status to prevent race conditions
            inArray(paymentIntents.status, ["CREATED", "QUOTED"]),
          ),
        );
      canceled += 1;
    } catch (error) {
      console.error(
        `[payment-intent-expiry] Failed to cancel ${row.id}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (canceled > 0) {
    console.log(`[payment-intent-expiry] Canceled ${canceled} stale intent(s)`);
  }
}
