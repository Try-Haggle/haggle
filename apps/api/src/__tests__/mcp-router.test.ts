import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMcpTransportBinding } from "../lib/mcp-transport-auth.js";
import {
  registerMcpRoutes,
  resetMcpTransportSessionsForTests,
  seedMcpTransportSessionForTests,
} from "../mcp/router.js";

const USER_A = { id: "00000000-0000-4000-a000-000000000010", role: "user" };
const USER_B = { id: "00000000-0000-4000-a000-000000000011", role: "user" };
const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

describe("MCP transport routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    resetMcpTransportSessionsForTests();
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
        if (request.headers.authorization === `Bearer ${TOKEN_B}`) {
          request.user = USER_B;
        }
      },
    );
    registerMcpRoutes(app, {} as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    resetMcpTransportSessionsForTests();
  });

  it("rejects POST, GET, and DELETE without a bearer token", async () => {
    const postRes = await app.inject({
      method: "POST",
      url: "/mcp",
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
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

  it("rejects a stolen session id used with a different user token", async () => {
    const binding = createMcpTransportBinding(USER_A, `Bearer ${TOKEN_A}`);
    seedMcpTransportSessionForTests("sess-1", binding!, {
      handleRequest: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    });

    const res = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TOKEN_B}`,
        "mcp-session-id": "sess-1",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("MCP_SESSION_NOT_FOUND");
  });

  it("does not let DELETE close someone else's session", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const binding = createMcpTransportBinding(USER_A, `Bearer ${TOKEN_A}`);
    seedMcpTransportSessionForTests("sess-1", binding!, {
      handleRequest: vi.fn(),
      close,
    });

    const res = await app.inject({
      method: "DELETE",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${TOKEN_B}`,
        "mcp-session-id": "sess-1",
      },
    });
    expect(res.statusCode).toBe(404);
    expect(close).not.toHaveBeenCalled();
  });
});
