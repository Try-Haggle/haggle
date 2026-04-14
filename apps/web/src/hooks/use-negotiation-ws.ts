"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const WS_URL = API_URL.replace(/^http/, "ws");

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;
const POLL_INTERVAL_MS = 5000;

export interface WsMessage {
  type: "round_update" | "status_change" | "pong";
  payload?: Record<string, unknown>;
}

interface UseNegotiationWsOptions {
  sessionId: string;
  /** Called when session data changes (round update or status change) */
  onUpdate: () => void;
  /** Whether the session is in a terminal state */
  isTerminal: boolean;
}

interface UseNegotiationWsResult {
  /** 'ws' = WebSocket connected, 'polling' = fallback polling, 'disconnected' */
  connectionMode: "ws" | "polling" | "disconnected";
}

/**
 * Hook for real-time negotiation updates via WebSocket with polling fallback.
 *
 * Connects to /ws/negotiations/:sessionId. If WS connection fails after
 * MAX_RECONNECT_ATTEMPTS, falls back to polling every 5 seconds.
 */
export function useNegotiationWs({
  sessionId,
  onUpdate,
  isTerminal,
}: UseNegotiationWsOptions): UseNegotiationWsResult {
  const [connectionMode, setConnectionMode] = useState<"ws" | "polling" | "disconnected">("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onUpdateRef = useRef(onUpdate);

  // Keep callback ref current
  onUpdateRef.current = onUpdate;

  const connect = useCallback(async () => {
    if (isTerminal) return;

    try {
      // Get JWT token from Supabase
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        // No auth — fall back to polling
        setConnectionMode("polling");
        return;
      }

      const wsUrl = `${WS_URL}/ws/negotiations/${sessionId}?token=${token}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnectionMode("ws");
      };

      ws.onmessage = (event) => {
        try {
          const msg: WsMessage = JSON.parse(event.data);
          if (msg.type === "round_update" || msg.type === "status_change") {
            onUpdateRef.current();
          }
          // pong messages are just heartbeats, ignore
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (isTerminal) {
          setConnectionMode("disconnected");
          return;
        }

        reconnectAttemptsRef.current++;
        if (reconnectAttemptsRef.current <= MAX_RECONNECT_ATTEMPTS) {
          // Retry connection
          setTimeout(() => connect(), RECONNECT_DELAY_MS);
        } else {
          // Fall back to polling
          setConnectionMode("polling");
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling reconnect there
      };
    } catch {
      setConnectionMode("polling");
    }
  }, [sessionId, isTerminal]);

  // Initial connection
  useEffect(() => {
    if (isTerminal) {
      setConnectionMode("disconnected");
      return;
    }

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, isTerminal]);

  // Polling fallback
  useEffect(() => {
    if (connectionMode !== "polling" || isTerminal) return;

    const interval = setInterval(() => {
      onUpdateRef.current();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [connectionMode, isTerminal]);

  return { connectionMode };
}
