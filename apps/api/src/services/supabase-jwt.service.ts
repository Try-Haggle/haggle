import { createPublicKey, type JsonWebKey } from "node:crypto";
import jwt, { type Algorithm, type JwtPayload } from "jsonwebtoken";

export type SupabaseJwtMode = "jwks" | "legacy_hs256" | "test_unverified";

export interface SupabaseJwtPayload extends JwtPayload {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: { role?: string };
  app_metadata?: { role?: string };
}

export interface SupabaseJwtConfig {
  mode: SupabaseJwtMode;
  issuer?: string;
  audience?: string;
  jwksUrl?: string;
  legacySecret?: string;
  cacheTtlMs: number;
  fetchTimeoutMs: number;
  maxResponseBytes: number;
  maxKeys: number;
}

export interface SupabaseJwtPolicyStatus {
  mode: SupabaseJwtMode;
  signatureVerified: boolean;
  algorithms: string[];
  issuerVerified: boolean;
  audienceVerified: boolean;
  subjectUuidVerified: boolean;
  sharedAcrossHttpAndWebSocket: true;
  unknownKidForcesRefresh: boolean;
  fetchTimeoutMs: number | null;
  maxResponseBytes: number | null;
  maxKeys: number | null;
  containsSecret: false;
  containsKeys: false;
  containsIdentifiers: false;
}

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1_000;
const DEFAULT_FETCH_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1_024;
const DEFAULT_MAX_KEYS = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  if (!raw?.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return parsed;
}

function runtimeIsProtected(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === "production" ||
    env.VERCEL_ENV === "production" ||
    env.HAGGLE_ENV === "staging" ||
    env.HAGGLE_ENV === "production"
  );
}

function resolveSupabaseOrigin(env: NodeJS.ProcessEnv): URL | null {
  const raw = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("SUPABASE_URL must be a valid absolute URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("SUPABASE_URL must not include credentials, query, or fragment");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("SUPABASE_URL must be an origin without a path");
  }
  if (runtimeIsProtected(env) && url.protocol !== "https:") {
    throw new Error("SUPABASE_URL must use HTTPS in staging and production");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("SUPABASE_URL must use HTTP or HTTPS");
  }
  return url;
}

export function resolveSupabaseJwtConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseJwtConfig {
  const origin = resolveSupabaseOrigin(env);
  const explicitMode = env.HAGGLE_SUPABASE_JWT_MODE?.trim().toLowerCase();
  if (explicitMode && !["jwks", "legacy_hs256", "test_unverified"].includes(explicitMode)) {
    throw new Error("HAGGLE_SUPABASE_JWT_MODE must be jwks, legacy_hs256, or test_unverified");
  }

  const mode = (explicitMode ||
    (origin
      ? "jwks"
      : env.SUPABASE_JWT_SECRET?.trim()
        ? "legacy_hs256"
        : env.HAGGLE_ALLOW_UNVERIFIED_TEST_JWT === "true" && !runtimeIsProtected(env)
          ? "test_unverified"
          : "jwks")) as SupabaseJwtMode;
  if (mode === "test_unverified") {
    if (
      runtimeIsProtected(env) ||
      !["test", "development"].includes(env.NODE_ENV ?? "") ||
      env.HAGGLE_ALLOW_UNVERIFIED_TEST_JWT !== "true"
    ) {
      throw new Error("test_unverified JWT mode is allowed only in explicit local/test fixtures");
    }
  }
  if (mode === "jwks" && !origin) {
    throw new Error("SUPABASE_URL is required for JWKS authentication");
  }
  if (mode === "legacy_hs256" && !env.SUPABASE_JWT_SECRET?.trim()) {
    throw new Error("SUPABASE_JWT_SECRET is required for legacy_hs256 authentication");
  }

  const audience =
    env.SUPABASE_JWT_AUDIENCE?.trim() || (mode === "jwks" ? "authenticated" : undefined);
  if (audience && audience.length > 128)
    throw new Error("SUPABASE_JWT_AUDIENCE must be at most 128 characters");

  const base = origin?.origin;
  return {
    mode,
    issuer: base ? `${base}/auth/v1` : undefined,
    audience,
    jwksUrl: base ? `${base}/auth/v1/.well-known/jwks.json` : undefined,
    legacySecret: mode === "legacy_hs256" ? env.SUPABASE_JWT_SECRET!.trim() : undefined,
    cacheTtlMs: positiveInteger(
      env.SUPABASE_JWKS_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS,
      "SUPABASE_JWKS_CACHE_TTL_MS",
      60 * 60 * 1_000,
    ),
    fetchTimeoutMs: positiveInteger(
      env.SUPABASE_JWKS_FETCH_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS,
      "SUPABASE_JWKS_FETCH_TIMEOUT_MS",
      10_000,
    ),
    maxResponseBytes: positiveInteger(
      env.SUPABASE_JWKS_MAX_RESPONSE_BYTES,
      DEFAULT_MAX_RESPONSE_BYTES,
      "SUPABASE_JWKS_MAX_RESPONSE_BYTES",
      256 * 1_024,
    ),
    maxKeys: positiveInteger(
      env.SUPABASE_JWKS_MAX_KEYS,
      DEFAULT_MAX_KEYS,
      "SUPABASE_JWKS_MAX_KEYS",
      50,
    ),
  };
}

