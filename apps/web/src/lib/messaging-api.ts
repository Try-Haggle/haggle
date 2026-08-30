import type { ListingDetail } from "@/components/listing-detail/types";
import { ApiError, api } from "./api-client";

/** Mirrors the API's conversation subject union. */
export type ConversationSubjectType = "listing" | "order" | "negotiation_session";

export interface ConversationSubject {
  type: ConversationSubjectType;
  id: string;
}

export interface UserDisplay {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface ConversationSummary {
  id: string;
  subject: ConversationSubject | null;
  otherMember: UserDisplay | null;
  lastMessage: { id: string; body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
  lastMessageAt: string;
}

export interface ConversationDetail {
  id: string;
  subject: ConversationSubject | null;
  otherMember: UserDisplay | null;
  unreadCount: number;
  lastReadAt: string | null;
  /** The other side's read position — drives the unread mark on sent bubbles. */
  otherLastReadAt: string | null;
}

export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
  clientMessageId: string | null;
}

/**
 * The panel renders the listing page's own components, so it takes the listing
 * page's own type — the API hands back the identical buyer-safe payload.
 */
export type SubjectListing = ListingDetail;

/**
 * Retry once when a read comes back 401.
 *
 * Right after sign-in (or while a token is refreshing) the Supabase client can
 * hand out no access token for a moment, so the request goes out unauthenticated.
 * Without this the page renders an empty inbox that never corrects itself.
 */
async function retryOnAuthGap<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return run();
    }
    throw error;
  }
}

export const messagingApi = {
  listConversations: (cursor?: string | null) =>
    retryOnAuthGap(() =>
      api.get<{ conversations: ConversationSummary[]; nextCursor: string | null }>(
        `/api/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      ),
    ),

  unreadCount: () =>
    retryOnAuthGap(() => api.get<{ count: number }>("/api/conversations/unread-count")),

  get: (id: string) =>
    retryOnAuthGap(() => api.get<{ conversation: ConversationDetail }>(`/api/conversations/${id}`)),

  /** Find-or-create. Participants come from the subject, never from the client. */
  open: (subject: ConversationSubject) =>
    api.post<{ conversation: ConversationDetail }>("/api/conversations", {
      subject_type: subject.type,
      subject_id: subject.id,
    }),

  messages: (id: string, before?: string | null) =>
    retryOnAuthGap(() =>
      api.get<{ messages: Message[]; nextCursor: string | null }>(
        `/api/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`,
      ),
    ),

  send: (id: string, body: string, clientMessageId: string) =>
    api.post<{ message: Message }>(`/api/conversations/${id}/messages`, {
      body,
      client_message_id: clientMessageId,
    }),

  markRead: (id: string) =>
    api.post<{ readAt: string; unreadCount: number }>(`/api/conversations/${id}/read`),

  subject: (id: string) =>
    api.get<{
      subject: ConversationSubject | null;
      listing: SubjectListing | null;
      sellerId: string | null;
    }>(`/api/conversations/${id}/subject`),
};

// ─── Realtime event payloads (delivered over the shared user socket) ──────────

export interface MessageNewEvent {
  type: "message.new";
  conversationId: string;
  message: Message & { truncated?: boolean };
}

export interface MessageReadEvent {
  type: "message.read";
  conversationId: string;
  readerId: string;
  readAt: string;
}
