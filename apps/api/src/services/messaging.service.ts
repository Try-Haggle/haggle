/**
 * 1:1 messaging between people.
 *
 * A conversation points at a polymorphic *subject* rather than at a listing, so
 * the same thread model covers a negotiation session today and an order thread
 * later. Participants are never taken from the request: they are derived from
 * the subject, which is what enforces the product rule that the agents
 * negotiate first and the humans talk afterwards.
 */

import {
  type ConversationSubjectType,
  conversationMembers,
  conversations,
  type Database,
  MESSAGE_PREVIEW_MAX_LENGTH,
  sql,
} from "@haggle/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationSubject {
  type: ConversationSubjectType;
  id: string;
}

export interface UserDisplay {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Which side of the subject this viewer is on.
 *
 * Derived from the subject rather than stored on the membership: the seller of
 * a negotiation is a fact that already exists, and copying it here would be one
 * more thing that can drift.
 */
export type ConversationSide = "buying" | "selling";

export const CONVERSATION_FILTERS = ["all", "buying", "selling"] as const;
export type ConversationFilter = (typeof CONVERSATION_FILTERS)[number];

export function parseConversationFilter(raw: string | undefined): ConversationFilter {
  return CONVERSATION_FILTERS.includes(raw as ConversationFilter)
    ? (raw as ConversationFilter)
    : "all";
}

export interface ConversationListItem {
  id: string;
  subject: ConversationSubject | null;
  /** Null when the subject is gone or has no sides. */
  side: ConversationSide | null;
  otherMember: UserDisplay | null;
  lastMessage: { id: string; body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  lastMessageAt: string;
}

export interface ConversationDetail {
  id: string;
  subject: ConversationSubject | null;
  /** Which side of the subject the viewer is on. Null when the subject is gone. */
  side: ConversationSide | null;
  otherMember: UserDisplay | null;
  unreadCount: number;
  lastReadAt: string | null;
  /** The other side's read position — drives the "unread" mark on sent bubbles. */
  otherLastReadAt: string | null;
}

export interface MessageItem {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  clientMessageId: string | null;
}

export interface SendMessageResult {
  message: MessageItem;
  /** Everyone in the thread except the sender — the fan-out audience. */
  recipientIds: string[];
  /** True when an Idempotency retry resolved to the already-stored message. */
  duplicate: boolean;
}

export type SubjectResolution =
  | { ok: true; participantIds: string[] }
  | { ok: false; reason: "NOT_FOUND" | "UNSUPPORTED_SUBJECT" };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
/** Mirrors the original Django app's page size for the message thread. */
export const MESSAGE_PAGE_SIZE = 50;

// ─── Row helpers ──────────────────────────────────────────────────────────────

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// ─── Cursors ──────────────────────────────────────────────────────────────────

export interface Cursor {
  createdAt: string;
  id: string;
}

/**
 * `<iso timestamp>_<uuid>`. The id half is what makes the cursor total: paging
 * on the timestamp alone drops messages that share a timestamp, which is
 * exactly the bug the original `created_at__lt` cursor had.
 */
export function encodeCursor(cursor: Cursor): string {
  return `${cursor.createdAt}_${cursor.id}`;
}

export function decodeCursor(raw: string | undefined | null): Cursor | null {
  if (!raw) return null;
  const sep = raw.lastIndexOf("_");
  if (sep <= 0) return null;
  const createdAt = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (Number.isNaN(Date.parse(createdAt))) return null;
  if (!UUID_PATTERN.test(id)) return null;
  return { createdAt, id };
}

export function clampLimit(raw: string | number | undefined, fallback = DEFAULT_PAGE_SIZE): number {
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (!parsed || Number.isNaN(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
}

// ─── Participant key ──────────────────────────────────────────────────────────

/**
 * Deterministic thread identity. Sorting the ids means (a,b) and (b,a) collide
 * on the UNIQUE index, which is what turns find-or-create into one atomic
 * INSERT ... ON CONFLICT instead of a read-then-write race.
 */
export function buildParticipantKey(
  participantIds: string[],
  subject: ConversationSubject | null,
): string {
  const people = [...participantIds]
    .map((id) => id.toLowerCase())
    .sort()
    .join(":");
  const scope = subject ? `${subject.type}:${subject.id.toLowerCase()}` : "none";
  return `v1|${scope}|${people}`;
}

export function truncatePreview(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length > MESSAGE_PREVIEW_MAX_LENGTH
    ? `${collapsed.slice(0, MESSAGE_PREVIEW_MAX_LENGTH - 1)}…`
    : collapsed;
}

// ─── Subject → participants ───────────────────────────────────────────────────

/**
 * Who is allowed to talk about this subject.
 *
 * `listing` is deliberately unsupported: messaging a seller straight off a
 * listing would bypass the negotiation the product is built around.
 */
export async function resolveSubjectParticipants(
  db: Database,
  subject: ConversationSubject,
  requesterId: string,
): Promise<SubjectResolution> {
  if (subject.type === "listing") {
    return { ok: false, reason: "UNSUPPORTED_SUBJECT" };
  }

  // Written out per branch rather than interpolating a table name, so no part
  // of this query is ever assembled from a string.
  const query =
    subject.type === "negotiation_session"
      ? sql`SELECT buyer_id, seller_id FROM negotiation_sessions WHERE id = ${subject.id}::uuid LIMIT 1`
      : sql`SELECT buyer_id, seller_id FROM commerce_orders WHERE id = ${subject.id}::uuid LIMIT 1`;

  const rows = rowsOf<{ buyer_id: string; seller_id: string }>(await db.execute(query));

  const row = rows[0];
  if (!row) return { ok: false, reason: "NOT_FOUND" };
  // Not a participant → same answer as "does not exist", so the endpoint never
  // confirms that someone else's session id is real.
  if (row.buyer_id !== requesterId && row.seller_id !== requesterId) {
    return { ok: false, reason: "NOT_FOUND" };
  }
  if (row.buyer_id === row.seller_id) return { ok: false, reason: "UNSUPPORTED_SUBJECT" };

  return { ok: true, participantIds: [row.buyer_id, row.seller_id] };
}

// ─── User display info ────────────────────────────────────────────────────────

/** Batch lookup against auth.users (no FK — same convention as notifications). */
export async function getUserDisplays(
  db: Database,
  userIds: string[],
): Promise<Map<string, UserDisplay>> {
  const unique = [...new Set(userIds)].filter((id) => UUID_PATTERN.test(id));
  const result = new Map<string, UserDisplay>();
  if (unique.length === 0) return result;

  // Key order mirrors what the app itself displays (see the (app) layout):
  // a photo uploaded in settings lands in custom_avatar_url, an OAuth picture in
  // avatar_url, and the name the user typed in display_name. Reading only the
  // OAuth keys showed the initial-letter fallback next to a person who had set
  // a photo.
  const rows = rowsOf<{ id: string; display_name: string; avatar_url: string | null }>(
    await db.execute(sql`
      SELECT id,
        COALESCE(
          NULLIF(raw_user_meta_data->>'display_name', ''),
          NULLIF(raw_user_meta_data->>'full_name', ''),
          NULLIF(raw_user_meta_data->>'name', ''),
          split_part(email, '@', 1),
          'Haggle user'
        ) AS display_name,
        COALESCE(
          NULLIF(raw_user_meta_data->>'custom_avatar_url', ''),
          NULLIF(raw_user_meta_data->>'avatar_url', '')
        ) AS avatar_url
      FROM auth.users
      WHERE id IN (
        SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(unique)}::jsonb) AS value
      )
    `),
  );

  for (const row of rows) {
    result.set(row.id, {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    });
  }
  return result;
}

// ─── Membership ───────────────────────────────────────────────────────────────

export async function isConversationMember(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const rows = rowsOf<{ ok: boolean }>(
    await db.execute(sql`
      SELECT true AS ok FROM conversation_members
      WHERE conversation_id = ${conversationId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `),
  );
  return rows.length === 1;
}

// ─── Find or create ───────────────────────────────────────────────────────────

export async function findOrCreateConversation(
  db: Database,
  input: { subject: ConversationSubject; participantIds: string[] },
): Promise<{ id: string; created: boolean }> {
  const participantKey = buildParticipantKey(input.participantIds, input.subject);

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(conversations)
      .values({
        subjectType: input.subject.type,
        subjectId: input.subject.id,
        participantKey,
      })
      .onConflictDoNothing({ target: conversations.participantKey })
      .returning({ id: conversations.id });

    if (inserted.length === 0) {
      // Lost the race (or it already existed) — the UNIQUE index guarantees
      // exactly one row, so no second insert path is needed.
      const existing = rowsOf<{ id: string }>(
        await tx.execute(
          sql`SELECT id FROM conversations WHERE participant_key = ${participantKey} LIMIT 1`,
        ),
      );
      return { id: existing[0].id, created: false };
    }

    const conversationId = inserted[0].id;
    await tx
      .insert(conversationMembers)
      .values(
        input.participantIds.map((userId) => ({
          conversationId,
          userId,
        })),
      )
      .onConflictDoNothing();

    return { id: conversationId, created: true };
  });
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * The subject's two sides, joined in so a conversation can be filtered by the
 * role the viewer plays in it. Both joins are primary-key lookups and only one
 * of them ever matches, so the cost is a row fetch per conversation on the page.
 */
const SUBJECT_JOINS = sql`
  LEFT JOIN negotiation_sessions ns
    ON c.subject_type = 'negotiation_session' AND ns.id = c.subject_id
  LEFT JOIN commerce_orders co
    ON c.subject_type = 'order' AND co.id = c.subject_id
`;

function SIDE_EXPRESSION(userId: string) {
  return sql`CASE
    WHEN COALESCE(ns.seller_id, co.seller_id) = ${userId}::uuid THEN 'selling'
    WHEN COALESCE(ns.buyer_id, co.buyer_id) = ${userId}::uuid THEN 'buying'
    ELSE NULL
  END`;
}

interface ConversationRow {
  id: string;
  subject_type: ConversationSubjectType | null;
  subject_id: string | null;
  last_message_at: Date | string;
  last_message_preview: string | null;
  unread_count: number;
  other_user_id: string | null;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_sender_id: string | null;
  last_message_created_at: Date | string | null;
  side: ConversationSide | null;
}

export async function listConversations(
  db: Database,
  userId: string,
  options: { cursor?: Cursor | null; limit?: number; filter?: ConversationFilter } = {},
): Promise<{ items: ConversationListItem[]; nextCursor: string | null }> {
  const limit = options.limit ?? DEFAULT_PAGE_SIZE;
  const cursor = options.cursor ?? null;
  const filter = options.filter ?? "all";

  const rows = rowsOf<ConversationRow>(
    await db.execute(sql`
      SELECT c.id,
             c.subject_type,
             c.subject_id,
             m.last_message_at,
             c.last_message_preview,
             m.unread_count,
             other.user_id AS other_user_id,
             lm.id AS last_message_id,
             lm.body AS last_message_body,
             lm.sender_id AS last_message_sender_id,
             lm.created_at AS last_message_created_at,
             ${SIDE_EXPRESSION(userId)} AS side
      FROM conversation_members m
      JOIN conversations c ON c.id = m.conversation_id
      ${SUBJECT_JOINS}
      LEFT JOIN LATERAL (
        SELECT om.user_id
        FROM conversation_members om
        WHERE om.conversation_id = c.id AND om.user_id <> m.user_id
        ORDER BY om.created_at ASC
        LIMIT 1
      ) other ON true
      LEFT JOIN messages lm ON lm.id = c.last_message_id
      WHERE m.user_id = ${userId}::uuid
        ${
          filter === "all"
            ? sql``
            : // Filtered in SQL, before the page is cut. The original filtered
              // in memory after slicing by limit, which silently shrank pages.
              sql`AND ${SIDE_EXPRESSION(userId)} = ${filter === "selling" ? "selling" : "buying"}`
        }
        ${
          cursor
            ? sql`AND (m.last_message_at, m.conversation_id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
            : sql``
        }
      ORDER BY m.last_message_at DESC, m.conversation_id DESC
      LIMIT ${limit + 1}
    `),
  );

  const page = rows.slice(0, limit);
  const displays = await getUserDisplays(
    db,
    page.map((row) => row.other_user_id).filter((id): id is string => Boolean(id)),
  );

  const items: ConversationListItem[] = page.map((row) => ({
    id: row.id,
    subject:
      row.subject_type && row.subject_id ? { type: row.subject_type, id: row.subject_id } : null,
    side: row.side ?? null,
    otherMember: row.other_user_id ? (displays.get(row.other_user_id) ?? null) : null,
    lastMessage:
      row.last_message_id && row.last_message_body !== null && row.last_message_created_at
        ? {
            id: row.last_message_id,
            body: row.last_message_body,
            senderId: row.last_message_sender_id ?? "",
            createdAt: iso(row.last_message_created_at),
          }
        : null,
    unreadCount: Number(row.unread_count) || 0,
    lastMessageAt: iso(row.last_message_at),
  }));

  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ createdAt: iso(last.last_message_at), id: last.id })
      : null;

  return { items, nextCursor };
}

export async function getConversationForUser(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<ConversationDetail | null> {
  const rows = rowsOf<{
    id: string;
    subject_type: ConversationSubjectType | null;
    subject_id: string | null;
    side: ConversationSide | null;
    unread_count: number;
    last_read_at: Date | string | null;
    other_user_id: string | null;
    other_last_read_at: Date | string | null;
  }>(
    await db.execute(sql`
      SELECT c.id, c.subject_type, c.subject_id, m.unread_count, m.last_read_at,
             ${SIDE_EXPRESSION(userId)} AS side,
             other.user_id AS other_user_id, other.last_read_at AS other_last_read_at
      FROM conversation_members m
      JOIN conversations c ON c.id = m.conversation_id
      ${SUBJECT_JOINS}
      LEFT JOIN LATERAL (
        SELECT om.user_id, om.last_read_at FROM conversation_members om
        WHERE om.conversation_id = c.id AND om.user_id <> m.user_id
        ORDER BY om.created_at ASC LIMIT 1
      ) other ON true
      WHERE m.conversation_id = ${conversationId}::uuid AND m.user_id = ${userId}::uuid
      LIMIT 1
    `),
  );

  const row = rows[0];
  if (!row) return null;

  const displays = row.other_user_id ? await getUserDisplays(db, [row.other_user_id]) : null;

  return {
    id: row.id,
    subject:
      row.subject_type && row.subject_id ? { type: row.subject_type, id: row.subject_id } : null,
    side: row.side ?? null,
    otherMember: row.other_user_id ? (displays?.get(row.other_user_id) ?? null) : null,
    unreadCount: Number(row.unread_count) || 0,
    lastReadAt: row.last_read_at ? iso(row.last_read_at) : null,
    otherLastReadAt: row.other_last_read_at ? iso(row.other_last_read_at) : null,
  };
}

export async function listMessages(
  db: Database,
  conversationId: string,
  options: { before?: Cursor | null; limit?: number } = {},
): Promise<{ messages: MessageItem[]; nextCursor: string | null }> {
  const limit = options.limit ?? MESSAGE_PAGE_SIZE;
  const before = options.before ?? null;

  const rows = rowsOf<{
    id: string;
    sender_id: string;
    body: string;
    client_message_id: string | null;
    created_at: Date | string;
  }>(
    await db.execute(sql`
      SELECT id, sender_id, body, client_message_id, created_at
      FROM messages
      WHERE conversation_id = ${conversationId}::uuid
        ${
          before
            ? sql`AND (created_at, id) < (${before.createdAt}::timestamptz, ${before.id}::uuid)`
            : sql``
        }
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit + 1}
    `),
  );

  const page = rows.slice(0, limit);
  const oldest = page[page.length - 1];
  const nextCursor =
    rows.length > limit && oldest
      ? encodeCursor({ createdAt: iso(oldest.created_at), id: oldest.id })
      : null;

  // Stored newest-first for the cursor; the thread renders oldest-first.
  const messages = page
    .map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: iso(row.created_at),
      clientMessageId: row.client_message_id,
    }))
    .reverse();

  return { messages, nextCursor };
}

export interface UnreadSummary {
  /** Everything, whatever side it is on. */
  total: number;
  buying: number;
  selling: number;
}

/**
 * Unread, whole and by side.
 *
 * The total is what the navigation shows: a filter defaulting to one side must
 * never be able to hide the fact that something is waiting. The per-side counts
 * let the filter itself say which side that is.
 */
export async function getUnreadSummary(db: Database, userId: string): Promise<UnreadSummary> {
  const rows = rowsOf<{
    total: string | number;
    buying: string | number;
    selling: string | number;
  }>(
    await db.execute(sql`
      SELECT
        COALESCE(SUM(m.unread_count), 0) AS total,
        COALESCE(SUM(m.unread_count) FILTER (WHERE ${SIDE_EXPRESSION(userId)} = 'buying'), 0) AS buying,
        COALESCE(SUM(m.unread_count) FILTER (WHERE ${SIDE_EXPRESSION(userId)} = 'selling'), 0) AS selling
      FROM conversation_members m
      JOIN conversations c ON c.id = m.conversation_id
      ${SUBJECT_JOINS}
      WHERE m.user_id = ${userId}::uuid
    `),
  );
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    buying: Number(row?.buying ?? 0),
    selling: Number(row?.selling ?? 0),
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function sendMessage(
  db: Database,
  input: {
    conversationId: string;
    senderId: string;
    body: string;
    clientMessageId?: string | null;
  },
): Promise<SendMessageResult | null> {
  const preview = truncatePreview(input.body);

  return db.transaction(async (tx) => {
    const members = rowsOf<{ user_id: string }>(
      await tx.execute(sql`
        SELECT user_id FROM conversation_members
        WHERE conversation_id = ${input.conversationId}::uuid
      `),
    );
    if (!members.some((m) => m.user_id === input.senderId)) return null;

    const inserted = rowsOf<{
      id: string;
      sender_id: string;
      body: string;
      client_message_id: string | null;
      created_at: Date | string;
    }>(
      await tx.execute(sql`
        INSERT INTO messages (conversation_id, sender_id, body, client_message_id)
        VALUES (
          ${input.conversationId}::uuid,
          ${input.senderId}::uuid,
          ${input.body},
          ${input.clientMessageId ?? null}
        )
        ON CONFLICT (conversation_id, client_message_id) WHERE client_message_id IS NOT NULL
        DO NOTHING
        RETURNING id, sender_id, body, client_message_id, created_at
      `),
    );

    const recipientIds = members.map((m) => m.user_id).filter((id) => id !== input.senderId);

    if (inserted.length === 0) {
      // Idempotent retry: return the stored message, and leave the unread
      // counters alone so a retry cannot inflate them.
      const existing = rowsOf<{
        id: string;
        sender_id: string;
        body: string;
        client_message_id: string | null;
        created_at: Date | string;
      }>(
        await tx.execute(sql`
          SELECT id, sender_id, body, client_message_id, created_at
          FROM messages
          WHERE conversation_id = ${input.conversationId}::uuid
            AND client_message_id = ${input.clientMessageId ?? null}
          LIMIT 1
        `),
      );
      const row = existing[0];
      if (!row) return null;
      return {
        message: {
          id: row.id,
          senderId: row.sender_id,
          body: row.body,
          createdAt: iso(row.created_at),
          clientMessageId: row.client_message_id,
        },
        recipientIds,
        duplicate: true,
      };
    }

    const row = inserted[0];

    await tx.execute(sql`
      UPDATE conversations
      SET last_message_id = ${row.id}::uuid,
          last_message_at = ${row.created_at},
          last_message_preview = ${preview},
          updated_at = now()
      WHERE id = ${input.conversationId}::uuid
    `);

    // One statement for both members: the sender's own message is read by
    // definition, everyone else gains an unread.
    await tx.execute(sql`
      UPDATE conversation_members
      SET last_message_at = ${row.created_at},
          unread_count = CASE WHEN user_id = ${input.senderId}::uuid THEN 0 ELSE unread_count + 1 END,
          last_read_at = CASE WHEN user_id = ${input.senderId}::uuid THEN ${row.created_at} ELSE last_read_at END
      WHERE conversation_id = ${input.conversationId}::uuid
    `);

    return {
      message: {
        id: row.id,
        senderId: row.sender_id,
        body: row.body,
        createdAt: iso(row.created_at),
        clientMessageId: row.client_message_id,
      },
      recipientIds,
      duplicate: false,
    };
  });
}

export async function markConversationRead(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<{ readAt: string; unreadCount: number } | null> {
  // unread_count is a cache; the count derived from last_read_at is the source
  // of truth, so the ack recomputes it rather than blindly zeroing.
  const rows = rowsOf<{ last_read_at: Date | string; unread_count: number }>(
    await db.execute(sql`
      WITH ack AS (SELECT now() AS at)
      UPDATE conversation_members m
      SET last_read_at = ack.at,
          unread_count = (
            SELECT count(*) FROM messages msg
            WHERE msg.conversation_id = m.conversation_id
              AND msg.sender_id <> m.user_id
              AND msg.created_at > ack.at
          )
      FROM ack
      WHERE m.conversation_id = ${conversationId}::uuid AND m.user_id = ${userId}::uuid
      RETURNING m.last_read_at, m.unread_count
    `),
  );

  const row = rows[0];
  if (!row) return null;
  return { readAt: iso(row.last_read_at), unreadCount: Number(row.unread_count) || 0 };
}

// ─── Negotiation outcome ──────────────────────────────────────────────────────

/**
 * The session's own status vocabulary is eleven values wide and most of it is
 * mid-flight state. What a reader of the thread needs is the result, so the
 * statuses that end a negotiation are collapsed to four and everything else
 * yields no outcome at all.
 */
export type ConversationOutcomeStatus = "DEAL" | "NEAR_DEAL" | "NO_DEAL" | "EXPIRED";

const OUTCOME_BY_SESSION_STATUS: Record<string, ConversationOutcomeStatus> = {
  ACCEPTED: "DEAL",
  NEAR_DEAL: "NEAR_DEAL",
  STALLED: "NEAR_DEAL",
  REJECTED: "NO_DEAL",
  EXPIRED: "EXPIRED",
  SUPERSEDED: "EXPIRED",
};

export interface ConversationOutcome {
  status: ConversationOutcomeStatus;
  /** Settled price on a deal, the last price on the table otherwise. Minor units. */
  priceMinor: number | null;
  rounds: number;
  /** When the negotiation stopped moving. */
  settledAt: string | null;
}

function toMinor(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * The negotiation result behind a conversation, or null when there isn't one:
 * an unsupported subject, or a session that is still running.
 *
 * Read on the conversation-detail endpoint only. Membership is checked by the
 * caller, which is why this takes a subject rather than a conversation.
 */
export async function getConversationOutcome(
  db: Database,
  subject: ConversationSubject | null,
): Promise<ConversationOutcome | null> {
  if (subject?.type !== "negotiation_session") return null;

  const rows = rowsOf<{
    status: string;
    current_round: number;
    last_offer_price_minor: string | number | null;
    updated_at: Date | string | null;
  }>(
    await db.execute(sql`
      SELECT ns.status, ns.current_round, ns.last_offer_price_minor, ns.updated_at
      FROM negotiation_sessions ns
      WHERE ns.id = ${subject.id}::uuid
      LIMIT 1
    `),
  );

  const row = rows[0];
  if (!row) return null;

  const status = OUTCOME_BY_SESSION_STATUS[row.status];
  if (!status) return null;

  return {
    status,
    priceMinor: toMinor(row.last_offer_price_minor),
    rounds: Number(row.current_round) || 0,
    settledAt: row.updated_at ? iso(row.updated_at) : null,
  };
}
