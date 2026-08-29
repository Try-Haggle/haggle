/**
 * 1:1 messaging routes.
 *
 * Ported from a Django/HTMX implementation that returned HTML fragments; here
 * every endpoint returns JSON and the client renders it. Two behaviours from
 * the original were deliberately changed:
 *
 *  - Opening a conversation no longer marks it read as a side effect of a GET.
 *    Reads are acknowledged with POST /read.
 *  - Message paging uses a (created_at, id) cursor. The original compared
 *    created_at alone, which silently skipped messages sharing a timestamp.
 */

import { type Database, MESSAGE_BODY_MAX_LENGTH } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { messagesRateLimit } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import { publishToUsers } from "../realtime/publish.js";
import { getListingPlaybackSummaryByInternalId } from "../services/draft.service.js";
import {
  clampLimit,
  decodeCursor,
  findOrCreateConversation,
  getConversationForUser,
  getTotalUnreadCount,
  listConversations,
  listMessages,
  MESSAGE_PAGE_SIZE,
  type MessageItem,
  markConversationRead,
  resolveSubjectParticipants,
  sendMessage,
} from "../services/messaging.service.js";

/**
 * Bodies above this size are announced without their text so the cross-instance
 * NOTIFY payload stays under the pg_notify limit; the client refetches the
 * thread when it sees `truncated`.
 */
const INLINE_BODY_MAX_BYTES = 2000;

const createConversationSchema = z
  .object({
    // "listing" is intentionally absent: a conversation is opened from a
    // negotiation or an order, never straight off a listing.
    subject_type: z.enum(["negotiation_session", "order"]),
    subject_id: z.string().uuid(),
  })
  .strict();

const sendMessageSchema = z
  .object({
    body: z.string().trim().min(1).max(MESSAGE_BODY_MAX_LENGTH),
    client_message_id: z.string().min(1).max(64).optional(),
  })
  .strict();

const uuidSchema = z.string().uuid();

function messageEvent(conversationId: string, message: MessageItem) {
  const oversized = Buffer.byteLength(message.body, "utf8") > INLINE_BODY_MAX_BYTES;
  return {
    type: "message.new" as const,
    conversationId,
    message: oversized
      ? {
          id: message.id,
          senderId: message.senderId,
          createdAt: message.createdAt,
          clientMessageId: message.clientMessageId,
          truncated: true as const,
        }
      : { ...message, truncated: false as const },
  };
}

export function registerMessagingRoutes(app: FastifyInstance, db: Database): void {
  // ─── Conversation list ──────────────────────────────────────────────────────

  app.get("/api/conversations", { preHandler: [requireAuth] }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const { items, nextCursor } = await listConversations(db, request.user!.id, {
      cursor: decodeCursor(query.cursor),
      limit: clampLimit(query.limit),
    });
    return reply.send({ conversations: items, nextCursor });
  });

  // Static path registered alongside /:id — Fastify prefers the literal route.
  app.get(
    "/api/conversations/unread-count",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const count = await getTotalUnreadCount(db, request.user!.id);
      return reply.send({ count });
    },
  );

  // ─── Find or create ─────────────────────────────────────────────────────────

  app.post("/api/conversations", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = createConversationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_CONVERSATION_REQUEST" });

    const subject = { type: parsed.data.subject_type, id: parsed.data.subject_id } as const;
    const resolution = await resolveSubjectParticipants(db, subject, request.user!.id);
    if (!resolution.ok) {
      // NOT_FOUND also covers "you are not part of it", so the endpoint never
      // confirms that someone else's session exists.
      return reply
        .code(resolution.reason === "UNSUPPORTED_SUBJECT" ? 400 : 404)
        .send({ error: resolution.reason });
    }

    const { id, created } = await findOrCreateConversation(db, {
      subject,
      participantIds: resolution.participantIds,
    });
    const detail = await getConversationForUser(db, id, request.user!.id);
    return reply.code(created ? 201 : 200).send({ conversation: detail });
  });

  // ─── Single conversation ────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!uuidSchema.safeParse(request.params.id).success) {
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const detail = await getConversationForUser(db, request.params.id, request.user!.id);
      // Non-members get 404, not 403: membership is the only thing that makes a
      // conversation visible, so its existence is not disclosed either.
      if (!detail) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      return reply.send({ conversation: detail });
    },
  );

  // ─── Subject panel (lazy) ───────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/subject",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!uuidSchema.safeParse(request.params.id).success) {
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const detail = await getConversationForUser(db, request.params.id, request.user!.id);
      if (!detail) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
      if (!detail.subject) return reply.send({ subject: null, listing: null });

      const listing =
        detail.subject.type === "negotiation_session"
          ? await getListingForNegotiationSession(db, detail.subject.id)
          : null;

      return reply.send({
        subject: detail.subject,
        // Same public shape the negotiation detail route exposes — the internal
        // listing id stays server-side.
        listing: listing
          ? {
              publicId: listing.publicId,
              title: listing.title,
              category: listing.category,
              photoUrl: listing.photoUrl,
              targetPrice: listing.targetPrice,
              sellerAgentPreset: listing.sellerAgentPreset,
            }
          : null,
      });
    },
  );

  // ─── Messages ───────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    "/api/conversations/:id/messages",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!uuidSchema.safeParse(request.params.id).success) {
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const detail = await getConversationForUser(db, request.params.id, request.user!.id);
      if (!detail) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });

      const query = request.query as { before?: string; limit?: string };
      const { messages, nextCursor } = await listMessages(db, request.params.id, {
        before: decodeCursor(query.before),
        limit: clampLimit(query.limit, MESSAGE_PAGE_SIZE),
      });
      return reply.send({ messages, nextCursor });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/messages",
    { preHandler: [requireAuth, messagesRateLimit] },
    async (request, reply) => {
      if (!uuidSchema.safeParse(request.params.id).success) {
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_MESSAGE" });

      const result = await sendMessage(db, {
        conversationId: request.params.id,
        senderId: request.user!.id,
        body: parsed.data.body,
        clientMessageId: parsed.data.client_message_id ?? null,
      });
      if (!result) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });

      if (!result.duplicate) {
        // Sender's own other tabs are included so every device converges on the
        // same thread without a refresh.
        publishToUsers(
          [...result.recipientIds, request.user!.id],
          messageEvent(request.params.id, result.message),
        );
      }

      return reply.code(result.duplicate ? 200 : 201).send({ message: result.message });
    },
  );

  // ─── Read acknowledgement ───────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>(
    "/api/conversations/:id/read",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      if (!uuidSchema.safeParse(request.params.id).success) {
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      }
      const detail = await getConversationForUser(db, request.params.id, request.user!.id);
      if (!detail) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });

      const ack = await markConversationRead(db, request.params.id, request.user!.id);
      if (!ack) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });

      const audience = [request.user!.id];
      if (detail.otherMember) audience.push(detail.otherMember.id);
      publishToUsers(audience, {
        type: "message.read",
        conversationId: request.params.id,
        readerId: request.user!.id,
        readAt: ack.readAt,
      });

      return reply.send(ack);
    },
  );
}

/** Listing card shown in the conversation's detail panel. */
async function getListingForNegotiationSession(db: Database, sessionId: string) {
  const rows = (await db.query.negotiationSessions.findMany({
    columns: { listingId: true },
    where: (fields, ops) => ops.eq(fields.id, sessionId),
    limit: 1,
  })) as { listingId: string }[];

  const listingId = rows[0]?.listingId;
  if (!listingId) return null;
  return getListingPlaybackSummaryByInternalId(db, listingId);
}
