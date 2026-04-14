/**
 * WebSocket handler for real-time negotiation updates.
 *
 * Channel: /ws/negotiations/:sessionId?token=JWT
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

import type { FastifyInstance } from "fastify";

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
export function broadcastToSession(
  sessionId: string,
  message: WsServerMessage,
): void {
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

export async function registerWebSocketRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/ws/negotiations/:sessionId",
    { websocket: true },
    (socket: WebSocket, req) => {
      const sessionId = (req.params as { sessionId: string }).sessionId;

      // Auth: verify JWT from query param
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        socket.close(4001, "Missing token");
        return;
      }

      // Verify token using the same JWT_SECRET as auth middleware
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        socket.close(4500, "Server misconfigured");
        return;
      }

      try {
        // Simple JWT verification (same approach as auth middleware)
        const parts = token.split(".");
        if (parts.length !== 3) throw new Error("Invalid JWT");

        const payloadStr = Buffer.from(parts[1], "base64url").toString();
        const payload = JSON.parse(payloadStr);

        // Check expiry
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          socket.close(4001, "Token expired");
          return;
        }

        // Verify signature with HMAC-SHA256 (timing-safe comparison)
        const crypto = require("node:crypto");
        const signingInput = `${parts[0]}.${parts[1]}`;
        const expectedSig = crypto
          .createHmac("sha256", jwtSecret)
          .update(signingInput)
          .digest("base64url");

        // Use timing-safe comparison to prevent timing attacks
        const sigBuffer = Buffer.from(parts[2]);
        const expectedBuffer = Buffer.from(expectedSig);
        if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
          socket.close(4001, "Invalid token");
          return;
        }

        // Verify user is a participant in this session
        // payload.sub = userId; check against session participants
        const userId = payload.sub;
        if (!userId) {
          socket.close(4001, "Invalid token: no user");
          return;
        }

        // Session-level authorization: verify user belongs to this session
        // Fire-and-forget: check async, close socket if unauthorized
        app.inject({
          method: "GET",
          url: `/negotiations/sessions/${sessionId}`,
          headers: { authorization: `Bearer ${token}` },
        }).then((res) => {
          if (res.statusCode !== 200) {
            app.log.warn({ sessionId, userId }, "WS unauthorized for session");
            socket.close(4003, "Not authorized for this session");
          }
        }).catch(() => {
          // DB unavailable — allow connection, log warning
          app.log.warn({ sessionId, userId }, "WS session auth check failed, allowing connection");
        });

        // Add to channel
        const channel = getOrCreateChannel(sessionId);
        channel.add(socket);

        app.log.info(
          { sessionId, userId: payload.sub, clients: channel.size },
          "WS client connected",
        );

        // Heartbeat
        const heartbeat = setInterval(() => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "pong" }));
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
          app.log.info({ sessionId, clients: getSessionClientCount(sessionId) }, "WS client disconnected");
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
