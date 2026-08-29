"use client";

import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";
import type { ConversationSummary } from "@/lib/messaging-api";
import { formatConversationTime } from "./message-grouping";

interface ConversationListProps {
  conversations: ConversationSummary[];
  selectedId: string | null;
  currentUserId: string;
  loading: boolean;
  /** Set when the list could not be fetched — never render this as "empty". */
  failed?: boolean;
  onRetry?: () => void;
  onSelect: (conversation: ConversationSummary) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
}

export function ConversationList({
  conversations,
  selectedId,
  currentUserId,
  loading,
  failed,
  onRetry,
  onSelect,
  onLoadMore,
  hasMore,
}: ConversationListProps) {
  // A failed fetch is not an empty inbox; saying "no messages" there would be
  // a lie the reader cannot recover from.
  if (!loading && failed && conversations.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          size="sm"
          padding="sm"
          icon={<MessageIcon />}
          title="Couldn't load your messages"
          description="Check your connection and try again."
          action={
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full border border-line px-3 py-1.5 font-semibold text-ink text-xs hover:bg-surface-sunken"
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  if (!loading && conversations.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          size="sm"
          padding="sm"
          icon={<MessageIcon />}
          title="No messages yet"
          description="Once your agent is negotiating, you can message the other side here."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          active={conversation.id === selectedId}
          currentUserId={currentUserId}
          onSelect={onSelect}
        />
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="mx-auto my-2 rounded-full px-3 py-1.5 text-ink-muted text-xs hover:bg-surface-sunken"
        >
          Load older conversations
        </button>
      )}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  currentUserId,
  onSelect,
}: {
  conversation: ConversationSummary;
  active: boolean;
  currentUserId: string;
  onSelect: (conversation: ConversationSummary) => void;
}) {
  const unread = conversation.unreadCount > 0;
  const name = conversation.otherMember?.displayName ?? "Unknown user";
  const preview = conversation.lastMessage
    ? `${conversation.lastMessage.senderId === currentUserId ? "You: " : ""}${conversation.lastMessage.body}`
    : "No messages yet";

  return (
    <button
      type="button"
      data-testid="conversation-item"
      onClick={() => onSelect(conversation)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
        active ? "bg-surface-sunken" : "hover:bg-surface-sunken/60",
      )}
    >
      <Avatar src={conversation.otherMember?.avatarUrl} name={name} size="md" />

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-sm",
            unread ? "font-bold text-ink" : "font-semibold text-ink",
          )}
        >
          {name}
        </div>
        <div className={cn("truncate text-xs", unread ? "font-medium text-ink" : "text-ink-muted")}>
          {preview}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
        {conversation.lastMessage && (
          <span className="text-[0.6875rem] text-ink-muted">
            {formatConversationTime(conversation.lastMessage.createdAt)}
          </span>
        )}
        {unread && (
          <span className="flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-action-primary px-1.5 font-bold text-[0.625rem] text-on-ink">
            {conversation.unreadCount}
          </span>
        )}
      </div>
    </button>
  );
}

function MessageIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
