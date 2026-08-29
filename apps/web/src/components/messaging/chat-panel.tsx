"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserEvent, useUserEvents } from "@/app/(app)/_components/user-events-provider";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { useMediaQuery } from "@/hooks/use-media-query";
import { type ConversationDetail, type Message, messagingApi } from "@/lib/messaging-api";
import { Composer } from "./composer";
import { mergeMessages } from "./message-grouping";
import { MessageThread } from "./message-thread";
import { SubjectPanel } from "./subject-panel";

interface ChatPanelProps {
  conversation: ConversationDetail;
  currentUserId: string;
  /** Mobile: closes the full-screen overlay. */
  onBack: () => void;
  onRead: (conversationId: string) => void;
}

export function ChatPanel({ conversation, currentUserId, onBack, onRead }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(conversation.otherLastReadAt);
  const { connectionEpoch } = useUserEvents();
  // The sheet portals to <body>, so a CSS-hidden wrapper would not hide it —
  // the variant has to be chosen, not styled away.
  const isCompact = useMediaQuery("(max-width: 767px)");
  const conversationId = conversation.id;
  const otherName = conversation.otherMember?.displayName ?? "Unknown user";

  const acknowledgeRead = useCallback(() => {
    messagingApi
      .markRead(conversationId)
      .then(() => onRead(conversationId))
      .catch(() => {});
  }, [conversationId, onRead]);

  // Initial load, and again after a reconnect — anything published while the
  // socket was down was missed, so the thread is refetched rather than patched.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionEpoch is the reconnect trigger, not a value this effect reads
  useEffect(() => {
    let cancelled = false;
    messagingApi
      .messages(conversationId)
      .then((response) => {
        if (cancelled) return;
        setMessages(response.messages);
        setNextCursor(response.nextCursor);
        acknowledgeRead();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, connectionEpoch, acknowledgeRead]);

  useEffect(() => {
    setOtherReadAt(conversation.otherLastReadAt);
  }, [conversation.otherLastReadAt]);

  const loadOlder = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    messagingApi
      .messages(conversationId, nextCursor)
      .then((response) => {
        setMessages((current) => mergeMessages(response.messages, current));
        setNextCursor(response.nextCursor);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [conversationId, nextCursor, loadingMore]);

  useUserEvent("message.new", (event) => {
    const incoming = event as unknown as {
      conversationId: string;
      message: Message & { truncated?: boolean };
    };
    if (incoming.conversationId !== conversationId) return;

    // A body too large for the realtime payload arrives as a signal only; the
    // thread refetches instead of rendering a message with no text.
    if (incoming.message.truncated) {
      messagingApi
        .messages(conversationId)
        .then((response) => {
          setMessages((current) => mergeMessages(current, response.messages));
        })
        .catch(() => {});
    } else {
      setMessages((current) => mergeMessages(current, [incoming.message]));
    }

    if (incoming.message.senderId !== currentUserId) acknowledgeRead();
  });

  useUserEvent("message.read", (event) => {
    const read = event as unknown as {
      conversationId: string;
      readerId: string;
      readAt: string;
    };
    if (read.conversationId !== conversationId) return;
    if (read.readerId === currentUserId) return;
    setOtherReadAt(read.readAt);
  });

  const pendingRef = useRef(new Set<string>());

  const handleSend = useCallback(
    (body: string) => {
      const clientMessageId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const optimistic: Message = {
        id: `pending-${clientMessageId}`,
        senderId: currentUserId,
        body,
        createdAt: new Date().toISOString(),
        clientMessageId,
      };
      pendingRef.current.add(clientMessageId);
      setMessages((current) => mergeMessages(current, [optimistic]));

      messagingApi
        .send(conversationId, body, clientMessageId)
        .then((response) => {
          // Same clientMessageId → the merge replaces the optimistic bubble
          // rather than showing the message twice.
          setMessages((current) => mergeMessages(current, [response.message]));
        })
        .catch(() => {
          setMessages((current) =>
            current.filter((message) => message.clientMessageId !== clientMessageId),
          );
        })
        .finally(() => pendingRef.current.delete(clientMessageId));
    },
    [conversationId, currentUserId],
  );

  return (
    <div className="flex h-full min-w-0 flex-1 flex-row overflow-hidden">
      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-2 border-line border-b px-3 py-3 md:px-5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to messages"
            className="flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken md:hidden"
          >
            ←
          </button>

          <Avatar
            src={conversation.otherMember?.avatarUrl}
            name={otherName}
            size="sm"
            className="hidden md:inline-flex"
          />

          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-ink text-sm">{otherName}</div>
            {conversation.subject && (
              <div className="truncate text-[0.6875rem] text-ink-muted">
                {conversation.subject.type === "negotiation_session"
                  ? "From a negotiation"
                  : "From an order"}
              </div>
            )}
          </div>

          {conversation.subject?.type === "negotiation_session" && !detailsOpen && (
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="shrink-0 rounded-full bg-surface-sunken px-3 py-1.5 font-semibold text-ink text-xs hover:bg-surface-raised md:px-4 md:text-sm"
            >
              <span className="hidden md:inline">Show details</span>
              <span className="md:hidden">Details</span>
            </button>
          )}
        </header>

        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              bordered={false}
              icon={<span aria-hidden="true">💬</span>}
              title="Start the conversation"
              description={`Send ${otherName} a message about this negotiation.`}
            />
          </div>
        ) : (
          <MessageThread
            messages={messages}
            currentUserId={currentUserId}
            otherMemberName={otherName}
            otherReadAt={otherReadAt}
            hasMore={Boolean(nextCursor)}
            loadingMore={loadingMore}
            onLoadMore={loadOlder}
          />
        )}

        <div className="shrink-0 border-line border-t">
          <Composer onSend={handleSend} />
        </div>
      </div>

      {/* Same content either way: an inline panel on desktop, a sheet on mobile. */}
      <SubjectPanel
        conversationId={conversationId}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        variant={isCompact ? "sheet" : "panel"}
      />
    </div>
  );
}
