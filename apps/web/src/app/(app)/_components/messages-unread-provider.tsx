"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { messagingApi } from "@/lib/messaging-api";
import { useUserEvent, useUserEvents } from "./user-events-provider";

export interface MessagesUnread {
  /** Everything, whatever side it is on — this is what the navigation shows. */
  total: number;
  buying: number;
  selling: number;
}

const EMPTY: MessagesUnread = { total: 0, buying: 0, selling: 0 };

const MessagesUnreadContext = createContext<MessagesUnread>(EMPTY);

export function useMessagesUnread(): MessagesUnread {
  return useContext(MessagesUnreadContext);
}

/**
 * One count for the whole app.
 *
 * The nav, the phone's tab bar, the inbox switcher and the messages filter all
 * want this number; before this they each fetched it, so opening the messages
 * page asked the server the same question three times.
 */
export function MessagesUnreadProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState<MessagesUnread>(EMPTY);
  const { connectionEpoch } = useUserEvents();

  const refresh = useCallback(() => {
    messagingApi
      .unreadCount()
      .then((summary) =>
        setUnread({
          total: summary.total ?? summary.count ?? 0,
          buying: summary.buying ?? 0,
          selling: summary.selling ?? 0,
        }),
      )
      .catch(() => {});
  }, []);

  // Refetched on reconnect: anything published while the socket was down never
  // arrived.
  // biome-ignore lint/correctness/useExhaustiveDependencies: connectionEpoch is the reconnect trigger, not a value this effect reads
  useEffect(refresh, [refresh, connectionEpoch]);

  // Both events change the totals in ways only the server can add up — a read on
  // another device clears several at once — so refetch rather than guess.
  useUserEvent("message.new", refresh);
  useUserEvent("message.read", refresh);

  return <MessagesUnreadContext.Provider value={unread}>{children}</MessagesUnreadContext.Provider>;
}
