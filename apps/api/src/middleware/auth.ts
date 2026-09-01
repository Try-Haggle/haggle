import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { publicApiBaseUrl } from "../lib/public-urls.js";
import { getSupabaseJwtVerifier } from "../services/supabase-jwt.service.js";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
  /** `mcp` is an OAuth access token; omitted/jwt is first-party Supabase. */
  tokenKind?: "jwt" | "mcp";
  scopes?: string[];
}

type McpAccessTokenResolver = (token: string) => Promise<AuthUser | null>;

let mcpAccessTokenResolver: McpAccessTokenResolver | null = null;

export function setMcpAccessTokenResolver(resolver: McpAccessTokenResolver | null) {
  mcpAccessTokenResolver = resolver;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

function mcpWwwAuthenticate(request: FastifyRequest): string {
  const metadata = `${publicApiBaseUrl(request)}/.well-known/oauth-protected-resource`;
  return `Bearer realm="haggle", resource_metadata="${metadata}"`;
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
        // Supabase user_metadata is user-editable; only app_metadata may elevate the app role.
        role: payload.app_metadata?.role ?? payload.role,
        tokenKind: "jwt",
      };
    } catch {
      if (mcpAccessTokenResolver) {
        const mcpUser = await mcpAccessTokenResolver(token);
        if (mcpUser) {
          request.user = mcpUser;
          return;
        }
      }
      if (request.url.split("?")[0] === "/mcp") {
        reply.header("WWW-Authenticate", mcpWwwAuthenticate(request));
      }
      return reply.code(401).send({ error: "INVALID_TOKEN" });
    }
  });
}

export default fp(authPlugin, { name: "auth" });
