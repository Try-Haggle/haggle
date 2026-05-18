import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const EMAIL_DELIVERY_STATUSES = [
  "queued",     // INSERT 직후, Resend API 호출 전
  "sent",       // Resend API 200 응답
  "delivered",  // webhook: 수신자 서버 수락
  "bounced",    // webhook: 영구 실패 (bad address 등)
  "complained", // webhook: spam 신고
  "failed",     // Resend API 오류 또는 예외
] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull(),                     // auth.users.id — FK 미설정 (코드베이스 컨벤션)
    toEmail: text("to_email").notNull(),                   // 발송 시점 박제 (이메일 변경 대비)

    eventType: text("event_type").notNull(),               // catalog 공유 키 e.g. "user.signed_up"
    provider: text("provider", { enum: ["resend"] }).notNull(),
    providerMessageId: text("provider_message_id"),        // Resend 반환 ID, async 채워짐

    status: text("status", { enum: EMAIL_DELIVERY_STATUSES }).notNull().default("queued"),
    errorMessage: text("error_message"),

    // TODO(notification-queue): cron retry 패턴. attempts >= 3이면 cron이 자연스럽게 건너뜀.
    // 볼륨/요구 증가 시 Inngest 또는 pg-boss 도입 검토.
    attempts: integer("attempts").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),     // `${event_type}:${entity_id}:${user_id}`

    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_deliveries_user_created_idx").on(table.userId, table.createdAt.desc()),
    index("email_deliveries_to_email_idx").on(table.toEmail),
    uniqueIndex("email_deliveries_user_idempotency_uniq").on(table.userId, table.idempotencyKey),
    uniqueIndex("email_deliveries_provider_message_uniq")
      .on(table.provider, table.providerMessageId)
      .where(sql`provider_message_id IS NOT NULL`),
  ],
);
