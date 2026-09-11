import { createHash, randomBytes } from "node:crypto";
import {
  and,
  type Database,
  eq,
  isNull,
  MCP_OAUTH_SCOPES,
  mcpOauthAccessTokens,
  mcpOauthAuthorizationCodes,
  mcpOauthClients,
} from "@haggle/db";
import { isSafeMcpRedirectUri } from "../lib/mcp-redirect-uri.js";
import type { AuthUser } from "../middleware/auth.js";

export const MCP_OAUTH_SCOPE_SET = new Set<string>(MCP_OAUTH_SCOPES);
const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashOauthSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateOauthToken(): string {
  return randomBytes(32).toString("base64url");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const digest = createHash("sha256").update(verifier).digest("base64url");
  return digest === challenge;
}

export function parseScopes(raw: string | undefined): string[] {
  const requested = (raw ?? "")
    .split(/[\s+,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return [...new Set(requested.filter((scope) => MCP_OAUTH_SCOPE_SET.has(scope)))];
}

export function isAllowedRedirectUri(registered: string[], requested: string): boolean {
  return registered.includes(requested);
}

export async function registerMcpOauthClient(
  db: Database,
  input: { client_name?: string; redirect_uris?: string[] },
) {
  const redirectUris = [...new Set((input.redirect_uris ?? []).filter(isSafeMcpRedirectUri))];
  if (redirectUris.length === 0) {
    return { ok: false as const, error: "INVALID_REDIRECT_URI" };
  }

  const clientId = `mcp_${randomBytes(16).toString("hex")}`;
  await db.insert(mcpOauthClients).values({
    clientId,
    clientName: input.client_name?.trim() || "MCP client",
    redirectUris,
    tokenEndpointAuthMethod: "none",
  });

  return {
    ok: true as const,
    client: {
      client_id: clientId,
      client_name: input.client_name?.trim() || "MCP client",
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      code_challenge_methods_supported: ["S256"],
    },
  };
}

export async function getMcpOauthClient(db: Database, clientId: string) {
  const [row] = await db
    .select()
    .from(mcpOauthClients)
    .where(eq(mcpOauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function issueMcpAuthorizationCode(
  db: Database,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: string[];
  },
) {
  const client = await getMcpOauthClient(db, input.clientId);
  if (!client) return { ok: false as const, error: "UNKNOWN_CLIENT" };
  if (!isAllowedRedirectUri(client.redirectUris, input.redirectUri)) {
    return { ok: false as const, error: "INVALID_REDIRECT_URI" };
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) {
    return { ok: false as const, error: "INVALID_CODE_CHALLENGE" };
  }
  if (input.scopes.length === 0 || input.scopes.some((scope) => !MCP_OAUTH_SCOPE_SET.has(scope))) {
    return { ok: false as const, error: "INVALID_SCOPE" };
  }

  const code = generateOauthToken();
  await db.insert(mcpOauthAuthorizationCodes).values({
    codeHash: hashOauthSecret(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: "S256",
    scopes: input.scopes,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return { ok: true as const, code };
}

export async function exchangeMcpAuthorizationCode(
  db: Database,
  input: {
    clientId: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  },
) {
  const client = await getMcpOauthClient(db, input.clientId);
  if (!client) return { ok: false as const, error: "UNKNOWN_CLIENT" };

  const [row] = await db
    .select()
    .from(mcpOauthAuthorizationCodes)
    .where(
      and(
        eq(mcpOauthAuthorizationCodes.codeHash, hashOauthSecret(input.code)),
        eq(mcpOauthAuthorizationCodes.clientId, input.clientId),
        isNull(mcpOauthAuthorizationCodes.consumedAt),
      ),
    )
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) {
    return { ok: false as const, error: "INVALID_GRANT" };
  }
  if (row.redirectUri !== input.redirectUri) {
    return { ok: false as const, error: "INVALID_GRANT" };
  }
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
    return { ok: false as const, error: "INVALID_GRANT" };
  }

  await db
    .update(mcpOauthAuthorizationCodes)
    .set({ consumedAt: new Date() })
    .where(eq(mcpOauthAuthorizationCodes.id, row.id));

  return issueAccessTokens(db, {
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes,
  });
}

export async function refreshMcpAccessToken(
  db: Database,
  input: { clientId: string; refreshToken: string },
) {
  const [row] = await db
    .select()
    .from(mcpOauthAccessTokens)
    .where(
      and(
        eq(mcpOauthAccessTokens.refreshTokenHash, hashOauthSecret(input.refreshToken)),
        eq(mcpOauthAccessTokens.clientId, input.clientId),
        isNull(mcpOauthAccessTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row?.refreshExpiresAt || row.refreshExpiresAt.getTime() <= Date.now()) {
    return { ok: false as const, error: "INVALID_GRANT" };
  }

  await db
    .update(mcpOauthAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(mcpOauthAccessTokens.id, row.id));

  return issueAccessTokens(db, {
    clientId: row.clientId,
    userId: row.userId,
    scopes: row.scopes,
  });
}

async function issueAccessTokens(
  db: Database,
  input: { clientId: string; userId: string; scopes: string[] },
) {
  const accessToken = generateOauthToken();
  const refreshToken = input.scopes.includes("offline_access") ? generateOauthToken() : null;
  const now = Date.now();
  await db.insert(mcpOauthAccessTokens).values({
    tokenHash: hashOauthSecret(accessToken),
    refreshTokenHash: refreshToken ? hashOauthSecret(refreshToken) : null,
    clientId: input.clientId,
    userId: input.userId,
    scopes: input.scopes,
    expiresAt: new Date(now + ACCESS_TTL_MS),
    refreshExpiresAt: refreshToken ? new Date(now + REFRESH_TTL_MS) : null,
  });
  return {
    ok: true as const,
    tokens: {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      scope: input.scopes.join(" "),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    },
  };
}

export async function resolveMcpAccessToken(db: Database, token: string): Promise<AuthUser | null> {
  if (!token || token.length < 16) return null;
  const [row] = await db
    .select()
    .from(mcpOauthAccessTokens)
    .where(
      and(
        eq(mcpOauthAccessTokens.tokenHash, hashOauthSecret(token)),
        isNull(mcpOauthAccessTokens.revokedAt),
      ),
    )
    .limit(1);
  if (!row || row.expiresAt.getTime() <= Date.now()) return null;
  const scopes = Array.isArray(row.scopes)
    ? row.scopes.filter((scope) => MCP_OAUTH_SCOPE_SET.has(scope))
    : [];
  return { id: row.userId, role: "user", tokenKind: "mcp", scopes };
}
