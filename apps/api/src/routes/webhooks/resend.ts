import { and, type Database, emailDeliveries, eq, sql } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { Webhook } from "svix";

type ResendWebhookEventType =
  | "email.sent"
  | "email.delivered"
  | "email.delivery_delayed"
  | "email.bounced"
  | "email.complained";

interface ResendWebhookPayload {
  type: ResendWebhookEventType;
  data: { email_id: string; [key: string]: unknown };
}

const STATUS_MAP: Partial<Record<ResendWebhookEventType, string>> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "failed",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export function registerResendWebhookRoute(app: FastifyInstance, db: Database): void {
  app.post("/api/webhooks/resend", { config: { rawBody: true } }, async (request, reply) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;

    if (!secret || secret === "placeholder") {
      if (process.env.NODE_ENV === "production") {
        return reply.code(401).send({ error: "RESEND_WEBHOOK_SECRET_NOT_CONFIGURED" });
      }
      app.log.warn("[webhook/resend] signature verification skipped (dev mode)");
    } else {
      const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
      if (!rawBody) return reply.code(400).send({ error: "missing_raw_body" });
      try {
        new Webhook(secret).verify(rawBody, request.headers as Record<string, string>);
      } catch {
        return reply.code(401).send({ error: "invalid_signature" });
      }
    }

    const { type, data } = request.body as ResendWebhookPayload;
    const newStatus = STATUS_MAP[type];
    const providerId = data?.email_id;

    if (!newStatus || !providerId) {
      return reply.send({ ok: true, skipped: true });
    }

    const isFailed = newStatus === "failed" || newStatus === "bounced";

    await db
      .update(emailDeliveries)
      .set({
        status: newStatus as never,
        ...(newStatus === "delivered" ? { deliveredAt: new Date() } : {}),
        ...(isFailed ? { attempts: sql`${emailDeliveries.attempts} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailDeliveries.provider, "resend"),
          eq(emailDeliveries.providerMessageId, providerId),
        ),
      );

    app.log.info({ type, providerId, newStatus }, "[webhook/resend] processed");
    return reply.send({ ok: true });
  });
}
