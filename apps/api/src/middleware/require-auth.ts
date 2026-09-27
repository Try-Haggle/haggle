import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Fastify preHandler: rejects unauthenticated requests with 401.
 * Use on any route that requires a logged-in user.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "AUTH_REQUIRED" });
  }
}

/**
 * A1: MCP OAuth tokens are for /mcp tools only; REST payment/accept/settlement/claim routes deny them.
 * Unauthenticated requests pass through to whatever the route already does.
 */
export async function denyMcpToken(request: FastifyRequest, reply: FastifyReply) {
  if (request.user?.tokenKind === "mcp") {
    return reply.code(403).send({ error: "MCP_TOKEN_NOT_ALLOWED" });
  }
}

/**
 * Fastify preHandler: rejects non-admin requests with 403.
 * Also rejects unauthenticated requests with 401.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  if (!request.user) {
    return reply.code(401).send({ error: "AUTH_REQUIRED" });
  }
  if (request.user.role !== "admin") {
    return reply.code(403).send({ error: "ADMIN_REQUIRED" });
  }
}
