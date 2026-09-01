import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitsForTests } from "../middleware/rate-limit.js";
import { registerMcpOauthRoutes } from "../routes/mcp-oauth.js";

const mocks = vi.hoisted(() => ({
  registerMcpOauthClient: vi.fn(),
  getMcpOauthClient: vi.fn(),
  issueMcpAuthorizationCode: vi.fn(),
  exchangeMcpAuthorizationCode: vi.fn(),
  refreshMcpAccessToken: vi.fn(),
  parseScopes: vi.fn((scope?: string) => (scope ?? "").split(/[\s+,]+/).filter(Boolean)),
}));

vi.mock("../services/mcp-oauth.service.js", () => mocks);

describe("MCP OAuth routes", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    resetRateLimitsForTests();
    app = Fastify();
    app.decorateRequest("user", undefined);
    app.addHook(
      "onRequest",
      async (request: {
        headers: { authorization?: string };
        user?: { id: string; role: string };
      }) => {
        if (request.headers.authorization === "Bearer user") {
          request.user = { id: "00000000-0000-4000-a000-000000000010", role: "user" };
        }
      },
    );
    registerMcpOauthRoutes(app, {} as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("publishes authorization server metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  });

  it("registers a public client", async () => {
    mocks.registerMcpOauthClient.mockResolvedValue({
      ok: true,
      client: { client_id: "mcp_1", redirect_uris: ["https://grok.x.ai/cb"] },
    });
    const res = await app.inject({
      method: "POST",
      url: "/oauth/register",
      payload: { client_name: "Grok", redirect_uris: ["https://grok.x.ai/cb"] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().client_id).toBe("mcp_1");
  });

  it("requires a signed-in user to consent", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/oauth/consent",
      payload: {
        client_id: "mcp_1",
        redirect_uri: "https://grok.x.ai/cb",
        code_challenge: "a".repeat(43),
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("issues an authorization code after consent", async () => {
    mocks.issueMcpAuthorizationCode.mockResolvedValue({ ok: true, code: "auth-code" });
    const res = await app.inject({
      method: "POST",
      url: "/oauth/consent",
      headers: { authorization: "Bearer user" },
      payload: {
        client_id: "mcp_1",
        redirect_uri: "https://grok.x.ai/cb",
        code_challenge: "a".repeat(43),
        scope: "negotiate",
        state: "xyz",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().redirect_to).toContain("code=auth-code");
    expect(res.json().redirect_to).toContain("state=xyz");
  });

  it("rejects consent when no valid scope is requested", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/oauth/consent",
      headers: { authorization: "Bearer user" },
      payload: {
        client_id: "mcp_1",
        redirect_uri: "https://grok.x.ai/cb",
        code_challenge: "a".repeat(43),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_SCOPE");
    expect(mocks.issueMcpAuthorizationCode).not.toHaveBeenCalled();
  });

  it("publishes public client metadata for the connect screen", async () => {
    mocks.getMcpOauthClient.mockResolvedValue({
      clientId: "mcp_1",
      clientName: "Grok Bot",
      redirectUris: ["https://grok.x.ai/cb"],
    });
    const res = await app.inject({ method: "GET", url: "/oauth/clients/mcp_1" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      client_id: "mcp_1",
      client_name: "Grok Bot",
      redirect_uris: ["https://grok.x.ai/cb"],
    });
  });

  it("rate-limits unauthenticated client registration", async () => {
    mocks.registerMcpOauthClient.mockResolvedValue({
      ok: true,
      client: { client_id: "mcp_1", redirect_uris: ["https://grok.x.ai/cb"] },
    });
    for (let i = 0; i < 10; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/oauth/register",
        payload: { client_name: "Grok", redirect_uris: ["https://grok.x.ai/cb"] },
      });
      expect(res.statusCode).toBe(201);
    }
    const blocked = await app.inject({
      method: "POST",
      url: "/oauth/register",
      payload: { client_name: "Grok", redirect_uris: ["https://grok.x.ai/cb"] },
    });
    expect(blocked.statusCode).toBe(429);
  });
});
