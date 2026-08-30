"use client";

import { useCallback, useEffect, useRef } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import type { Message } from "@/lib/messaging-api";
import { formatMessageTime, groupMessages } from "./message-grouping";

interface MessageThreadProps {
  messages: Message[];
  currentUserId: string;
  otherMemberName: string;
  /** Messages up to this time have been read by the other side. */
  otherReadAt: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}

/**
 * The scrolling thread: oldest at the top, newest at the bottom, older pages
 * pulled in as you scroll up.
 */
/** Survives the optimistic → stored swap; see the key comment below. */
function stableKey(message: Message): string {
  return message.clientMessageId ? `c:${message.clientMessageId}` : message.id;
}

export function MessageThread({
  messages,
  currentUserId,
  otherMemberName,
  otherReadAt,
  hasMore,
  loadingMore,
  onLoadMore,
}: MessageThreadProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const previousLastKeyRef = useRef<string | null>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const pinnedToBottomRef = useRef(true);
  const previousHeightRef = useRef(0);
  const lastMessageId = messages[messages.length - 1]?.id ?? null;

  // Keep the newest message in view, but only when the reader is already at the
  // bottom — otherwise reading history would be yanked away by an arriving
  // message.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastMessageId is the "a message arrived" trigger; the effect reads refs only
  useEffect(() => {
    const container = containerRef.current;
    if (container && pinnedToBottomRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [lastMessageId]);

  // Prepending older messages moves everything down by exactly the height that
  // was added; subtracting it back keeps the reader on the same message.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || loadingMore || previousHeightRef.current === 0) return;
    const added = container.scrollHeight - previousHeightRef.current;
    if (added > 0) container.scrollTop += added;
    previousHeightRef.current = 0;
  }, [loadingMore]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    pinnedToBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < 64;
  }, []);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = containerRef.current;
    if (!sentinel || !container || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !loadingMore) {
          previousHeightRef.current = container.scrollHeight;
          onLoadMore();
        }
      },
      { root: container, rootMargin: "120px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, onLoadMore]);

  // Only messages that land while the thread is on screen animate. The history
  // is already there when you open a conversation, and older pages arrive above
  // the fold — animating either would be motion for its own sake.
  const previousLastKey = previousLastKeyRef.current;
  const previousLastIndex = previousLastKey
    ? messages.findIndex((message) => stableKey(message) === previousLastKey)
    : -1;
  const firstArrivingIndex =
    mountedRef.current && previousLastIndex >= 0 ? previousLastIndex + 1 : messages.length;

  useEffect(() => {
    mountedRef.current = true;
    const last = messages[messages.length - 1];
    previousLastKeyRef.current = last ? stableKey(last) : null;
  });

  const grouped = groupMessages(messages);
  const otherReadTime = otherReadAt ? Date.parse(otherReadAt) : null;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-2 overflow-y-auto p-3 md:p-4"
    >
      {hasMore && (
        <div ref={topSentinelRef} className="flex justify-center py-3">
          <Spinner />
        </div>
      )}

      {grouped.map(({ message, showDate, dateLabel, showTimestamp, startsRun }, index) => {
        const mine = message.senderId === currentUserId;
        // KakaoTalk-style: the count next to your own bubble is how many people
        // have not read it yet (1 in a 1:1 thread, gone once they read it).
        const unreadByOther =
          mine && otherReadTime !== null && Date.parse(message.createdAt) > otherReadTime;
        const unseen = mine && otherReadTime === null;

        return (
          // Keyed by the client id when there is one, so the optimistic bubble
          // and the stored message that replaces it are the same element — a
          // fresh key would unmount it and play the arrival animation twice.
          <div key={stableKey(message)}>
            {showDate && <div className="py-3 text-center text-ink-muted text-xs">{dateLabel}</div>}

            <div
              className={cn(
                "flex flex-col",
                mine ? "items-end" : "items-start",
                index >= firstArrivingIndex && "animate-message-in",
              )}
            >
              {showTimestamp && (
                <div className="mb-1 text-[0.625rem] text-ink-muted">
                  {!mine && startsRun && (
                    <>
                      <span className="font-semibold text-ink-secondary">{otherMemberName}</span>
                      <span className="px-1">·</span>
                    </>
                  )}
                  <span>{formatMessageTime(message.createdAt)}</span>
                </div>
              )}

              <div className={cn("flex max-w-[85%] items-end gap-1.5 md:max-w-[70%]")}>
                {mine && (unreadByOther || unseen) && (
                  <span className="shrink-0 pb-1 font-semibold text-[0.6875rem] text-action-primary">
                    1
                  </span>
                )}
                <div
                  className={cn(
                    "w-fit break-words rounded-2xl px-3.5 py-2.5 text-sm",
                    mine
                      ? "rounded-br-sm bg-action-primary text-on-ink"
                      : "rounded-bl-sm border border-line bg-surface-sunken text-ink",
                  )}
                >
                  {/* Rendered as text, never as HTML — the original built this
                      with innerHTML and hand-rolled escaping. */}
                  <span className="whitespace-pre-wrap">{message.body}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