export function describeSupabaseJwtPolicy(config: SupabaseJwtConfig): SupabaseJwtPolicyStatus {
  const jwks = config.mode === "jwks";
  return {
    mode: config.mode,
    signatureVerified: config.mode !== "test_unverified",
    algorithms: jwks ? ["ES256", "RS256"] : config.mode === "legacy_hs256" ? ["HS256"] : [],
    issuerVerified: config.mode !== "test_unverified" && Boolean(config.issuer),
    audienceVerified: config.mode !== "test_unverified" && Boolean(config.audience),
    subjectUuidVerified: config.mode !== "test_unverified",
    sharedAcrossHttpAndWebSocket: true,
    unknownKidForcesRefresh: jwks,
    fetchTimeoutMs: jwks ? config.fetchTimeoutMs : null,
    maxResponseBytes: jwks ? config.maxResponseBytes : null,
    maxKeys: jwks ? config.maxKeys : null,
    containsSecret: false,
    containsKeys: false,
    containsIdentifiers: false,
  };
}

type FetchLike = typeof fetch;

interface CachedJwks {
  fetchedAt: number;
  keys: Map<string, { pem: string; algorithm: "ES256" | "RS256" }>;
}

function requiredString(key: Record<string, unknown>, name: string): string {
  const value = key[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`JWKS key is missing ${name}`);
  return value;
}

