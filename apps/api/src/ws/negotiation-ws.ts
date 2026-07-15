/**
 * WebSocket handler for real-time negotiation updates.
 *
 * Channel: /ws/negotiations/:sessionId with a one-time ticket in
 * Sec-WebSocket-Protocol: haggle-ticket.<ticket>
 *
 * Messages:
 *   Server → Client:
 *     { type: 'round_update', payload: { round, status, offer?, counterOffer? } }
 *     { type: 'status_change', payload: { status, previousStatus } }
 *     { type: 'pong' }
 *
 *   Client → Server:
 *     { type: 'ping' }
 */

import type { Database } from "@haggle/db";
import type { FastifyInstance } from "fastify";
import { createWebSocketTicketPreValidation } from "../middleware/websocket-ticket-auth.js";

// Minimal WebSocket interface matching ws package (avoids module resolution issues in pnpm)
interface WebSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

// ─── Types ────────────────────────────────────────────────────────────

export interface WsRoundUpdate {
  type: "round_update";
  payload: {
    round: number;
    status: string;
    offer?: number;
    counterOffer?: number;
    decision?: string;
  };
}

export interface WsStatusChange {
  type: "status_change";
  payload: {
    status: string;
    previousStatus: string;
  };
}

export type WsServerMessage = WsRoundUpdate | WsStatusChange | { type: "pong" };

// ─── Channel Manager ──────────────────────────────────────────────────

/** sessionId → Set of connected WebSocket clients */
const channels = new Map<string, Set<WebSocket>>();

const HEARTBEAT_INTERVAL_MS = 30_000;

function getOrCreateChannel(sessionId: string): Set<WebSocket> {
  let channel = channels.get(sessionId);
  if (!channel) {
    channel = new Set();
    channels.set(sessionId, channel);
  }
  return channel;
}

function removeFromChannel(sessionId: string, ws: WebSocket): void {
  const channel = channels.get(sessionId);
  if (!channel) return;
  channel.delete(ws);
  if (channel.size === 0) {
    channels.delete(sessionId);
  }
}

/** Broadcast a message to all clients in a session channel. */
export function broadcastToSession(sessionId: string, message: WsServerMessage): void {
  const channel = channels.get(sessionId);
  if (!channel || channel.size === 0) return;

  const data = JSON.stringify(message);
  for (const ws of channel) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

/** Get connected client count for a session. */
export function getSessionClientCount(sessionId: string): number {
  return channels.get(sessionId)?.size ?? 0;
}

// ─── Route Registration ──────────────────────────────────────────────

export async function registerWebSocketRoutes(app: FastifyInstance, db: Database): Promise<void> {
  app.get(
    "/ws/negotiations/:sessionId",
    {
      websocket: true,
      preValidation: createWebSocketTicketPreValidation(db, "negotiation"),
    },
    async (socket: WebSocket, req) => {
      const sessionId = (req.params as { sessionId: string }).sessionId;

      try {
        const userId = req.wsTicketUserId;
        if (!userId) {
          socket.close(1011, "Ticket principal unavailable");
          return;
        }

        // Add to channel only after authorization check
        const channel = getOrCreateChannel(sessionId);
        channel.add(socket);

        app.log.info({ sessionId, userId, clients: channel.size }, "WS client connected");

        // Heartbeat — wrap in try-catch to prevent uncaught exceptions if socket closes mid-send
        const heartbeat = setInterval(() => {
          try {
            if (socket.readyState === socket.OPEN) {
              socket.send(JSON.stringify({ type: "pong" }));
            } else {
              clearInterval(heartbeat);
              removeFromChannel(sessionId, socket);
            }
          } catch {
            clearInterval(heartbeat);
            removeFromChannel(sessionId, socket);
          }
        }, HEARTBEAT_INTERVAL_MS);

        // Handle incoming messages
        socket.on("message", (raw: Buffer) => {
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "ping") {
              socket.send(JSON.stringify({ type: "pong" }));
            }
          } catch {
            // Ignore malformed messages
          }
        });

        // Cleanup on close
        socket.on("close", () => {
          clearInterval(heartbeat);
          removeFromChannel(sessionId, socket);
          app.log.info(
            { sessionId, clients: getSessionClientCount(sessionId) },
            "WS client disconnected",
          );
        });

        socket.on("error", () => {
          clearInterval(heartbeat);
          removeFromChannel(sessionId, socket);
        });
      } catch {
        socket.close(4001, "Authentication failed");
      }
    },
  );
}
