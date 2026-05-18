import { boolean, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

// drizzle-kit CJS 호환 — catalog 단일 출처(notification/catalog.ts)와 값 동기화 유지
const NOTIFICATION_CATEGORIES = ["negotiation", "account", "listing"] as const;

export const NOTIFICATION_CHANNELS = ["in_app", "email"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

// Tall rows: (user_id, category, channel) 복합 PK — 셀 하나당 1행.
// 행 없음 = 해당 채널 ON (lazy creation — 사용자가 OFF 토글할 때만 행 생성).
// transactional 이벤트는 application 레벨에서 prefs 우회 (catalog.transactional = true).
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull(),
    category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),
    channel: text("channel", { enum: NOTIFICATION_CHANNELS }).notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.category, table.channel] }),
  ],
);
