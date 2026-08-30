"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useUserEvent, useUserEvents } from "@/app/(app)/_components/user-events-provider";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { useMediaQuery } from "@/hooks/use-media-query";
import { type ConversationDetail, type Message, messagingApi } from "@/lib/messaging-api";
import { Composer } from "./composer";
import { mergeMessages } from "./message-grouping";
import { MessageIcon } from "./message-icon";
import { MessageThread } from "./message-thread";
import { OutcomeStrip } from "./outcome-strip";
import { SubjectPanel } from "./subject-panel";

interface ChatPanelProps {
  conversation: ConversationDetail;
  currentUserId: string;
  /** Mobile: closes the full-screen overlay. */
  onBack: () => void;
  onRead: (conversationId: string) => void;
  /**
   * Owned by the shell: on a narrow desktop the open panel also decides whether
   * the conversation list stays on screen, and that is not this component's to
   * know about.
   */
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
}

export function ChatPanel({
  conversation,
  currentUserId,
  onBack,
  onRead,
  detailsOpen,
  onDetailsOpenChange,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
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
      <div
        data-testid="thread-column"
        className="flex h-full min-w-0 flex-1 flex-col overflow-hidden"
      >
        {/* h-14 is the shared header rail: the listing panel's header uses the
            same height so the two columns line up across the divider. */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-line border-b px-3 md:px-5">
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
          </div>

          {conversation.subject?.type === "negotiation_session" && !detailsOpen && (
            <button
              type="button"
              onClick={() => onDetailsOpenChange(true)}
              className="shrink-0 rounded-full bg-surface-sunken px-3 py-1.5 font-semibold text-ink text-xs hover:bg-surface-raised md:px-4 md:text-sm"
            >
              {/* A verb, and named for what it opens: "Show details" said
                  nothing about which details, next to a strip that is also
                  details. It shares "View" with the strip's link below, and
                  the arrow there is what separates the two — this one opens a
                  panel and stays on the page. */}
              <span className="hidden md:inline">View listing</span>
              <span className="md:hidden">Listing</span>
            </button>
          )}
        </header>

        {conversation.outcome && (
          <OutcomeStrip
            outcome={conversation.outcome}
            side={conversation.side}
            sessionId={
              conversation.subject?.type === "negotiation_session" ? conversation.subject.id : null
            }
          />
        )}

        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              bordered={false}
              icon={<MessageIcon />}
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

        {/* min-h-18 matches the listing panel's footer rail — the composer line
            and the "View full listing" line are the same line. */}
        <div className="flex min-h-16 shrink-0 items-center border-line border-t md:min-h-18">
          <Composer onSend={handleSend} className="w-full" />
        </div>
      </div>

      {/* Same content either way: an inline panel on desktop, a sheet on mobile. */}
      <SubjectPanel
        conversationId={conversationId}
        currentUserId={currentUserId}
        open={detailsOpen}
        onClose={() => onDetailsOpenChange(false)}
        variant={isCompact ? "sheet" : "panel"}
        outcome={conversation.outcome}
      />
    </div>
  );
}
