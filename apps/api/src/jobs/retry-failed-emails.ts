import { type Database, emailDeliveries, notifications } from "@haggle/db";
import { sql, and, lt, or, eq } from "drizzle-orm";
import { Resend } from "resend";
import { sendEmail } from "../notification/channels/email.js";
import type { EventType } from "../notification/catalog.js";

/**
 * Retry failed email deliveries and clean up zombie 'queued' rows.
 *
 * - 'queued' > 10 min: process crashed mid-flight → mark failed
 * - 'failed' attempts<3: retry if payload recoverable via paired notifications row
 *   (email-only events like user.signed_up have no notifications row → skip retry, log only)
 *
 * TODO(notification-queue): Replace with Inngest or pg-boss when volume grows.
 * See docs/wip/Notification_System_Plan.md §4-C
 */
export async function runRetryFailedEmails(db: Database): Promise<void> {
  // 1. Clean up zombie 'queued' rows (process died before Resend API call completed)
  const zombieResult = await db
    .update(emailDeliveries)
    .set({ status: "failed", errorMessage: "zombie: process likely crashed", updatedAt: new Date() })
    .where(
      and(
        eq(emailDeliveries.status, "queued"),
        sql`${emailDeliveries.createdAt} < NOW() - INTERVAL '10 minutes'`,
      ),
    )
    .returning({ id: emailDeliveries.id });

  if (zombieResult.length > 0) {
    console.log(`[cron] retry-failed-emails: marked ${zombieResult.length} zombie(s) as failed`);
  }

  // 2. Retry 'failed' rows with attempts < 3, created within 24h
  const candidates = await db.query.emailDeliveries.findMany({
    where: and(
      eq(emailDeliveries.status, "failed"),
      lt(emailDeliveries.attempts, 3),
      sql`${emailDeliveries.createdAt} > NOW() - INTERVAL '24 hours'`,
    ),
    limit: 50,
  });

  if (candidates.length === 0) return;
  console.log(`[cron] retry-failed-emails: ${candidates.length} failed delivery(s) to retry`);

  const resend = new Resend(process.env.RESEND_API_KEY);

  for (const delivery of candidates) {
    // Recover payload from paired notifications row (same idempotency key)
    const notifRow = await db.query.notifications.findFirst({
      where: and(
        eq(notifications.userId, delivery.userId),
        eq(notifications.idempotencyKey, delivery.idempotencyKey),
      ),
    });

    if (!notifRow) {
      // email-only event (user.signed_up, listing.published) — no payload recoverable
      console.warn(
        `[cron] retry-failed-emails: no notifications row for delivery ${delivery.id} (${delivery.eventType}) — skipping retry, manual re-trigger needed`,
      );
      continue;
    }

    try {
      // Reset status to allow resend (different idempotency_key won't conflict since we reuse)
      // sendEmail guards with ON CONFLICT DO NOTHING on the idempotency key —
      // so we manually reset the row to 'queued' before calling sendEmail
      await db
        .update(emailDeliveries)
        .set({ status: "queued", updatedAt: new Date() })
        .where(eq(emailDeliveries.id, delivery.id));

      await sendEmail({
        db,
        resend,
        recipientUserId: delivery.userId,
        eventType: delivery.eventType as EventType,
        payload: notifRow.payload as Record<string, unknown>,
        idempotencyKey: delivery.idempotencyKey,
      });
    } catch (err) {
      console.error(`[cron] retry-failed-emails: error for delivery ${delivery.id}:`, err);
    }
  }
}