function parseJwksKey(raw: Record<string, unknown>): {
  kid: string;
  pem: string;
  algorithm: "ES256" | "RS256";
} {
  const kid = requiredString(raw, "kid");
  const kty = requiredString(raw, "kty");
  const use = raw.use;
  if (use !== undefined && use !== "sig") throw new Error("JWKS key use must be sig");

  let algorithm: "ES256" | "RS256";
  if (kty === "EC") {
    if (raw.crv !== "P-256") throw new Error("JWKS EC key must use P-256");
    requiredString(raw, "x");
    requiredString(raw, "y");
    algorithm = "ES256";
  } else if (kty === "RSA") {
    requiredString(raw, "n");
    requiredString(raw, "e");
    algorithm = "RS256";
  } else {
    throw new Error("JWKS key type must be EC or RSA");
  }
  if (raw.alg !== undefined && raw.alg !== algorithm)
    throw new Error("JWKS key algorithm does not match key type");
  const publicKey = createPublicKey({ key: raw as JsonWebKey, format: "jwk" });
  return {
    kid,
    algorithm,
    pem: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

export class SupabaseJwtVerifier {
  private cache: CachedJwks | null = null;
  private fetchPromise: Promise<CachedJwks> | null = null;

  constructor(
    readonly config: SupabaseJwtConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  policyStatus(): SupabaseJwtPolicyStatus {
    return describeSupabaseJwtPolicy(this.config);
  }

  private async fetchJwks(): Promise<CachedJwks> {
    if (this.fetchPromise) return this.fetchPromise;
    this.fetchPromise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.fetchTimeoutMs);
      try {
        const response = await this.fetchImpl(this.config.jwksUrl!, {
          method: "GET",
          headers: { accept: "application/json" },
          redirect: "error",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`JWKS request failed with ${response.status}`);
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("application/json"))
          throw new Error("JWKS response must be JSON");
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > this.config.maxResponseBytes)
          throw new Error("JWKS response is too large");
        const body = await response.text();
        if (Buffer.byteLength(body, "utf8") > this.config.maxResponseBytes)
          throw new Error("JWKS response is too large");
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new Error("JWKS response is malformed JSON");
        }
        const keys = (parsed as { keys?: unknown })?.keys;
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > this.config.maxKeys) {
          throw new Error(`JWKS must contain 1..${this.config.maxKeys} keys`);
        }
        const next = new Map<string, { pem: string; algorithm: "ES256" | "RS256" }>();
        for (const raw of keys) {
          if (!raw || typeof raw !== "object" || Array.isArray(raw))
            throw new Error("JWKS keys must be objects");
          const parsedKey = parseJwksKey(raw as Record<string, unknown>);
          if (next.has(parsedKey.kid)) throw new Error("JWKS key ids must be unique");
          next.set(parsedKey.kid, { pem: parsedKey.pem, algorithm: parsedKey.algorithm });
        }
        const cache = { fetchedAt: Date.now(), keys: next };
        this.cache = cache;
        return cache;
      } finally {
        clearTimeout(timeout);
        this.fetchPromise = null;
      }
    })();
    return this.fetchPromise;
  }

  private async keyFor(kid: string, algorithm: "ES256" | "RS256") {
    const fresh = this.cache && Date.now() - this.cache.fetchedAt <= this.config.cacheTtlMs;
    let cache = fresh ? this.cache! : await this.fetchJwks();
    let key = cache.keys.get(kid);
    if (!key && fresh) {
      cache = await this.fetchJwks();
      key = cache.keys.get(kid);
    }
    if (!key) throw new Error("JWT signing key was not found");
    if (key.algorithm !== algorithm) throw new Error("JWT algorithm does not match signing key");
    return key.pem;
  }

  async verify(token: string): Promise<SupabaseJwtPayload> {
    if (!token || token.length > 16_384) throw new Error("Invalid JWT size");
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === "string" || typeof decoded.payload === "string") {
      throw new Error("Invalid JWT format");
    }
    const algorithm = decoded.header.alg;

    let payload: SupabaseJwtPayload;
    if (this.config.mode === "test_unverified") {
      payload = decoded.payload as SupabaseJwtPayload;
      if (payload.exp !== undefined && payload.exp * 1_000 <= Date.now())
        throw new Error("JWT expired");
    } else if (this.config.mode === "legacy_hs256") {
      if (algorithm !== "HS256") throw new Error("JWT algorithm is not allowed");
      payload = jwt.verify(token, this.config.legacySecret!, {
        algorithms: ["HS256"],
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: 5,
      }) as SupabaseJwtPayload;
    } else {
      if (algorithm !== "ES256" && algorithm !== "RS256")
        throw new Error("JWT algorithm is not allowed");
      const kid = decoded.header.kid;
      if (typeof kid !== "string" || !kid.trim() || kid.length > 256)
        throw new Error("JWT kid is required");
      const publicKey = await this.keyFor(kid, algorithm);
      payload = jwt.verify(token, publicKey, {
        algorithms: [algorithm as Algorithm],
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: 5,
      }) as SupabaseJwtPayload;
    }
    if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 256) {
      throw new Error("JWT subject is required");
    }
    if (this.config.mode !== "test_unverified" && !UUID_PATTERN.test(payload.sub)) {
      throw new Error("JWT subject must be a UUID");
    }
    return payload;
  }
}

let sharedVerifier: SupabaseJwtVerifier | null = null;
let sharedSignature = "";

export function getSupabaseJwtVerifier(): SupabaseJwtVerifier {
  const config = resolveSupabaseJwtConfigFromEnv();
  const signature = JSON.stringify({
    mode: config.mode,
    issuer: config.issuer,
    audience: config.audience,
    jwksUrl: config.jwksUrl,
    legacySecret: config.legacySecret,
    cacheTtlMs: config.cacheTtlMs,
    fetchTimeoutMs: config.fetchTimeoutMs,
    maxResponseBytes: config.maxResponseBytes,
    maxKeys: config.maxKeys,
  });
  if (!sharedVerifier || signature !== sharedSignature) {
    sharedVerifier = new SupabaseJwtVerifier(config);
    sharedSignature = signature;
  }
  return sharedVerifier;
}

export function resetSupabaseJwtVerifierForTests(): void {
  sharedVerifier = null;
  sharedSignature = "";
}
