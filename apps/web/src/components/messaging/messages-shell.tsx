"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { InboxTabs } from "@/app/(app)/_components/inbox-tabs";
import { useUserEvent, useUserEvents } from "@/app/(app)/_components/user-events-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import {
  type ConversationDetail,
  type ConversationSummary,
  messagingApi,
} from "@/lib/messaging-api";
import { ChatPanel } from "./chat-panel";
import { ConversationList } from "./conversation-list";
import { MessageIcon } from "./message-icon";

interface MessagesShellProps {
  currentUserId: string;
}

/**
 * Two panes on desktop; on mobile the chat takes over the screen, which is the
 * layout the Django original used and the one people expect from a messenger.
 */
export function MessagesShell({ currentUserId }: MessagesShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("c");

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const { connectionEpoch } = useUserEvents();

  const loadConversations = useCallback(() => {
    setFailed(false);
    messagingApi
      .listConversations()
      .then((response) => {
        setConversations(response.conversations);
        setNextCursor(response.nextCursor);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Refetched on reconnect: events published while the socket was down are gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionEpoch is the reconnect trigger, not a value this effect reads
  useEffect(loadConversations, [loadConversations, connectionEpoch]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    messagingApi
      .get(selectedId)
      .then((response) => {
        if (!cancelled) setSelected(response.conversation);
      })
      .catch(() => {
        if (!cancelled) setSelected(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const select = useCallback(
    (conversation: ConversationSummary) => {
      // Shallow route change: the panes stay mounted, only the query moves, so
      // the browser Back button still closes the thread on mobile.
      router.push(`/messages?c=${conversation.id}`, { scroll: false });
    },
    [router],
  );

  const clearUnread = useCallback((conversationId: string) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
      ),
    );
  }, []);

  useUserEvent("message.new", (event) => {
    const incoming = event as unknown as {
      conversationId: string;
      message: { body?: string; senderId: string; createdAt: string; id: string };
    };

    setConversations((current) => {
      const index = current.findIndex((c) => c.id === incoming.conversationId);
      if (index === -1) {
        // A thread this client has never seen (someone messaged first) — pull
        // the list again rather than inventing a row.
        loadConversations();
        return current;
      }

      const existing = current[index];
      const isMine = incoming.message.senderId === currentUserId;
      const isOpen = incoming.conversationId === selectedId;
      const updated: ConversationSummary = {
        ...existing,
        lastMessage: {
          id: incoming.message.id,
          body: incoming.message.body ?? existing.lastMessage?.body ?? "",
          senderId: incoming.message.senderId,
          createdAt: incoming.message.createdAt,
        },
        lastMessageAt: incoming.message.createdAt,
        unreadCount: isMine || isOpen ? existing.unreadCount : existing.unreadCount + 1,
      };

      // Newest thread first, same as the server's ordering.
      const rest = current.filter((_, i) => i !== index);
      return [updated, ...rest];
    });
  });

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-7xl md:px-6 md:py-6",
        // The app layout reserves 4rem at the bottom for the nav bar. With a
        // thread open that bar is gone, so the reservation has to go too —
        // otherwise the composer sits below the fold.
        selectedId && "-mb-16 md:mb-0",
      )}
    >
      <div
        className={cn(
          "flex overflow-hidden border-line bg-surface md:h-[calc(100dvh-8rem)] md:rounded-2xl md:border md:shadow-sm",
          selectedId ? "h-[100dvh]" : "h-[calc(100dvh-4rem)]",
        )}
      >
        {/* Sidebar: full width on mobile, fixed rail on desktop. */}
        <aside
          className={cn(
            "flex w-full shrink-0 flex-col overflow-hidden md:w-80 md:border-line md:border-r lg:w-96",
            selectedId && "hidden md:flex",
          )}
        >
          {/* Same h-14 rail as the chat and listing headers — one line across
              all three columns. */}
          {/* On a phone the tabs are the header: the title would only repeat the
              tab that got you here, and the way back to notifications is the
              one thing this rail is for. */}
          <InboxTabs className="md:hidden" />
          <div className="hidden h-14 shrink-0 items-center border-line border-b px-4 md:flex">
            <h1 className="font-semibold text-ink">Messages</h1>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              currentUserId={currentUserId}
              loading={loading}
              failed={failed}
              onRetry={loadConversations}
              onSelect={select}
              hasMore={Boolean(nextCursor)}
              onLoadMore={() => {
                if (!nextCursor) return;
                messagingApi
                  .listConversations(nextCursor)
                  .then((response) => {
                    setConversations((current) => [...current, ...response.conversations]);
                    setNextCursor(response.nextCursor);
                  })
                  .catch(() => {});
              }}
            />
          </div>
        </aside>

        <div className={cn("min-w-0 flex-1", selectedId ? "flex" : "hidden md:flex")}>
          {selected ? (
            <ChatPanel
              key={selected.id}
              conversation={selected}
              currentUserId={currentUserId}
              onBack={() => router.push("/messages", { scroll: false })}
              onRead={clearUnread}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              {selectedId ? (
                // Work in progress, not an empty state: a spinner says "wait",
                // while an icon in a circle says "there is nothing here".
                <div className="flex items-center gap-2.5 text-ink-muted">
                  <Spinner size="sm" />
                  <span className="text-sm">Loading conversation…</span>
                </div>
              ) : (
                <EmptyState
                  bordered={false}
                  icon={<MessageIcon />}
                  title="Select a conversation"
                  description="Choose a conversation from the list to start messaging."
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
