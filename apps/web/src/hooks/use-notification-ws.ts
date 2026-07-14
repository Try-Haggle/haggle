"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { Notification } from "@/lib/api-client";
import { createClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.tryhaggle.ai";
const WS_URL = API_URL.replace(/^http/, "ws");
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 2000;

interface WsNotificationMessage {
  type: "notification.new" | "pong";
  notification?: Notification;
}

interface UseNotificationWsOptions {
  onNewNotification: (notification: Notification) => void;
}

export function useNotificationWs({ onNewNotification }: UseNotificationWsOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const onNewRef = useRef(onNewNotification);
  const router = useRouter();

  onNewRef.current = onNewNotification;

  const connect = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const ticketResponse = await fetch(`${API_URL}/auth/websocket-tickets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel: "notification" }),
      cache: "no-store",
    });
    if (!ticketResponse.ok) return;
    const ticket = (await ticketResponse.json()) as { ticket_protocol?: string };
    if (!ticket.ticket_protocol) return;
    const ws = new WebSocket(`${WS_URL}/ws/notifications`, [ticket.ticket_protocol]);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsNotificationMessage = JSON.parse(event.data);
        if (msg.type === "notification.new" && msg.notification) {
          const n = msg.notification;
          const title = n.payload.displayTitle ?? "New notification";
          const link = n.payload.displayLink as string | undefined;

          toast(title, {
            id: n.id,
            duration: 5000,
            ...(link
              ? {
                  action: {
                    label: "View",
                    onClick: () => router.push(link),
                  },
                }
              : {}),
          });

          onNewRef.current(n);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [router]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
