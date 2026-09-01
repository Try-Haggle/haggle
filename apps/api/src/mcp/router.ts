import type { IncomingMessage } from "node:http";
import type { Database } from "@haggle/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import { runWithMcpActor } from "../lib/mcp-actor.js";
import { createMcpTransportBinding } from "../lib/mcp-transport-auth.js";
import { publicApiBaseUrl } from "../lib/public-urls.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools/index.js";

function createMcpServer(db: Database, eventDispatcher?: EventDispatcher): McpServer {
  const mcp = new McpServer({
    name: "haggle",
    version: "0.1.0",
  });

  registerTools(mcp, db, eventDispatcher);
  registerResources(mcp);
  return mcp;
}

function mcpWwwAuthenticate(request: FastifyRequest): string {
  return `Bearer realm="haggle", resource_metadata="${publicApiBaseUrl(request)}/.well-known/oauth-protected-resource"`;
}

function rejectMcpUnauthorized(request: FastifyRequest, reply: FastifyReply) {
  return reply
    .header("WWW-Authenticate", mcpWwwAuthenticate(request))
    .code(401)
    .send({ error: "AUTH_REQUIRED" });
}

/**
 * One request = one transport. Grok keeps a mcp-session-id across Railway
 * restarts; an in-memory Map then answers MCP_SESSION_NOT_FOUND and the
 * connector dies. Stateless mode ignores that header and still requires Bearer.
 */
async function handleStatelessMcp(
  request: FastifyRequest,
  reply: FastifyReply,
  db: Database,
  eventDispatcher?: EventDispatcher,
) {
  const binding = createMcpTransportBinding(request.user, request.headers.authorization);
  if (!binding) {
    return rejectMcpUnauthorized(request, reply);
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer(db, eventDispatcher);
  await server.connect(transport);
  await runWithMcpActor(request.user, () =>
    transport.handleRequest(request.raw as IncomingMessage, reply.raw, request.body),
  );
  return reply.hijack();
}

/**
 * Register MCP Streamable HTTP routes on the Fastify instance.
 * Handles POST (requests), GET (SSE stream), DELETE (session cleanup).
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  db: Database,
  eventDispatcher?: EventDispatcher,
) {
  app.addHook("onRequest", async (request, reply) => {
    if (request.url.split("?")[0] !== "/mcp") return;
    if (request.user) return;
    return rejectMcpUnauthorized(request, reply);
  });

  app.post("/mcp", async (request, reply) =>
    handleStatelessMcp(request, reply, db, eventDispatcher),
  );

  app.get("/mcp", async (request, reply) =>
    handleStatelessMcp(request, reply, db, eventDispatcher),
  );

  app.delete("/mcp", async (request, reply) => {
    const binding = createMcpTransportBinding(request.user, request.headers.authorization);
    if (!binding) {
      return rejectMcpUnauthorized(request, reply);
    }
    return reply.status(200).send({ ok: true });
  });
}
