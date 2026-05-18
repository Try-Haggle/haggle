import { sql } from "drizzle-orm";
import { type Database, notifications } from "@haggle/db";
import { pushToUser, type WsNotificationMessage } from "../ws-registry.js";
import type { NotificationCategory } from "../catalog.js";

interface InAppInput {
  db: Database;
  recipientUserId: string;
  eventType: string;
  category: NotificationCategory;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export async function sendInApp(input: InAppInput): Promise<void> {
  const { db, recipientUserId, eventType, category, payload, idempotencyKey } = input;

  const [row] = await db
    .insert(notifications)
    .values({
      userId: recipientUserId,
      eventType,
      category,
      payload: payload as Record<string, unknown>,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning();

  if (!row) return; // duplicate — idempotency key already exists

  const message: WsNotificationMessage = {
    type: "notification.new",
    notification: {
      id: row.id,
      eventType: row.eventType,
      category: row.category,
      payload: row.payload as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    },
  };

  pushToUser(recipientUserId, message);
}
