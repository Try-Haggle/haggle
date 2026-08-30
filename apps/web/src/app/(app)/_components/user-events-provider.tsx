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
   * Counts *re*connects, not the first connect. Consumers already fetch on
   * mount; bumping this on the initial connection made every one of them fetch
   * twice for nothing. It changes only when the socket came back, which is the
   * moment there is a gap to fill.
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
  const hasConnectedRef = useRef(false);
  const connectingRef = useRef(false);
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
    // Connecting is async — a ticket fetch, then a socket. Without this guard a
    // second call landing mid-flight (React re-running the effect in dev, a
    // reconnect timer firing) opens a whole second connection, and each one
    // costs a ticket request.
    if (closedByUnmountRef.current || connectingRef.current) return;
    connectingRef.current = true;
    try {
      await openSocket();
    } finally {
      connectingRef.current = false;
    }

    async function openSocket() {
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
        if (response.status === 429) {
          // Retrying into a rate limit just deepens it. Wait out the window the
          // server asked for (its budget is per-minute) before trying again.
          const retryAfter = Number(response.headers.get("Retry-After"));
          scheduleReconnect(
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : MAX_RECONNECT_DELAY_MS,
          );
          return;
        }
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

      // The provider went away while the ticket was in flight.
      if (closedByUnmountRef.current) {
        ws.close();
        return;
      }

      ws.onopen = () => {
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY_MS;
        setConnected(true);
        if (hasConnectedRef.current) {
          // A gap just closed — tell consumers to refill what they missed.
          setConnectionEpoch((epoch) => epoch + 1);
        }
        hasConnectedRef.current = true;
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
        // A socket we already replaced (React re-running the effect in dev, or a
        // manual reconnect) must not schedule work for the one that took over —
        // that is how one connection turns into three.
        if (wsRef.current !== ws) return;
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => ws.close();
    }

    function scheduleReconnect(overrideDelayMs?: number) {
      if (closedByUnmountRef.current) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const delay = overrideDelayMs ?? reconnectDelayRef.current;
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
