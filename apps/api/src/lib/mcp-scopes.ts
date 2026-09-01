import { MCP_OAUTH_SCOPES, type McpOauthScope } from "@haggle/db";
import type { AuthUser } from "../middleware/auth.js";
import { mcpAuthRequired, mcpError } from "../mcp/tools/responses.js";
import { getMcpActor } from "./mcp-actor.js";

export const MCP_TOOL_SCOPES = MCP_OAUTH_SCOPES.filter(
  (scope): scope is Exclude<McpOauthScope, "offline_access"> => scope !== "offline_access",
);

export function actorHasScope(actor: AuthUser, scope: McpOauthScope): boolean {
  if (actor.role === "admin") return true;
  // First-party JWT is the same principal as the web app.
  if (actor.tokenKind !== "mcp") return true;
  return Array.isArray(actor.scopes) && actor.scopes.includes(scope);
}

export function effectiveMcpScopes(actor: AuthUser): string[] {
  if (actor.tokenKind !== "mcp") return [...MCP_TOOL_SCOPES];
  return [...new Set((actor.scopes ?? []).filter((scope) => actorHasScope(actor, scope as McpOauthScope)))];
}

export function requireActorWithScope(scope: McpOauthScope) {
  const actor = getMcpActor();
  if (!actor) return { ok: false as const, error: mcpAuthRequired() };
  if (!actorHasScope(actor, scope)) {
    return {
      ok: false as const,
      error: mcpError("INSUFFICIENT_SCOPE", {
        required: scope,
        granted: actor.scopes ?? [],
      }),
    };
  }
  return { ok: true as const, actor };
}
