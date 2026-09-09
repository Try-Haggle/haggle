/**
 * Staging/local-only dogfood auth surface gate (SoT: docs/wip/dogfood-auth-sot.md).
 *
 * Fail-closed on production host/build. Secret presence is checked separately
 * on the BFF so the browser never sees HAGGLE_DOGFOOD_AUTH_SECRET.
 */

export type DogfoodPersona = "buyer" | "seller";

export const DOGFOOD_PERSONAS: readonly DogfoodPersona[] = ["buyer", "seller"] as const;

const MIN_SECRET_BYTES = 32;

export function normalizeHaggleEnv(raw: string | undefined): "local" | "staging" | "production" {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "staging") return "staging";
  if (v === "production") return "production";
  return "local";
}

/** True when this process must never expose dogfood login (prod build/host). */
export function isDogfoodAuthProductionClosed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (normalizeHaggleEnv(env.HAGGLE_ENV) === "production") return true;
  if (env.VERCEL_ENV === "production") return true;
  return false;
}

/**
 * Page/link visibility: staging + local only.
 * Matches design-system gate pattern (VERCEL_ENV) plus explicit HAGGLE_ENV.
 */
export function isDogfoodAuthWebSurfaceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isDogfoodAuthProductionClosed(env)) return false;
  const haggleEnv = normalizeHaggleEnv(env.HAGGLE_ENV);
  return haggleEnv === "staging" || haggleEnv === "local";
}

export function readDogfoodAuthSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.HAGGLE_DOGFOOD_AUTH_SECRET;
  if (typeof secret !== "string") return null;
  // Prefer byte length so multi-byte chars cannot under-fill the SoT floor.
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) return null;
  return secret;
}

/**
 * BFF/proxy may call upstream only when surface is enabled AND secret is set.
 * Production or missing/short secret → fail-closed (caller returns 404).
 */
export function isDogfoodAuthBffEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isDogfoodAuthWebSurfaceEnabled(env)) return false;
  return readDogfoodAuthSecret(env) !== null;
}

export function isDogfoodPersona(value: unknown): value is DogfoodPersona {
  return value === "buyer" || value === "seller";
}
