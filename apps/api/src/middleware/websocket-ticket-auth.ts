// biome-ignore-all lint/suspicious/noImplicitAnyLet: Guarded assignments retain service return types.
import type { Database } from "@haggle/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { getRuntimeConfig, isCorsOriginAllowed } from "../config/runtime.js";
import {
  consumeWebSocketAuthTicket,
  extractWebSocketTicketProtocol,
  type WebSocketTicketChannel,
} from "../services/websocket-auth-ticket.service.js";

declare module "fastify" {
  interface FastifyRequest {
    wsTicketUserId?: string;
  }
}

export function createWebSocketTicketPreValidation(db: Database, channel: WebSocketTicketChannel) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Cache-Control", "no-store");
    if (!isCorsOriginAllowed(request.headers.origin, getRuntimeConfig())) {
      request.log.warn(
        { event: "websocket_origin_forbidden", channel },
        "WebSocket browser origin is not allowed",
      );
      return reply.code(403).send({ error: "WEBSOCKET_ORIGIN_FORBIDDEN" });
    }
    const ticket = extractWebSocketTicketProtocol(request.headers["sec-websocket-protocol"]);
    const resourceId =
      channel === "negotiation" ? (request.params as { sessionId?: string }).sessionId : undefined;
    if (
      !ticket ||
      (channel === "negotiation" &&
        (!resourceId ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            resourceId,
          )))
    ) {
      return reply.code(401).send({ error: "WEBSOCKET_TICKET_REQUIRED" });
    }
    let consumed;
    try {
      consumed = await consumeWebSocketAuthTicket(db, {
        ticket,
        channel,
        resourceId,
      });
    } catch {
      request.log.error(
        { event: "websocket_ticket_store_unavailable", channel },
        "WebSocket ticket verification unavailable",
      );
      return reply.code(503).send({ error: "WEBSOCKET_AUTH_UNAVAILABLE" });
    }
    if (!consumed) {
      return reply.code(401).send({ error: "WEBSOCKET_TICKET_INVALID" });
    }
    request.wsTicketUserId = consumed.userId;
  };
}
