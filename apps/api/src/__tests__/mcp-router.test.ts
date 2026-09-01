import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../mcp/tools/index.js", () => ({
  registerTools: vi.fn(),
}));
vi.mock("../mcp/resources.js", () => ({
  registerResources: vi.fn(),
}));

const { registerMcpRoutes } = await import("../mcp/router.js");

const USER_A = { id: "00000000-0000-4000-a000-000000000010", role: "user" };
const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

describe("MCP transport routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.mocked(StreamableHTTPServerTransport).mockImplementation(
      () =>
        ({
          handleRequest: vi.fn(async (_req: IncomingMessage, res: ServerResponse) => {
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
          }),
          close: vi.fn(),
        }) as unknown as StreamableHTTPServerTransport,
    );
    app = Fastify();
    app.decorateRequest("user", undefined);
    app.addHook(
      "onRequest",
      async (request: {
        headers: { authorization?: string };
        user?: { id: string; role: string };
      }) => {
        if (request.headers.authorization === `Bearer ${TOKEN_A}`) {
          request.user = USER_A;
        }
      },
    );
    registerMcpRoutes(app, {} as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects POST, GET, and DELETE without a bearer token", async () => {
    const postRes = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: INITIALIZE_BODY,
    });
    expect(postRes.statusCode).toBe(401);
    expect(postRes.headers["www-authenticate"]).toContain("oauth-protected-resource");

    const getRes = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: { "mcp-session-id": "stolen" },
    });
    expect(getRes.statusCode).toBe(401);
    expect(getRes.headers["www-authenticate"]).toContain("oauth-protected-resource");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: { "mcp-session-id": "stolen" },
    });
    expect(deleteRes.statusCode).toBe(401);
  });

  it("does not die on a stale mcp-session-id after login", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TOKEN_A}`,
        "mcp-session-id": "stale-from-before-deploy",
        accept: "application/json, text/event-stream",
      },
      payload: INITIALIZE_BODY,
    });

    expect(res.statusCode).not.toBe(404);
    const body = res.json() as { error?: string };
    expect(body.error).not.toBe("MCP_SESSION_NOT_FOUND");
    expect(res.statusCode).toBe(200);
  });

  it("lets the same user delete without a live HTTP session", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TOKEN_A}`,
        "mcp-session-id": "already-gone",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("still rejects a token that is not the connected user", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TOKEN_B}`,
        "mcp-session-id": "sess-1",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
