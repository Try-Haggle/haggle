import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * 1:1 human ↔ human messaging.
 *
 * Deliberately NOT tied to a listing: a conversation points at a polymorphic
 * *subject* instead, so the same thread model covers a negotiation session
 * today and an order/dispute thread later. `subject_id` carries no FK — the
 * same convention the rest of this schema uses for cross-domain references
 * (see notifications.user_id → auth.users).
 *
 * Participants are never supplied by the client; the API derives them from the
 * subject (negotiation session buyer/seller), which is what enforces "the
 * agents negotiate first, humans talk after".
 */

export const CONVERSATION_SUBJECT_TYPES = ["listing", "order", "negotiation_session"] as const;
export type ConversationSubjectType = (typeof CONVERSATION_SUBJECT_TYPES)[number];

/** Max characters accepted in a single message body. */
export const MESSAGE_BODY_MAX_LENGTH = 4000;
/** Characters of the last message kept denormalized for the list view. */
export const MESSAGE_PREVIEW_MAX_LENGTH = 120;

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    subjectType: text("subject_type", { enum: CONVERSATION_SUBJECT_TYPES }),
    subjectId: uuid("subject_id"),

    /**
     * Deterministic identity of the thread: sorted participant ids + subject.
     * The UNIQUE index on it turns find-or-create into a single atomic
     * INSERT ... ON CONFLICT, instead of the read-then-write race the original
     * Django implementation had in three separate views.
     */
    participantKey: text("participant_key").notNull(),

    lastMessageId: uuid("last_message_id"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    /** Truncated body of the last message — saves a second query per list row. */
    lastMessagePreview: text("last_message_preview"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversations_participant_key_uniq").on(table.participantKey),
    index("conversations_subject_idx").on(table.subjectType, table.subjectId),
    check(
      "conversations_subject_pairing_ck",
      sql`(${table.subjectType} IS NULL) = (${table.subjectId} IS NULL)`,
    ),
  ],
);

export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(), // auth.users.id — FK 미설정 (코드베이스 컨벤션)

    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    /**
     * Cache of "messages after last_read_at". The count derived from
     * last_read_at stays the source of truth and is recomputed on every read
     * ack; this column exists so the list view and the nav badge don't have to
     * aggregate over messages on every request (the original did).
     */
    unreadCount: integer("unread_count").notNull().default(0),
    /** Mirrors conversations.last_message_at so the list sorts from one index. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("conversation_members_conversation_user_uniq").on(
      table.conversationId,
      table.userId,
    ),
    index("conversation_members_user_recent_idx").on(
      table.userId,
      table.lastMessageAt.desc(),
      table.conversationId,
    ),
    check("conversation_members_unread_ck", sql`${table.unreadCount} >= 0`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull(), // auth.users.id — FK 미설정

    body: text("body").notNull(),
    /**
     * Client-generated id. Makes send idempotent across retries and lets the
     * optimistic bubble be reconciled with the WebSocket echo instead of
     * rendering the same message twice.
     */
    clientMessageId: text("client_message_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Cursor pagination reads newest-first within a conversation.
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    uniqueIndex("messages_conversation_client_id_uniq")
      .on(table.conversationId, table.clientMessageId)
      .where(sql`client_message_id IS NOT NULL`),
    check(
      "messages_body_length_ck",
      sql`char_length(${table.body}) BETWEEN 1 AND ${sql.raw(String(MESSAGE_BODY_MAX_LENGTH))}`,
    ),
  ],
);
