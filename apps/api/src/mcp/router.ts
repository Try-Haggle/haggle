import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import type { Database } from "@haggle/db";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index.js";
import { registerResources } from "./resources.js";

/** Active MCP sessions keyed by session ID */
const sessions = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(db: Database): McpServer {
  const mcp = new McpServer({
    name: "haggle",
    version: "0.1.0",
  });

  registerTools(mcp, db);
  registerResources(mcp);
  return mcp;
}

/**
 * Register MCP Streamable HTTP routes on the Fastify instance.
 * Handles POST (requests), GET (SSE stream), DELETE (session cleanup).
 */
export function registerMcpRoutes(app: FastifyInstance, db: Database) {
  // ─── POST /mcp — Initialize or send requests ────────────
  app.post("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;

    // Existing session — forward request
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.handleRequest(request.raw as IncomingMessage, reply.raw, request.body);
      return reply.hijack();
    }

    // New session — create transport + server
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const server = createMcpServer(db);
    await server.connect(transport);

    await transport.handleRequest(request.raw as IncomingMessage, reply.raw, request.body);

    // Store session AFTER handleRequest — sessionId is assigned during initialize
    if (transport.sessionId) {
      sessions.set(transport.sessionId, transport);
    }
    return reply.hijack();
  });

  // ─── GET /mcp — SSE stream for server-initiated messages ─
  app.get("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      return reply.status(400).send({ error: "Invalid or missing session ID" });
    }

    const transport = sessions.get(sessionId)!;
    await transport.handleRequest(request.raw as IncomingMessage, reply.raw, request.body);
    return reply.hijack();
  });

  // ─── DELETE /mcp — Terminate session ─────────────────────
  app.delete("/mcp", async (request, reply) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId)!;
      await transport.close();
      sessions.delete(sessionId);
    }

    return reply.status(200).send({ ok: true });
  });
}
