import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { isProductionRuntime } from "../config/runtime.js";
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

interface SupabaseJwtPayload {
  sub: string;
  exp?: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

function verifyWebSocketJwt(token: string): SupabaseJwtPayload {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  if (!jwtSecret) {
    if (isProductionRuntime()) throw new Error("SUPABASE_JWT_SECRET required in production");
    const decoded = jwt.decode(token) as SupabaseJwtPayload | null;
    if (!decoded?.sub) throw new Error("Invalid JWT payload");
    return decoded;
  }
  const payload = jwt.verify(token, jwtSecret) as SupabaseJwtPayload;
  if (!payload.sub) throw new Error("Invalid JWT payload: missing sub");
  return payload;
}

export async function registerNotificationWsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    "/ws/notifications",
    { websocket: true },
    async (socket: WebSocket, req) => {
      const url = new URL(req.url ?? "", `http://${req.headers.host}`);
      const token = url.searchParams.get("token");

      if (!token) {
        socket.close(4001, "Missing token");
        return;
      }

      let userId: string;
      try {
        const payload = verifyWebSocketJwt(token);
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          socket.close(4001, "Token expired");
          return;
        }
        userId = payload.sub;
      } catch {
        socket.close(4001, "Authentication failed");
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
