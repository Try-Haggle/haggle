"use client";

import { useCallback, useEffect, useState } from "react";
import { useUserEvent, useUserEvents } from "@/app/(app)/_components/user-events-provider";
import { messagingApi } from "@/lib/messaging-api";

/**
 * Total unread messages for the nav badge.
 *
 * Realtime keeps it live; the count is refetched on every (re)connect because
 * anything published while the socket was down never arrived.
 */
export function useMessagesUnreadCount(): number {
  const [count, setCount] = useState(0);
  const { connectionEpoch } = useUserEvents();

  const refresh = useCallback(() => {
    messagingApi
      .unreadCount()
      .then(({ count: total }) => setCount(total))
      .catch(() => {});
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionEpoch is the reconnect trigger, not a value this effect reads
  useEffect(refresh, [refresh, connectionEpoch]);

  // Both events change the badge in ways only the server can total correctly
  // (a read on another device clears several at once), so refetch rather than
  // guess a delta.
  useUserEvent("message.new", refresh);
  useUserEvent("message.read", refresh);

  return count;
}
