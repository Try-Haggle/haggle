import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { isProductionRuntime } from "../config/runtime.js";

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

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: { role?: string };
  app_metadata?: { role?: string };
}

function verifySupabaseJwt(token: string): SupabaseJwtPayload {
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!supabaseJwtSecret) {
    if (isProductionRuntime()) {
      throw new Error(
        "[SECURITY] SUPABASE_JWT_SECRET is not set in production. " +
        "Server startup aborted to prevent unauthenticated access.",
      );
    }

    // No secret configured — decode without verification (local dev passthrough)
    const decoded = jwt.decode(token) as SupabaseJwtPayload | null;
    if (!decoded || !decoded.sub) {
      throw new Error("Invalid JWT payload");
    }
    return decoded;
  }

  const payload = jwt.verify(token, supabaseJwtSecret) as SupabaseJwtPayload;
  if (!payload.sub) {
    throw new Error("Invalid JWT payload: missing sub");
  }
  return payload;
}

async function authPlugin(app: FastifyInstance) {
  if (!process.env.SUPABASE_JWT_SECRET && !isProductionRuntime()) {
    app.log.warn(
      "[auth] SUPABASE_JWT_SECRET not set; JWT verification disabled for local/test runtime",
    );
  }

  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      // No token = unauthenticated request. Route handlers decide if they need auth.
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = verifySupabaseJwt(token);
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
