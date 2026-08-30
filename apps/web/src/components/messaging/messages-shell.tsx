"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { InboxTabs } from "@/app/(app)/_components/inbox-tabs";
import { useMessagesUnread } from "@/app/(app)/_components/messages-unread-provider";
import { useUserEvent, useUserEvents } from "@/app/(app)/_components/user-events-provider";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import {
  type ConversationDetail,
  type ConversationFilter,
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

  // Defaults to the side you are working on, then stays where you put it. The
  // mode lives in localStorage (the nav writes it), so it is read after mount to
  // keep the server and client markup identical.
  // Null until the mode is read: fetching before then would ask for the wrong
  // side and immediately ask again, showing the wrong list in between.
  const [filter, setFilter] = useState<ConversationFilter | null>(null);
  useEffect(() => {
    try {
      setFilter(localStorage.getItem("haggle_mode") === "selling" ? "selling" : "buying");
    } catch {
      setFilter("all");
    }
  }, []);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { connectionEpoch } = useUserEvents();
  const unread = useMessagesUnread();

  const loadConversations = useCallback(() => {
    if (!filter) return;
    setFailed(false);
    messagingApi
      .listConversations({ filter })
      .then((response) => {
        setConversations(response.conversations);
        setNextCursor(response.nextCursor);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [filter]);

  // Refetched on reconnect: events published while the socket was down are gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionEpoch is the reconnect trigger, not a value this effect reads
  useEffect(loadConversations, [loadConversations, connectionEpoch]);

  useEffect(() => {
    // A different conversation is a different listing; the panel starts closed.
    setDetailsOpen(false);
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

  // With the page capped at the platform's measure, a wider screen adds nothing
  // to divide — the content box is the same 1232px at 1280 and at 1920. So this
  // is not a breakpoint question: three columns never leave the thread enough
  // room, and the thread is what is being read. The list steps aside while the
  // listing is open, and comes back the moment it is closed.
  const listVisibility = !selectedId ? "flex" : detailsOpen ? "hidden" : "hidden md:flex";

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
        // Either a thread this client has never seen, or one the current filter
        // hides. Refetching settles both: the server decides what belongs here.
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
        // The platform's measure, the same on every page.
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
            "w-full shrink-0 flex-col overflow-hidden md:w-72 md:border-line md:border-r lg:w-80",
            // One rule per state rather than utilities that override each other:
            // `md:hidden` and `min-[1240px]:flex` are both display utilities, and
            // which one wins depends on the order Tailwind happens to emit them.
            listVisibility,
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
          {filter && <SideFilter value={filter} onChange={setFilter} unread={unread} />}
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
                  .listConversations({ cursor: nextCursor, filter: filter ?? "all" })
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
              detailsOpen={detailsOpen}
              onDetailsOpenChange={setDetailsOpen}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center p-8">
              {/* One empty state per screen, and it lives here on desktop: the
                  wide pane is where the eye goes, and "select a conversation"
                  is not true when there is nothing to select. */}
              {selectedId ? (
                // Work in progress, not an empty state: a spinner says "wait",
                // while an icon in a circle says "there is nothing here".
                <div className="flex items-center gap-2.5 text-ink-muted">
                  <Spinner size="sm" />
                  <span className="text-sm">Loading conversation…</span>
                </div>
              ) : loading ? null : failed ? (
                <EmptyState
                  bordered={false}
                  icon={<MessageIcon />}
                  title="Couldn't load your messages"
                  description="Check your connection and try again."
                  action={
                    <button
                      type="button"
                      onClick={loadConversations}
                      className="rounded-full border border-line px-4 py-2 font-semibold text-ink text-sm transition-colors hover:bg-surface-sunken"
                    >
                      Retry
                    </button>
                  }
                />
              ) : conversations.length === 0 ? (
                <EmptyState
                  bordered={false}
                  icon={<MessageIcon />}
                  title="No messages yet"
                  description="Once your agent is negotiating, you can message the other side here."
                />
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

/**
 * Buying / Selling, with the other side's unread showing through.
 *
 * The filter opens on the side you are working on, which means it starts by
 * hiding half the inbox — so the half it hides has to be able to say that
 * something is waiting there. The navigation badge stays on the whole number
 * for the same reason.
 */
function SideFilter({
  value,
  onChange,
  unread,
}: {
  value: ConversationFilter;
  onChange: (next: ConversationFilter) => void;
  unread: { buying: number; selling: number };
}) {
  const options: Array<{ value: ConversationFilter; label: string; unread: number }> = [
    { value: "all", label: "All", unread: 0 },
    { value: "buying", label: "Buying", unread: unread.buying },
    { value: "selling", label: "Selling", unread: unread.selling },
  ];

  return (
    // No rule under the pills: they belong to the list they filter, and a second
    // line right under the header split the column into three strips.
    <div className="flex shrink-0 gap-1.5 px-3 pt-2.5 pb-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "relative rounded-full px-3 py-1 font-semibold text-xs transition-colors",
              active
                ? "bg-ink text-surface"
                : "border border-line text-ink-secondary hover:bg-surface-sunken",
            )}
          >
            {option.label}
            {!active && option.unread > 0 && (
              <span
                className="-top-0.5 -right-0.5 absolute size-[5px] rounded-full bg-error"
                aria-hidden="true"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
