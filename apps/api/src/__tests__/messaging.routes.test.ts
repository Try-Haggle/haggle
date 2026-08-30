/**
 * Route tests for /api/conversations/*.
 *
 * Service layer mocked: what is verified here is the wiring — auth gates,
 * validation, the 404-for-non-members rule, idempotent sends, and which
 * realtime events each endpoint fans out.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_HEADERS, closeTestApp, getTestApp } from "./helpers.js";

const CONVERSATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TEST_USER_ID = "test-user-001";

const listConversations = vi.fn();
const getConversationForUser = vi.fn();
const listMessages = vi.fn();
const sendMessage = vi.fn();
const markConversationRead = vi.fn();
const getUnreadSummary = vi.fn();
const resolveSubjectParticipants = vi.fn();
const findOrCreateConversation = vi.fn();

vi.mock("../services/messaging.service.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listConversations: (...args: unknown[]) => listConversations(...args),
    getConversationForUser: (...args: unknown[]) => getConversationForUser(...args),
    listMessages: (...args: unknown[]) => listMessages(...args),
    sendMessage: (...args: unknown[]) => sendMessage(...args),
    markConversationRead: (...args: unknown[]) => markConversationRead(...args),
    getUnreadSummary: (...args: unknown[]) => getUnreadSummary(...args),
    resolveSubjectParticipants: (...args: unknown[]) => resolveSubjectParticipants(...args),
    findOrCreateConversation: (...args: unknown[]) => findOrCreateConversation(...args),
  };
});

const publishToUsers = vi.fn();
vi.mock("../realtime/publish.js", () => ({
  publishToUsers: (...args: unknown[]) => publishToUsers(...args),
  publishToSession: vi.fn(),
}));

let app: FastifyInstance;

const membership = {
  id: CONVERSATION_ID,
  subject: { type: "negotiation_session", id: SESSION_ID },
  otherMember: { id: OTHER_USER_ID, displayName: "Counterparty", avatarUrl: null },
  unreadCount: 0,
  lastReadAt: null,
};

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
});

beforeEach(() => {
  vi.clearAllMocks();
  getConversationForUser.mockResolvedValue(membership);
  listConversations.mockResolvedValue({ items: [], nextCursor: null });
  listMessages.mockResolvedValue({ messages: [], nextCursor: null });
  getUnreadSummary.mockResolvedValue({ total: 0, buying: 0, selling: 0 });
});

describe("auth", () => {
  it.each([
    ["GET", "/api/conversations"],
    ["GET", "/api/conversations/unread-count"],
    ["POST", "/api/conversations"],
    ["GET", `/api/conversations/${CONVERSATION_ID}`],
    ["GET", `/api/conversations/${CONVERSATION_ID}/messages`],
    ["POST", `/api/conversations/${CONVERSATION_ID}/messages`],
    ["POST", `/api/conversations/${CONVERSATION_ID}/read`],
    ["GET", `/api/conversations/${CONVERSATION_ID}/subject`],
  ])("rejects %s %s without a token", async (method, url) => {
    const res = await app.inject({ method: method as "GET", url });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/conversations", () => {
  it("passes the cursor and clamped limit through", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/conversations?limit=999&cursor=2026-08-29T00:00:00.000Z_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(listConversations).toHaveBeenCalledWith(expect.anything(), TEST_USER_ID, {
      cursor: {
        createdAt: "2026-08-29T00:00:00.000Z",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      limit: 50,
      filter: "all",
    });
  });

  it("narrows to one side when asked", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/conversations?filter=selling",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(listConversations).toHaveBeenCalledWith(
      expect.anything(),
      TEST_USER_ID,
      expect.objectContaining({ filter: "selling" }),
    );
  });

  it("shows everything when the filter is unrecognised — narrowing is never a guess", async () => {
    await app.inject({
      method: "GET",
      url: "/api/conversations?filter=sideways",
      headers: AUTH_HEADERS,
    });

    expect(listConversations).toHaveBeenCalledWith(
      expect.anything(),
      TEST_USER_ID,
      expect.objectContaining({ filter: "all" }),
    );
  });

  it("reports unread whole and by side, so a hidden side can still announce itself", async () => {
    getUnreadSummary.mockResolvedValue({ total: 5, buying: 2, selling: 3 });

    const res = await app.inject({
      method: "GET",
      url: "/api/conversations/unread-count",
      headers: AUTH_HEADERS,
    });

    // `count` is the whole number: the nav badge must not follow the page filter.
    expect(res.json()).toEqual({ count: 5, total: 5, buying: 2, selling: 3 });
  });

  it("ignores a malformed cursor instead of failing the request", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/conversations?cursor=garbage",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(listConversations).toHaveBeenCalledWith(
      expect.anything(),
      TEST_USER_ID,
      expect.objectContaining({ cursor: null }),
    );
  });
});

describe("POST /api/conversations", () => {
  it("creates a thread from a negotiation session the caller belongs to", async () => {
    resolveSubjectParticipants.mockResolvedValue({
      ok: true,
      participantIds: [TEST_USER_ID, OTHER_USER_ID],
    });
    findOrCreateConversation.mockResolvedValue({ id: CONVERSATION_ID, created: true });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: AUTH_HEADERS,
      payload: { subject_type: "negotiation_session", subject_id: SESSION_ID },
    });

    expect(res.statusCode).toBe(201);
    expect(findOrCreateConversation).toHaveBeenCalledWith(expect.anything(), {
      subject: { type: "negotiation_session", id: SESSION_ID },
      participantIds: [TEST_USER_ID, OTHER_USER_ID],
    });
  });

  it("returns 200 when the thread already exists (find-or-create)", async () => {
    resolveSubjectParticipants.mockResolvedValue({
      ok: true,
      participantIds: [TEST_USER_ID, OTHER_USER_ID],
    });
    findOrCreateConversation.mockResolvedValue({ id: CONVERSATION_ID, created: false });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: AUTH_HEADERS,
      payload: { subject_type: "negotiation_session", subject_id: SESSION_ID },
    });

    expect(res.statusCode).toBe(200);
  });

  it("404s when the caller is not part of the subject", async () => {
    resolveSubjectParticipants.mockResolvedValue({ ok: false, reason: "NOT_FOUND" });

    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: AUTH_HEADERS,
      payload: { subject_type: "negotiation_session", subject_id: SESSION_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(findOrCreateConversation).not.toHaveBeenCalled();
  });

  it("rejects a listing subject — a thread starts from a negotiation", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: AUTH_HEADERS,
      payload: { subject_type: "listing", subject_id: SESSION_ID },
    });

    expect(res.statusCode).toBe(400);
    expect(resolveSubjectParticipants).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied participant", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: AUTH_HEADERS,
      payload: {
        subject_type: "negotiation_session",
        subject_id: SESSION_ID,
        participant_user_id: OTHER_USER_ID,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("membership gate", () => {
  it.each([
    ["GET", `/api/conversations/${CONVERSATION_ID}`],
    ["GET", `/api/conversations/${CONVERSATION_ID}/messages`],
    ["GET", `/api/conversations/${CONVERSATION_ID}/subject`],
    ["POST", `/api/conversations/${CONVERSATION_ID}/read`],
  ])("404s %s %s for a non-member", async (method, url) => {
    getConversationForUser.mockResolvedValue(null);

    const res = await app.inject({
      method: method as "GET",
      url,
      headers: AUTH_HEADERS,
      payload: method === "POST" ? {} : undefined,
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects a non-uuid conversation id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/conversations/not-a-uuid",
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/conversations/:id/messages", () => {
  const message = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    senderId: TEST_USER_ID,
    body: "hello",
    createdAt: "2026-08-29T00:00:00.000Z",
    clientMessageId: "c-1",
  };

  it("stores the message and fans it out to both sides", async () => {
    sendMessage.mockResolvedValue({ message, recipientIds: [OTHER_USER_ID], duplicate: false });

    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
      payload: { body: "hello", client_message_id: "c-1" },
    });

    expect(res.statusCode).toBe(201);
    expect(publishToUsers).toHaveBeenCalledWith(
      [OTHER_USER_ID, TEST_USER_ID],
      expect.objectContaining({
        type: "message.new",
        conversationId: CONVERSATION_ID,
        message: expect.objectContaining({ body: "hello", truncated: false }),
      }),
    );
  });

  it("does not re-announce an idempotent retry", async () => {
    sendMessage.mockResolvedValue({ message, recipientIds: [OTHER_USER_ID], duplicate: true });

    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
      payload: { body: "hello", client_message_id: "c-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(publishToUsers).not.toHaveBeenCalled();
  });

  it("omits an oversized body from the event so the NOTIFY payload stays small", async () => {
    const long = "가".repeat(1500); // > 2000 bytes in UTF-8
    sendMessage.mockResolvedValue({
      message: { ...message, body: long },
      recipientIds: [OTHER_USER_ID],
      duplicate: false,
    });

    await app.inject({
      method: "POST",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
      payload: { body: long },
    });

    const event = publishToUsers.mock.calls[0][1] as { message: Record<string, unknown> };
    expect(event.message.truncated).toBe(true);
    expect(event.message.body).toBeUndefined();
  });

  it("404s when the sender is not a member", async () => {
    sendMessage.mockResolvedValue(null);

    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
      payload: { body: "hello" },
    });

    expect(res.statusCode).toBe(404);
    expect(publishToUsers).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", { body: "" }],
    ["whitespace only", { body: "   " }],
    ["over the length cap", { body: "x".repeat(4001) }],
    ["missing", {}],
  ])("rejects a %s body", async (_label, payload) => {
    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
      payload,
    });

    expect(res.statusCode).toBe(400);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/conversations/:id/read", () => {
  it("acknowledges the read and tells both sides", async () => {
    markConversationRead.mockResolvedValue({
      readAt: "2026-08-29T00:00:00.000Z",
      unreadCount: 0,
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/conversations/${CONVERSATION_ID}/read`,
      headers: AUTH_HEADERS,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ readAt: "2026-08-29T00:00:00.000Z", unreadCount: 0 });
    expect(publishToUsers).toHaveBeenCalledWith(
      [TEST_USER_ID, OTHER_USER_ID],
      expect.objectContaining({ type: "message.read", readerId: TEST_USER_ID }),
    );
  });
});

describe("GET /api/conversations/:id/messages", () => {
  it("does not mark the thread read — that is what POST /read is for", async () => {
    await app.inject({
      method: "GET",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
    });

    expect(markConversationRead).not.toHaveBeenCalled();
    expect(publishToUsers).not.toHaveBeenCalled();
  });

  it("defaults to the 50-message page size", async () => {
    await app.inject({
      method: "GET",
      url: `/api/conversations/${CONVERSATION_ID}/messages`,
      headers: AUTH_HEADERS,
    });

    expect(listMessages).toHaveBeenCalledWith(expect.anything(), CONVERSATION_ID, {
      before: null,
      limit: 50,
    });
  });
});
