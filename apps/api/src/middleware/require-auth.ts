import type { FastifyRequest, FastifyReply } from "fastify";

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
