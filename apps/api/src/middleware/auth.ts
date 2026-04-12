import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";

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

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_JWT_SECRET) {
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (isProduction) {
    console.error(
      "🚨 [SECURITY] SUPABASE_JWT_SECRET is not set in PRODUCTION! " +
      "JWT tokens will NOT be verified. Set this variable immediately.",
    );
  } else {
    console.warn(
      "⚠️  [auth] SUPABASE_JWT_SECRET not set — JWT verification disabled (dev passthrough)",
    );
  }
}

function verifySupabaseJwt(token: string): SupabaseJwtPayload {
  if (!SUPABASE_JWT_SECRET) {
    // No secret configured — decode without verification (local dev passthrough)
    const decoded = jwt.decode(token) as SupabaseJwtPayload | null;
    if (!decoded || !decoded.sub) {
      throw new Error("Invalid JWT payload");
    }
    return decoded;
  }

  const payload = jwt.verify(token, SUPABASE_JWT_SECRET) as SupabaseJwtPayload;
  if (!payload.sub) {
    throw new Error("Invalid JWT payload: missing sub");
  }
  return payload;
}

async function authPlugin(app: FastifyInstance) {
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
