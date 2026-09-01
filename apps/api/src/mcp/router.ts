import type { IncomingMessage } from "node:http";
import type { Database } from "@haggle/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { EventDispatcher } from "../lib/event-dispatcher.js";
import { runWithMcpActor } from "../lib/mcp-actor.js";
import {
  createMcpTransportBinding,
  type McpTransportBinding,
  mcpTransportOwnerMismatch,
} from "../lib/mcp-transport-auth.js";
import { publicApiBaseUrl } from "../lib/public-urls.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools/index.js";

type BoundTransportSession = {
  transport: StreamableHTTPServerTransport;
  createdAt: number;
} & McpTransportBinding;

/** Active MCP sessions keyed by session ID, with creation timestamp for TTL */
const sessions = new Map<string, BoundTransportSession>();

/** Max session lifetime: 2 hours. Sweep every 5 minutes. */
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.createdAt > SESSION_TTL_MS) {
      entry.transport.close().catch(() => {});
      sessions.delete(id);
    }
  }
}, SWEEP_INTERVAL_MS).unref(); // unref() so the timer doesn't prevent process exit

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

function rejectMcpSession(reply: FastifyReply) {
  return reply.code(404).send({ error: "MCP_SESSION_NOT_FOUND" });
}

function ownedMcpSession(request: FastifyRequest) {
  const sessionId = request.headers["mcp-session-id"];
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const existing = sessions.get(sessionId);
  if (
    !existing ||
    mcpTransportOwnerMismatch(existing, request.user, request.headers.authorization)
  ) {
    return null;
  }
  return { sessionId, existing };
}

export function resetMcpTransportSessionsForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("MCP transport session reset is test-only");
  }
  sessions.clear();
}

export function seedMcpTransportSessionForTests(
  sessionId: string,
  binding: McpTransportBinding,
  transport: Pick<StreamableHTTPServerTransport, "handleRequest" | "close">,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("MCP transport session seed is test-only");
  }
  sessions.set(sessionId, {
    transport: transport as StreamableHTTPServerTransport,
    createdAt: Date.now(),
    ...binding,
  });
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

  app.post("/mcp", async (request, reply) => {
    const binding = createMcpTransportBinding(request.user, request.headers.authorization);
    if (!binding) {
      return rejectMcpUnauthorized(request, reply);
    }

    const sessionId = request.headers["mcp-session-id"];
    if (typeof sessionId === "string" && sessionId.length > 0) {
      const owned = ownedMcpSession(request);
      if (!owned) return rejectMcpSession(reply);
      await runWithMcpActor(request.user, () =>
        owned.existing.transport.handleRequest(
          request.raw as IncomingMessage,
          reply.raw,
          request.body,
        ),
      );
      return reply.hijack();
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const server = createMcpServer(db, eventDispatcher);
    await server.connect(transport);

    await runWithMcpActor(request.user, () =>
      transport.handleRequest(request.raw as IncomingMessage, reply.raw, request.body),
    );

    if (transport.sessionId) {
      sessions.set(transport.sessionId, { transport, createdAt: Date.now(), ...binding });
    }
    return reply.hijack();
  });

  app.get("/mcp", async (request, reply) => {
    const binding = createMcpTransportBinding(request.user, request.headers.authorization);
    if (!binding) {
      return rejectMcpUnauthorized(request, reply);
    }

    const owned = ownedMcpSession(request);
    if (!owned) return rejectMcpSession(reply);

    await runWithMcpActor(request.user, () =>
      owned.existing.transport.handleRequest(
        request.raw as IncomingMessage,
        reply.raw,
        request.body,
      ),
    );
    return reply.hijack();
  });

  app.delete("/mcp", async (request, reply) => {
    const binding = createMcpTransportBinding(request.user, request.headers.authorization);
    if (!binding) {
      return rejectMcpUnauthorized(request, reply);
    }

    const owned = ownedMcpSession(request);
    if (!owned) return rejectMcpSession(reply);

    await owned.existing.transport.close();
    sessions.delete(owned.sessionId);
    return reply.status(200).send({ ok: true });
  });
}
