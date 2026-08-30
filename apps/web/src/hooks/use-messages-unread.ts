"use client";

import { useMessagesUnread } from "@/app/(app)/_components/messages-unread-provider";

/**
 * Total unread messages, for a badge.
 *
 * Deliberately the whole number, never the count for one side: a filter that
 * defaults to selling must not be able to hide the fact that a buyer wrote.
 */
export function useMessagesUnreadCount(): number {
  return useMessagesUnread().total;
}
