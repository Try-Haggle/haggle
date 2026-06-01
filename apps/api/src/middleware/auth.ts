import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import jwt from "jsonwebtoken";
import { createPublicKey } from "node:crypto";
import { isProductionRuntime } from "../config/runtime.js";

export interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  role?: string;
  user_metadata?: { role?: string };
  app_metadata?: { role?: string };
}

// ── JWKS cache ───────────────────────────────────────────────────────────────
// Supabase now signs tokens with ECC P-256 (ES256) by default.
// Public keys are fetched from the JWKS endpoint and cached for 10 minutes.

let jwksCache: Map<string, string> = new Map(); // kid → PEM
let jwksCachedAt = 0;
const JWKS_TTL_MS = 10 * 60 * 1000;

async function getPublicKeyForKid(kid: string | undefined): Promise<string | null> {
  const now = Date.now();

  if (now - jwksCachedAt > JWKS_TTL_MS || jwksCache.size === 0) {
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return null;

    try {
      const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
      if (!res.ok) return null;

      const { keys } = (await res.json()) as { keys: Record<string, unknown>[] };
      const newCache = new Map<string, string>();
      let isFirst = true;

      for (const key of keys) {
        try {
          const publicKey = createPublicKey({ key: key as import("node:crypto").JsonWebKey, format: "jwk" });
          const pem = publicKey.export({ type: "spki", format: "pem" }) as string;
          const keyKid = key.kid as string | undefined;
          if (keyKid) newCache.set(keyKid, pem);
          if (isFirst) { newCache.set("__default__", pem); isFirst = false; }
        } catch {
          // Skip malformed keys
        }
      }

      jwksCache = newCache;
      jwksCachedAt = now;
    } catch {
      // Network error — keep stale cache
    }
  }

  if (kid && jwksCache.has(kid)) return jwksCache.get(kid)!;
  return jwksCache.get("__default__") ?? null;
}

// ── JWT verification ──────────────────────────────────────────────────────────

async function verifySupabaseJwt(token: string): Promise<SupabaseJwtPayload> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") throw new Error("Invalid JWT format");

  const alg = (decoded.header as { alg?: string }).alg ?? "HS256";
  const kid = (decoded.header as { kid?: string }).kid;

  // ES256 / RS256 — verify with JWKS public key
  if (alg === "ES256" || alg === "RS256") {
    const publicKey = await getPublicKeyForKid(kid);

    if (!publicKey) {
      if (isProductionRuntime()) {
        throw new Error(`[AUTH] Could not fetch JWKS public key for alg=${alg}`);
      }
      // Local dev fallback — decode without verification
      const payload = decoded.payload as SupabaseJwtPayload;
      if (!payload.sub) throw new Error("Invalid JWT payload: missing sub");
      return payload;
    }

    const payload = jwt.verify(token, publicKey, { algorithms: [alg as jwt.Algorithm] }) as SupabaseJwtPayload;
    if (!payload.sub) throw new Error("Invalid JWT payload: missing sub");
    return payload;
  }

  // HS256 — verify with shared secret (legacy / local dev)
  const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;

  if (!supabaseJwtSecret) {
    if (isProductionRuntime()) {
      throw new Error(
        "[SECURITY] SUPABASE_JWT_SECRET is not set in production. " +
        "Server startup aborted to prevent unauthenticated access.",
      );
    }
    const payload = decoded.payload as SupabaseJwtPayload;
    if (!payload.sub) throw new Error("Invalid JWT payload: missing sub");
    return payload;
  }

  const payload = jwt.verify(token, supabaseJwtSecret, { algorithms: ["HS256"] }) as SupabaseJwtPayload;
  if (!payload.sub) throw new Error("Invalid JWT payload: missing sub");
  return payload;
}

// ── Fastify plugin ────────────────────────────────────────────────────────────

async function authPlugin(app: FastifyInstance) {
  if (!process.env.SUPABASE_JWT_SECRET && !isProductionRuntime()) {
    app.log.warn(
      "[auth] SUPABASE_JWT_SECRET not set; JWT verification disabled for local/test runtime",
    );
  }

  app.decorateRequest("user", undefined);

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = await verifySupabaseJwt(token);
      request.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role ?? payload.user_metadata?.role ?? payload.app_metadata?.role,
      };
    } catch {
      return reply.code(401).send({ error: "INVALID_TOKEN" });
    }
  });
}

export default fp(authPlugin, { name: "auth" });
