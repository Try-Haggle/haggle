import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { getSupabaseJwtVerifier } from "../services/supabase-jwt.service.js";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

// ── Fastify plugin ────────────────────────────────────────────────────────────

async function authPlugin(app: FastifyInstance) {
  const verifier = getSupabaseJwtVerifier();
  if (verifier.config.mode === "test_unverified") {
    app.log.warn("[auth] explicit test fixture mode is accepting unsigned JWTs");
  }

  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifier.verify(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role ?? payload.user_metadata?.role ?? payload.app_metadata?.role,
      };
    } catch {
      return reply.code(401).send({ error: "INVALID_TOKEN" });
    }
  });
}

export default fp(authPlugin, { name: "auth" });
