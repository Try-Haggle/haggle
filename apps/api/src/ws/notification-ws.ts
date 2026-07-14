import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { createWebSocketTicketPreValidation } from
  "../middleware/websocket-ticket-auth.js";
import { registerUserSocket, unregisterUserSocket } from "../notification/ws-registry.js";

// Minimal WebSocket interface — same pattern as negotiation-ws.ts
interface WebSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "message", listener: (data: Buffer) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

export async function registerNotificationWsRoute(app: FastifyInstance, db: Database): Promise<void> {
  app.get(
    "/ws/notifications",
    {
      websocket: true,
      preValidation: createWebSocketTicketPreValidation(db, "notification"),
    },
    async (socket: WebSocket, req) => {
      const userId = req.wsTicketUserId;
      if (!userId) {
        socket.close(1011, "Ticket principal unavailable");
        return;
      }

      registerUserSocket(userId, socket);
      app.log.info({ userId }, "notification WS connected");

      const heartbeat = setInterval(() => {
        try {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "pong" }));
          } else {
            clearInterval(heartbeat);
            unregisterUserSocket(userId);
          }
        } catch {
          clearInterval(heartbeat);
          unregisterUserSocket(userId);
        }
      }, HEARTBEAT_INTERVAL_MS);

      socket.on("message", (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "ping") socket.send(JSON.stringify({ type: "pong" }));
        } catch { /* ignore malformed */ }
      });

      socket.on("close", () => {
        clearInterval(heartbeat);
        unregisterUserSocket(userId);
        app.log.info({ userId }, "notification WS disconnected");
      });

      socket.on("error", () => {
        clearInterval(heartbeat);
        unregisterUserSocket(userId);
      });
    },
  );
}
