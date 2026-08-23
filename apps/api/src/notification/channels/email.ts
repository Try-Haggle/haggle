import { type Database, emailDeliveries } from "@haggle/db";
import { eq } from "drizzle-orm";
import type { Resend } from "resend";
import type { EventType } from "../catalog.js";
import { getNotificationUserInfo } from "../get-user-info.js";
import { renderEmailTemplate } from "../templates/render.js";

interface EmailInput {
  db: Database;
  resend: Resend;
  recipientUserId: string;
  eventType: EventType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export async function sendEmail(input: EmailInput): Promise<void> {
  const { db, resend, recipientUserId, eventType, payload, idempotencyKey } = input;

  // 1. Lookup recipient email from auth.users
  const userInfo = await getNotificationUserInfo(db, recipientUserId);
  if (!userInfo) {
    console.warn(`[notification] no email found for user ${recipientUserId}, skipping`);
    return;
  }
  const toEmail = userInfo.email;

  // 2. Insert email_deliveries row (queued) — idempotency guard
  const [delivery] = await db
    .insert(emailDeliveries)
    .values({
      userId: recipientUserId,
      toEmail,
      eventType,
      provider: "resend",
      status: "queued",
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();

  if (!delivery) return; // duplicate

  // 3. Non-production: log only, mark as sent (skip actual Resend call)
  // To test real email sending in dev: temporarily set NODE_ENV=production
  // TODO(notification-queue): 1차에선 fire-and-forget. 볼륨 증가 시 Inngest/pg-boss 도입 검토.
  if (process.env.NODE_ENV !== "production") {
    console.log(`[EMAIL DEV] to=${toEmail} event=${eventType}`);
    await db
      .update(emailDeliveries)
      .set({ status: "sent", updatedAt: new Date() })
      .where(eq(emailDeliveries.id, delivery.id));
    return;
  }

  // 4. Render template and send via Resend
  try {
    const { subject, html } = await renderEmailTemplate(eventType, payload);
    const { data, error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
      to: toEmail,
      subject,
      html,
    });

    if (error || !data?.id) {
      await db
        .update(emailDeliveries)
        .set({
          status: "failed",
          errorMessage: error?.message ?? "no message id",
          attempts: delivery.attempts + 1,
          updatedAt: new Date(),
        })
        .where(eq(emailDeliveries.id, delivery.id));
      return;
    }

    await db
      .update(emailDeliveries)
      .set({ status: "sent", providerMessageId: data.id, updatedAt: new Date() })
      .where(eq(emailDeliveries.id, delivery.id));
  } catch (err) {
    await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        errorMessage: String(err),
        attempts: delivery.attempts + 1,
        updatedAt: new Date(),
      })
      .where(eq(emailDeliveries.id, delivery.id));
  }
}
