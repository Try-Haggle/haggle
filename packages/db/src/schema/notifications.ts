import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const NOTIFICATION_CATEGORIES = ["negotiation", "account", "listing"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),                    // auth.users.id — FK 미설정 (코드베이스 컨벤션)

    eventType: text("event_type").notNull(),               // e.g. "negotiation.offer.received"
    category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),

    payload: jsonb("payload").notNull(),                   // snapshot: 표시에 필요한 모든 데이터 + displayTitle + displayLink

    readAt: timestamp("read_at", { withTimezone: true }),  // null = unread
    idempotencyKey: text("idempotency_key").notNull(),     // `${event_type}:${entity_id}:${user_id}`

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notifications_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("notifications_unread_idx").on(table.userId).where(sql`read_at IS NULL`),
    uniqueIndex("notifications_user_idempotency_uniq").on(table.userId, table.idempotencyKey),
  ],
);
