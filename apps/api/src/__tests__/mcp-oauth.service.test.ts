import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangeMcpAuthorizationCode,
  hashOauthSecret,
  issueMcpAuthorizationCode,
  parseScopes,
  registerMcpOauthClient,
  resolveMcpAccessToken,
  verifyPkceS256,
} from "../services/mcp-oauth.service.js";

function rowsQueue(rows: unknown[][]) {
  (
    globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
  ).__HAGGLE_TEST_DB_SELECT_ROWS__ = rows;
}

function memoryDb() {
  const inserted: Record<string, unknown[][]> = {};
  const updated: unknown[] = [];
  return {
    inserted,
    updated,
    insert: vi.fn((table: { clientId?: string; codeHash?: string; tokenHash?: string }) => ({
      values: vi.fn((value: Record<string, unknown>) => {
        const key = table.clientId ? "clients" : table.codeHash ? "codes" : "tokens";
        inserted[key] ??= [];
        inserted[key].push([value]);
        return { returning: vi.fn().mockResolvedValue([value]) };
      }),
    })),
    select: vi.fn(),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updated.push(value);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    })),
  };
}

describe("mcp oauth", () => {
  beforeEach(() => {
    rowsQueue([]);
  });

  it("parses known scopes and drops unknown ones", () => {
    expect(parseScopes("agents listings hack-the-planet")).toEqual(["agents", "listings"]);
    expect(parseScopes(undefined)).toEqual([]);
    expect(parseScopes("hack-the-planet")).toEqual([]);
  });

  it("verifies PKCE S256", () => {
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256(verifier, "nope")).toBe(false);
  });

  it("registers a public client", async () => {
    const db = memoryDb();
    const registered = await registerMcpOauthClient(db as never, {
      client_name: "Grok",
      redirect_uris: ["https://grok.x.ai/callback"],
    });
    expect(registered.ok).toBe(true);
    if (registered.ok) {
      expect(registered.client.token_endpoint_auth_method).toBe("none");
      expect(registered.client.client_id.startsWith("mcp_")).toBe(true);
    }
  });

  it("rejects non-loopback http redirect URIs at registration", async () => {
    const db = memoryDb();
    const registered = await registerMcpOauthClient(db as never, {
      client_name: "Phish",
      redirect_uris: ["http://evil.example/callback"],
    });
    expect(registered.ok).toBe(false);
    if (!registered.ok) expect(registered.error).toBe("INVALID_REDIRECT_URI");
  });

  it("keeps loopback http redirects for local MCP inspectors", async () => {
    const db = memoryDb();
    const registered = await registerMcpOauthClient(db as never, {
      client_name: "Inspector",
      redirect_uris: ["http://127.0.0.1:6274/callback"],
    });
    expect(registered.ok).toBe(true);
  });

  it("exchanges a code with PKCE and resolves the access token", async () => {
    const verifier = "b".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const db = memoryDb();
    db.select = vi.fn().mockImplementation(() => {
      const queue = (
        globalThis as typeof globalThis & { __HAGGLE_TEST_DB_SELECT_ROWS__?: unknown[][] }
      ).__HAGGLE_TEST_DB_SELECT_ROWS__;
      const rows = queue?.shift() ?? [];
      const result = Promise.resolve(rows);
      const query = {
        from: vi.fn(() => query),
        where: vi.fn(() => query),
        limit: vi.fn(() => query),
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query mocks must remain awaitable.
        then: result.then.bind(result),
        catch: result.catch.bind(result),
        finally: result.finally.bind(result),
      };
      return query;
    });

    rowsQueue([
      [
        {
          clientId: "mcp_test",
          redirectUris: ["https://grok.x.ai/callback"],
        },
      ],
    ]);
    const issued = await issueMcpAuthorizationCode(db as never, {
      clientId: "mcp_test",
      userId: "00000000-0000-4000-a000-000000000010",
      redirectUri: "https://grok.x.ai/callback",
      codeChallenge: challenge,
      scopes: ["negotiate"],
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    rowsQueue([
      [{ clientId: "mcp_test", redirectUris: ["https://grok.x.ai/callback"] }],
      [
        {
          id: "code-1",
          redirectUri: "https://grok.x.ai/callback",
          codeChallenge: challenge,
          clientId: "mcp_test",
          userId: "00000000-0000-4000-a000-000000000010",
          scopes: ["negotiate"],
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    ]);
    const exchanged = await exchangeMcpAuthorizationCode(db as never, {
      clientId: "mcp_test",
      redirectUri: "https://grok.x.ai/callback",
      code: issued.code,
      codeVerifier: verifier,
    });
    expect(exchanged.ok).toBe(true);
    if (!exchanged.ok) return;

    rowsQueue([
      [
        {
          userId: "00000000-0000-4000-a000-000000000010",
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: null,
          scopes: ["negotiate"],
        },
      ],
    ]);
    const user = await resolveMcpAccessToken(db as never, exchanged.tokens.access_token);
    expect(user).toEqual({
      id: "00000000-0000-4000-a000-000000000010",
      role: "user",
      tokenKind: "mcp",
      scopes: ["negotiate"],
    });
    expect(hashOauthSecret(exchanged.tokens.access_token)).toHaveLength(64);
  });
});
