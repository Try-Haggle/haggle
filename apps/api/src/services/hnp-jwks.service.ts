import { createPublicKey, type KeyObject } from "node:crypto";

export const SUPPORTED_HNP_JWS_ALGORITHMS = new Set(["RS256", "PS256"]);

export interface HnpTrustedJwk extends Record<string, unknown> {
  kid?: string;
  alg?: string;
  kty?: string;
}

export type HnpTrustedJwksValidationResult =
  | { ok: true; keyCount: number }
  | { ok: false; reason: string };

export function parseTrustedHnpJwks(raw: string | undefined): HnpTrustedJwk[] {
  const trimmed = raw?.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as { keys?: unknown };
  return Array.isArray(parsed.keys)
    ? parsed.keys.filter((key): key is HnpTrustedJwk => Boolean(key && typeof key === "object"))
    : [];
}

export function createTrustedHnpPublicKey(jwk: HnpTrustedJwk): KeyObject {
  return createPublicKey({ key: jwk, format: "jwk" });
}

export function isSupportedTrustedHnpJwk(jwk: HnpTrustedJwk): boolean {
  return jwk.kty === "RSA"
    && typeof jwk.alg === "string"
    && SUPPORTED_HNP_JWS_ALGORITHMS.has(jwk.alg);
}

export function validateTrustedHnpJwks(raw: string | undefined): HnpTrustedJwksValidationResult {
  let jwks: HnpTrustedJwk[];
  try {
    jwks = parseTrustedHnpJwks(raw);
  } catch {
    return { ok: false, reason: "invalid JSON" };
  }

  if (jwks.length === 0) {
    return { ok: false, reason: "no keys found" };
  }

  let usableKeys = 0;
  for (const jwk of jwks) {
    if (!isSupportedTrustedHnpJwk(jwk)) {
      continue;
    }

    try {
      createTrustedHnpPublicKey(jwk);
      usableKeys += 1;
    } catch {
      continue;
    }
  }

  return usableKeys > 0
    ? { ok: true, keyCount: usableKeys }
    : { ok: false, reason: "no supported public keys found" };
}
