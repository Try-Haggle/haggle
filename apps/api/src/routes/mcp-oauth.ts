import type { Database } from "@haggle/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { connectUrl, publicApiBaseUrl, publicAppBaseUrl, signUpUrl } from "../lib/public-urls.js";
import { oauthRegisterRateLimit } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  exchangeMcpAuthorizationCode,
  getMcpOauthClient,
  issueMcpAuthorizationCode,
  parseScopes,
  refreshMcpAccessToken,
  registerMcpOauthClient,
} from "../services/mcp-oauth.service.js";

const registerSchema = z.object({
  client_name: z.string().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(8),
});

const consentSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256").optional(),
  scope: z.string().optional(),
  state: z.string().max(512).optional(),
});

const tokenSchema = z.object({
  grant_type: z.enum(["authorization_code", "refresh_token"]),
  client_id: z.string().min(1),
  code: z.string().optional(),
  redirect_uri: z.string().url().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
});

export function registerMcpOauthRoutes(app: FastifyInstance, db: Database) {
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  app.get("/.well-known/oauth-authorization-server", async (request) =>
    authorizationServerMetadata(request),
  );

  app.get("/.well-known/oauth-protected-resource", async (request) => {
    const api = publicApiBaseUrl(request);
    return {
      resource: `${api}/mcp`,
      authorization_servers: [api],
      scopes_supported: ["agents", "listings", "negotiate", "orders", "disputes", "offline_access"],
      bearer_methods_supported: ["header"],
    };
  });

  app.post("/oauth/register", { preHandler: [oauthRegisterRateLimit] }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_client_metadata" });
    }
    const registered = await registerMcpOauthClient(db, parsed.data);
    if (!registered.ok) {
      return reply.code(400).send({ error: "invalid_client_metadata" });
    }
    return reply.code(201).send(registered.client);
  });

  app.get<{ Params: { clientId: string } }>("/oauth/clients/:clientId", async (request, reply) => {
    const client = await getMcpOauthClient(db, request.params.clientId);
    if (!client) {
      return reply.code(404).send({ error: "UNKNOWN_CLIENT" });
    }
    return {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
    };
  });

  app.get("/oauth/authorize", async (request, reply) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(request.query as Record<string, unknown>)) {
      if (typeof value === "string") query.set(key, value);
    }
    return reply.redirect(connectUrl(query.toString()));
  });

  app.post("/oauth/consent", { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = consentSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_AUTHORIZE_REQUEST" });
    }
    const scopes = parseScopes(parsed.data.scope);
    if (scopes.length === 0) {
      return reply.code(400).send({ error: "INVALID_SCOPE" });
    }
    const issued = await issueMcpAuthorizationCode(db, {
      clientId: parsed.data.client_id,
      userId: request.user!.id,
      redirectUri: parsed.data.redirect_uri,
      codeChallenge: parsed.data.code_challenge,
      scopes,
    });
    if (!issued.ok) {
      return reply.code(400).send({ error: issued.error });
    }
    const redirect = new URL(parsed.data.redirect_uri);
    redirect.searchParams.set("code", issued.code);
    if (parsed.data.state) redirect.searchParams.set("state", parsed.data.state);
    return reply.send({ redirect_to: redirect.toString() });
  });

  app.post("/oauth/token", async (request, reply) => {
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    if (parsed.data.grant_type === "authorization_code") {
      if (!parsed.data.code || !parsed.data.redirect_uri || !parsed.data.code_verifier) {
        return reply.code(400).send({ error: "invalid_request" });
      }
      const exchanged = await exchangeMcpAuthorizationCode(db, {
        clientId: parsed.data.client_id,
        redirectUri: parsed.data.redirect_uri,
        code: parsed.data.code,
        codeVerifier: parsed.data.code_verifier,
      });
      if (!exchanged.ok) {
        return reply.code(400).send({ error: "invalid_grant" });
      }
      return reply.send(exchanged.tokens);
    }

    if (!parsed.data.refresh_token) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const refreshed = await refreshMcpAccessToken(db, {
      clientId: parsed.data.client_id,
      refreshToken: parsed.data.refresh_token,
    });
    if (!refreshed.ok) {
      return reply.code(400).send({ error: "invalid_grant" });
    }
    return reply.send(refreshed.tokens);
  });
}

export function authorizationServerMetadata(request: FastifyRequest) {
  const api = publicApiBaseUrl(request);
  const app = publicAppBaseUrl();
  return {
    issuer: api,
    authorization_endpoint: `${app}/connect`,
    token_endpoint: `${api}/oauth/token`,
    registration_endpoint: `${api}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["agents", "listings", "negotiate", "orders", "disputes", "offline_access"],
    service_documentation: `${app}/connect`,
  };
}

export function mcpConnectHint() {
  const app = publicAppBaseUrl();
  return {
    connect_url: `${app}/connect`,
    signup_url: signUpUrl("/connect"),
    message: "Connect a Haggle account to continue. If you do not have one, sign up first.",
  };
}
