import { type Database, notifications } from "@haggle/db";
import { publishToUsers } from "../../realtime/publish.js";
import type { NotificationCategory } from "../catalog.js";
import type { WsNotificationMessage } from "../ws-registry.js";

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

  // Fan-out (not a direct socket push): the recipient's socket may live on
  // another API instance.
  publishToUsers([recipientUserId], message);
}
