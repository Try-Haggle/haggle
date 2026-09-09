/**
 * Staging/local-only dogfood auth env gate (SoT: docs/wip/dogfood-auth-sot.md).
 *
 * Fail-closed: production or missing/short secret → route inactive (404).
 * Does NOT enable supabase-jwt `test_unverified`.
 */

export type DogfoodPersona = "buyer" | "seller";

/** Env bag for gates — looser than ProcessEnv so unit tests can pass partials. */
export type DogfoodAuthEnv = Record<string, string | undefined>;

export const DOGFOOD_PERSONAS: readonly DogfoodPersona[] = ["buyer", "seller"] as const;

export const DOGFOOD_SECRET_HEADER = "x-haggle-dogfood-secret";

const MIN_SECRET_BYTES = 32;

/**
 * Stable persona UUIDs (UUID v5 from tryhaggle.ai dogfood namespaces).
 * Do not rotate — staging dogfood fixtures and listings bind to these ids.
 *
 * buyer  → actor handle `dogfood_buyer`  (start / checkout)
 * seller → actor handle `dogfood_seller` (create / own listing)
 */
export const DOGFOOD_BUYER_USER_ID = "7272c18d-35c9-5ca7-8a5c-9eae55b56572";
export const DOGFOOD_SELLER_USER_ID = "8f48b6af-5aca-56bb-91eb-47dbf271a084";

export const DOGFOOD_PERSONA_USER_IDS: Record<DogfoodPersona, string> = {
  buyer: DOGFOOD_BUYER_USER_ID,
  seller: DOGFOOD_SELLER_USER_ID,
};

export const DOGFOOD_PERSONA_HANDLES: Record<DogfoodPersona, "dogfood_buyer" | "dogfood_seller"> = {
  buyer: "dogfood_buyer",
  seller: "dogfood_seller",
};

/** Synthetic emails for Supabase Auth rows — not real inboxes. */
export const DOGFOOD_PERSONA_EMAILS: Record<DogfoodPersona, string> = {
  buyer: "dogfood-buyer@dogfood.haggle.local",
  seller: "dogfood-seller@dogfood.haggle.local",
};

export function normalizeHaggleEnv(raw: string | undefined): "local" | "staging" | "production" {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "staging") return "staging";
  if (v === "production") return "production";
  return "local";
}

export function isDogfoodPersona(value: unknown): value is DogfoodPersona {
  return value === "buyer" || value === "seller";
}

/**
 * Read dogfood secret when present and ≥32 UTF-8 bytes.
 * Never log the returned value.
 */
export function readDogfoodAuthSecret(env: DogfoodAuthEnv = process.env): string | null {
  const secret = env.HAGGLE_DOGFOOD_AUTH_SECRET;
  if (typeof secret !== "string") return null;
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) return null;
  return secret;
}

/**
 * Route active only when HAGGLE_ENV ∈ {staging, local} AND secret ≥32 bytes.
 * Production stays dark even if a secret is misconfigured.
 */
export function isDogfoodAuthRouteEnabled(env: DogfoodAuthEnv = process.env): boolean {
  if (normalizeHaggleEnv(env.HAGGLE_ENV) === "production") return false;
  const haggleEnv = normalizeHaggleEnv(env.HAGGLE_ENV);
  if (haggleEnv !== "staging" && haggleEnv !== "local") return false;
  return readDogfoodAuthSecret(env) !== null;
}
