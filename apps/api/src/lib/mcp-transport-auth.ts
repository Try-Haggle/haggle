import { hashOauthSecret } from "../services/mcp-oauth.service.js";
import type { AuthUser } from "../middleware/auth.js";

export interface McpTransportBinding {
  userId: string;
  tokenFingerprint: string;
}

export function mcpBearerFingerprint(authorization: string | undefined): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (token.length < 16) return null;
  return hashOauthSecret(token);
}

export function createMcpTransportBinding(
  user: AuthUser | undefined,
  authorization: string | undefined,
): McpTransportBinding | null {
  if (!user?.id) return null;
  const tokenFingerprint = mcpBearerFingerprint(authorization);
  if (!tokenFingerprint) return null;
  return { userId: user.id, tokenFingerprint };
}

export function mcpTransportOwnerMismatch(
  binding: McpTransportBinding,
  user: AuthUser | undefined,
  authorization: string | undefined,
): boolean {
  if (!user?.id || user.id !== binding.userId) return true;
  const tokenFingerprint = mcpBearerFingerprint(authorization);
  return !tokenFingerprint || tokenFingerprint !== binding.tokenFingerprint;
}
