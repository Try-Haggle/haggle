import type { Database } from "@haggle/db";
import type { Resend } from "resend";
import { EVENT_CATALOG, type EventType } from "./catalog.js";
import { sendEmail } from "./channels/email.js";
import { sendInApp } from "./channels/in-app.js";

export interface PublishInput {
  type: EventType;
  recipientUserId: string;
  payload: Record<string, unknown>;
}

export interface NotificationBus {
  publish(input: PublishInput): Promise<void>;
}

export function createNotificationBus(db: Database, resend: Resend): NotificationBus {
  return {
    async publish({ type, recipientUserId, payload }) {
      const meta = EVENT_CATALOG[type];

      // 1. Validate payload against Zod schema
      const validatedPayload = meta.payloadSchema.parse(payload);

      // 2. Generate deterministic idempotency key
      const primaryEntityId = (validatedPayload as Record<string, unknown>)[meta.primaryEntityKey];
      const idempotencyKey = `${type}:${primaryEntityId}:${recipientUserId}`;

      // 3. Preferences check — all 1차 events are transactional (prefs skipped)
      // TODO: add prefs lookup here when non-transactional events are introduced

      // 4. Fan-out to channels
      for (const channel of meta.channels) {
        if (channel === "in_app") {
          // Build storedPayload: include displayTitle/displayLink from renderDisplay
          const display = meta.renderDisplay?.(validatedPayload) ?? {};
          const storedPayload = { ...validatedPayload, ...display };

          await sendInApp({
            db,
            recipientUserId,
            eventType: type,
            category: meta.category,
            payload: storedPayload,
            idempotencyKey,
          });
        } else if (channel === "email") {
          // Fire-and-forget — do not await, does not block API response
          // TODO(notification-queue): replace with queue when volume grows
          void sendEmail({
            db,
            resend,
            recipientUserId,
            eventType: type,
            payload: validatedPayload,
            idempotencyKey,
          }).catch((err) => {
            console.error(`[notification] email send error for ${type}:`, err);
          });
        }
      }
    },
  };
}
