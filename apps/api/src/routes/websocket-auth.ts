import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import { issueWebSocketAuthTicket } from "../services/websocket-auth-ticket.service.js";

const requestSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("notification") }).strict(),
  z.object({ channel: z.literal("negotiation"), session_id: z.string().uuid() }).strict(),
]);

export function registerWebSocketAuthRoutes(app: FastifyInstance, db: Database): void {
  app.post("/auth/websocket-tickets", { preHandler: [requireAuth] }, async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const parsed = requestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "INVALID_WEBSOCKET_TICKET_REQUEST" });

    let issued;
    try {
      issued = await issueWebSocketAuthTicket(db, {
        userId: request.user!.id,
        channel: parsed.data.channel,
        resourceId: parsed.data.channel === "negotiation" ? parsed.data.session_id : undefined,
      });
    } catch {
      request.log.error(
        { event: "websocket_ticket_issue_unavailable", channel: parsed.data.channel },
        "WebSocket ticket issuance unavailable",
      );
      return reply.code(503).send({ error: "WEBSOCKET_AUTH_UNAVAILABLE" });
    }
    if (!issued) return reply.code(403).send({ error: "WEBSOCKET_CHANNEL_FORBIDDEN" });
    return reply.code(201).send({
      schema_version: "websocket-auth-ticket-v1",
      channel: parsed.data.channel,
      ticket_protocol: issued.protocol,
      expires_at: issued.expiresAt,
      expires_in_seconds: issued.expiresInSeconds,
    });
  });
}
