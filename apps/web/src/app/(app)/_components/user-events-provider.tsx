"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.tryhaggle.ai";
const WS_URL = API_URL.replace(/^http/, "ws");
const INITIAL_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface UserEvent {
  type: string;
  [key: string]: unknown;
}

type Listener = (event: UserEvent) => void;

interface UserEventsContextValue {
  subscribe: (listener: Listener) => () => void;
  /**
   * Increments on every successful (re)connect. Consumers refetch when it
   * changes, because anything published while the socket was down was missed.
   */
  connectionEpoch: number;
  connected: boolean;
}

const UserEventsContext = createContext<UserEventsContextValue>({
  subscribe: () => () => {},
  connectionEpoch: 0,
  connected: false,
});

export function useUserEvents() {
  return useContext(UserEventsContext);
}

/** Subscribe to one event type for the lifetime of the component. */
export function useUserEvent(type: string, handler: (event: UserEvent) => void) {
  const { subscribe } = useUserEvents();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === type) handlerRef.current(event);
      }),
    [subscribe, type],
  );
}

/**
 * Owns the single per-user WebSocket.
 *
 * One socket carries every user-addressed event (notifications and messaging),
 * so opening the messages page does not add a second connection. Sockets are
 * authenticated with a short-lived ticket, never with the access token in the
 * URL — see /auth/websocket-tickets.
 */
export function UserEventsProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef(new Set<Listener>());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY_MS);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUnmountRef = useRef(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [connected, setConnected] = useState(false);

  const subscribe = useCallback((listener: Listener) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const connect = useCallback(async () => {
    if (closedByUnmountRef.current) return;

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    let ticketProtocol: string | undefined;
    try {
      const response = await fetch(`${API_URL}/auth/websocket-tickets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: "notification" }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`ticket ${response.status}`);
      ticketProtocol = ((await response.json()) as { ticket_protocol?: string }).ticket_protocol;
    } catch {
      scheduleReconnect();
      return;
    }
    if (!ticketProtocol) {
      scheduleReconnect();
      return;
    }

    const ws = new WebSocket(`${WS_URL}/ws/notifications`, [ticketProtocol]);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
      setConnected(true);
      setConnectionEpoch((epoch) => epoch + 1);
    };

    ws.onmessage = (event) => {
      let parsed: UserEvent;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!parsed || typeof parsed.type !== "string" || parsed.type === "pong") return;
      for (const listener of listenersRef.current) listener(parsed);
    };

    ws.onclose = () => {
      setConnected(false);
      scheduleReconnect();
    };

    ws.onerror = () => ws.close();

    function scheduleReconnect() {
      if (closedByUnmountRef.current) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const delay = reconnectDelayRef.current;
      // Backoff, not a give-up count: a chat that silently stops updating after
      // three failed attempts is worse than one that keeps trying slowly.
      reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
      reconnectTimerRef.current = setTimeout(() => {
        void connect();
      }, delay);
    }
  }, []);

  useEffect(() => {
    closedByUnmountRef.current = false;
    void connect();
    return () => {
      closedByUnmountRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return (
    <UserEventsContext.Provider value={{ subscribe, connectionEpoch, connected }}>
      {children}
    </UserEventsContext.Provider>
  );
}
