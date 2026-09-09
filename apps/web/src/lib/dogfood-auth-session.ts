/**
 * Parse dogfood mint responses without inventing tokens.
 * Until T1 merges, upstream may 404/501 — callers must surface that clearly.
 */

import type { DogfoodPersona } from "./dogfood-auth-gate";

export const T1_API_NOT_LIVE_CODE = "T1_API_NOT_LIVE";
export const T1_API_NOT_LIVE_MESSAGE =
  "T1 API not live — dogfood session mint is not available yet.";

export type DogfoodSessionTokens = {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  persona?: DogfoodPersona;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Extract web-usable session tokens from an upstream JSON body.
 * Returns null when tokens are missing — never fabricates them.
 */
export function parseDogfoodSessionTokens(body: unknown): DogfoodSessionTokens | null {
  const root = asRecord(body);
  if (!root) return null;

  const nested = asRecord(root.session) ?? asRecord(root.data) ?? root;

  const access_token =
    asNonEmptyString(nested.access_token) ?? asNonEmptyString(nested.accessToken);
  const refresh_token =
    asNonEmptyString(nested.refresh_token) ?? asNonEmptyString(nested.refreshToken);

  if (!access_token || !refresh_token) return null;

  const personaRaw = nested.persona ?? root.persona;
  const persona = personaRaw === "buyer" || personaRaw === "seller" ? personaRaw : undefined;

  return {
    access_token,
    refresh_token,
    expires_at: asOptionalNumber(nested.expires_at ?? nested.expiresAt),
    expires_in: asOptionalNumber(nested.expires_in ?? nested.expiresIn),
    persona,
  };
}

export function isUpstreamDogfoodStubStatus(status: number): boolean {
  return status === 404 || status === 501;
}
