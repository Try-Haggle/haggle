import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SupabaseJwtVerifier,
  describeSupabaseJwtPolicy,
  resolveSupabaseJwtConfigFromEnv,
} from "../services/supabase-jwt.service.js";

const issuer = "https://project.supabase.co/auth/v1";
const audience = "authenticated";
const userId = "00000000-0000-4000-a000-000000000010";

function makeEcKey(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig" },
  };
}

function signedToken(key: ReturnType<typeof makeEcKey>, sub = userId) {
  return jwt.sign({ sub, role: "authenticated" }, key.privateKey, {
    algorithm: "ES256", keyid: key.kid, issuer, audience, expiresIn: "5m",
  });
}

function response(keys: unknown[], headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Response(JSON.stringify({ keys }), { status: 200, headers });
}

function config() {
  return resolveSupabaseJwtConfigFromEnv({
    NODE_ENV: "production",
    SUPABASE_URL: "https://project.supabase.co",
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Supabase JWT verification boundary", () => {
  it("accepts a valid ES256 token and exposes only aggregate policy", async () => {
    const key = makeEcKey("key-a");
    const verifier = new SupabaseJwtVerifier(config(), vi.fn().mockResolvedValue(response([key.jwk])) as typeof fetch);

    await expect(verifier.verify(signedToken(key))).resolves.toMatchObject({ sub: userId });
    expect(verifier.policyStatus()).toEqual(expect.objectContaining({
      mode: "jwks",
      signatureVerified: true,
      issuerVerified: true,
      audienceVerified: true,
      subjectUuidVerified: true,
      sharedAcrossHttpAndWebSocket: true,
      containsSecret: false,
      containsKeys: false,
      containsIdentifiers: false,
    }));
  });

  it("forces one JWKS refresh when a fresh cache misses the token kid", async () => {
    const oldKey = makeEcKey("old-key");
    const newKey = makeEcKey("new-key");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response([oldKey.jwk]))
      .mockResolvedValueOnce(response([oldKey.jwk, newKey.jwk]));
    const verifier = new SupabaseJwtVerifier(config(), fetcher as typeof fetch);

    await expect(verifier.verify(signedToken(oldKey))).resolves.toMatchObject({ sub: userId });
    await expect(verifier.verify(signedToken(newKey))).resolves.toMatchObject({ sub: userId });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects HS256 algorithm confusion before requesting JWKS", async () => {
    const fetcher = vi.fn();
    const verifier = new SupabaseJwtVerifier(config(), fetcher as typeof fetch);
    const token = jwt.sign({ sub: "user-123", iss: issuer, aud: audience }, "not-a-public-key", { algorithm: "HS256" });

    await expect(verifier.verify(token)).rejects.toThrow("algorithm is not allowed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects wrong issuer and audience even with a valid signature", async () => {
    const key = makeEcKey("key-a");
    const fetcher = vi.fn().mockResolvedValue(response([key.jwk]));
    const verifier = new SupabaseJwtVerifier(config(), fetcher as typeof fetch);
    const wrongIssuer = jwt.sign({ sub: "user-123" }, key.privateKey, {
      algorithm: "ES256", keyid: key.kid, issuer: "https://attacker.example/auth/v1", audience, expiresIn: "5m",
    });
    const wrongAudience = jwt.sign({ sub: "user-123" }, key.privateKey, {
      algorithm: "ES256", keyid: key.kid, issuer, audience: "service_role", expiresIn: "5m",
    });

    await expect(verifier.verify(wrongIssuer)).rejects.toThrow(/issuer/i);
    await expect(verifier.verify(wrongAudience)).rejects.toThrow(/audience/i);
  });

  it("rejects a signed non-UUID subject before it reaches UUID-backed routes", async () => {
    const key = makeEcKey("key-a");
    const verifier = new SupabaseJwtVerifier(config(),
      vi.fn().mockResolvedValue(response([key.jwk])) as typeof fetch);
    await expect(verifier.verify(signedToken(key, "user-123")))
      .rejects.toThrow("subject must be a UUID");
  });

  it("rejects duplicate key ids, non-JSON, and oversized JWKS responses", async () => {
    const key = makeEcKey("key-a");
    const token = signedToken(key);
    const duplicate = new SupabaseJwtVerifier(config(), vi.fn().mockResolvedValue(response([key.jwk, key.jwk])) as typeof fetch);
    const nonJson = new SupabaseJwtVerifier(config(), vi.fn().mockResolvedValue(response([key.jwk], { "content-type": "text/html" })) as typeof fetch);
    const oversized = new SupabaseJwtVerifier({ ...config(), maxResponseBytes: 10 }, vi.fn().mockResolvedValue(response([key.jwk])) as typeof fetch);

    await expect(duplicate.verify(token)).rejects.toThrow("unique");
    await expect(nonJson.verify(token)).rejects.toThrow("must be JSON");
    await expect(oversized.verify(token)).rejects.toThrow("too large");
  });

  it("allows unsigned fixture tokens only behind the explicit non-protected test gate", async () => {
    const testConfig = resolveSupabaseJwtConfigFromEnv({
      NODE_ENV: "test",
      HAGGLE_ALLOW_UNVERIFIED_TEST_JWT: "true",
    });
    const verifier = new SupabaseJwtVerifier(testConfig);
    const fake = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "fixture-user" })).toString("base64url")}.fake`;
    await expect(verifier.verify(fake)).resolves.toMatchObject({ sub: "fixture-user" });
    expect(describeSupabaseJwtPolicy(testConfig).signatureVerified).toBe(false);
    expect(describeSupabaseJwtPolicy(testConfig).subjectUuidVerified).toBe(false);

    expect(() => resolveSupabaseJwtConfigFromEnv({
      NODE_ENV: "production",
      HAGGLE_SUPABASE_JWT_MODE: "test_unverified",
      HAGGLE_ALLOW_UNVERIFIED_TEST_JWT: "true",
    })).toThrow("allowed only");
  });

  it("rejects insecure or ambiguous Supabase origins in protected environments", () => {
    expect(() => resolveSupabaseJwtConfigFromEnv({
      NODE_ENV: "production",
      SUPABASE_URL: "http://project.supabase.co",
    })).toThrow("HTTPS");
    expect(() => resolveSupabaseJwtConfigFromEnv({
      NODE_ENV: "production",
      SUPABASE_URL: "https://user:pass@project.supabase.co/path?x=1",
    })).toThrow(/credentials|path/);
  });
});
