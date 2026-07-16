"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.tryhaggle.ai";
const WS_URL = API_URL.replace(/^http/, "ws");

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;
const DEFAULT_POLL_INTERVAL_MS = 5000;

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
  /** Poll interval for guests or when WebSocket is unavailable */
  pollIntervalMs?: number;
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
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseNegotiationWsOptions): UseNegotiationWsResult {
  const [connectionMode, setConnectionMode] = useState<"ws" | "polling" | "disconnected">(
    "disconnected",
  );
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      if (!token) {
        // No auth — fall back to polling
        setConnectionMode("polling");
        onUpdateRef.current();
        return;
      }

      const ticketResponse = await fetch(`${API_URL}/auth/websocket-tickets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ channel: "negotiation", session_id: sessionId }),
        cache: "no-store",
      });
      if (!ticketResponse.ok) throw new Error("WebSocket ticket issuance failed");
      const ticket = (await ticketResponse.json()) as { ticket_protocol?: string };
      if (!ticket.ticket_protocol) throw new Error("WebSocket ticket missing");
      const ws = new WebSocket(`${WS_URL}/ws/negotiations/${sessionId}`, [ticket.ticket_protocol]);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setConnectionMode("ws");
        // Reconcile any round committed between the initial page load and
        // the WebSocket subscription becoming active.
        onUpdateRef.current();
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
      onUpdateRef.current();
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
    }, pollIntervalMs);

    return () => clearInterval(interval);
  }, [connectionMode, isTerminal, pollIntervalMs]);

  return { connectionMode };
}
