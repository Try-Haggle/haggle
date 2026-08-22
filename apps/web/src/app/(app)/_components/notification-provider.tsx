"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useNotificationWs } from "@/hooks/use-notification-ws";
import { type Notification, notificationApi } from "@/lib/api-client";

interface NotificationContextValue {
  unreadCount: number;
  decrementCount: (by?: number) => void;
  resetCount: () => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  unreadCount: 0,
  decrementCount: () => {},
  resetCount: () => {},
});

export function useNotificationContext() {
  return useContext(NotificationContext);
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [unreadCount, setUnreadCount] = useState(0);

  // Fetch initial unread count on mount
  useEffect(() => {
    notificationApi
      .count()
      .then(({ count }) => setUnreadCount(count))
      .catch(() => {}); // silent — not critical
  }, []);

  const handleNewNotification = useCallback((_notification: Notification) => {
    setUnreadCount((prev) => prev + 1);
  }, []);

  const decrementCount = useCallback((by = 1) => {
    setUnreadCount((prev) => Math.max(0, prev - by));
  }, []);

  const resetCount = useCallback(() => {
    setUnreadCount(0);
  }, []);

  useNotificationWs({ onNewNotification: handleNewNotification });

  return (
    <NotificationContext.Provider value={{ unreadCount, decrementCount, resetCount }}>
      {children}
    </NotificationContext.Provider>
  );
}
