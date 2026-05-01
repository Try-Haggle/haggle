import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import {
  getRuntimeConfig,
  isCorsOriginAllowed,
} from "../config/runtime.js";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  HAGGLE_CORS_ORIGINS: process.env.HAGGLE_CORS_ORIGINS,
  NODE_ENV: process.env.NODE_ENV,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
  HNP_REQUIRE_SIGNATURE: process.env.HNP_REQUIRE_SIGNATURE,
  HNP_TRUSTED_JWKS: process.env.HNP_TRUSTED_JWKS,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const validTrustedJwks = JSON.stringify({
  keys: [{ ...publicKey.export({ format: "jwk" }), kid: "runtime-test-key", alg: "RS256" }],
});

afterEach(() => {
  for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("runtime config", () => {
  it("throws a clear error when DATABASE_URL is missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_JWT_SECRET = "secret";

    expect(() => getRuntimeConfig()).toThrow(
      "[CONFIG] DATABASE_URL is required",
    );
  });

  it("throws a clear error when NODE_ENV is missing", () => {
    delete process.env.NODE_ENV;
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";

    expect(() => getRuntimeConfig()).toThrow(
      "[CONFIG] NODE_ENV is required",
    );
  });

  it("requires SUPABASE_JWT_SECRET in production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    delete process.env.SUPABASE_JWT_SECRET;

    expect(() => getRuntimeConfig()).toThrow(
      "[CONFIG] SUPABASE_JWT_SECRET is required",
    );
  });

  it("requires HNP_TRUSTED_JWKS in production when HNP signatures are required", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    delete process.env.HNP_REQUIRE_SIGNATURE;
    delete process.env.HNP_TRUSTED_JWKS;

    expect(() => getRuntimeConfig()).toThrow(
      "[CONFIG] HNP_TRUSTED_JWKS is required",
    );
  });

  it("rejects malformed production HNP_TRUSTED_JWKS", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.HNP_TRUSTED_JWKS = "{not-json";

    expect(() => getRuntimeConfig()).toThrow(
      "[CONFIG] HNP_TRUSTED_JWKS must be a valid JWKS",
    );
  });

  it("rejects production HNP_TRUSTED_JWKS without a usable public key", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.HNP_TRUSTED_JWKS = JSON.stringify({ keys: [] });

    expect(() => getRuntimeConfig()).toThrow(
      "[CONFIG] HNP_TRUSTED_JWKS must be a valid JWKS",
    );
  });

  it("accepts production HNP_TRUSTED_JWKS with a usable public key", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    delete process.env.HNP_REQUIRE_SIGNATURE;
    process.env.HNP_TRUSTED_JWKS = validTrustedJwks;

    expect(getRuntimeConfig().isProduction).toBe(true);
  });

  it("allows production startup without HNP_TRUSTED_JWKS only with explicit HNP signature override", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://example";
    process.env.SUPABASE_JWT_SECRET = "secret";
    process.env.HNP_REQUIRE_SIGNATURE = "false";
    delete process.env.HNP_TRUSTED_JWKS;

    expect(getRuntimeConfig().isProduction).toBe(true);
  });

  it("does not allow arbitrary Vercel preview origins", () => {
    const allowed = isCorsOriginAllowed("https://fork-preview.vercel.app", {
      isProduction: true,
      corsAllowedOrigins: new Set(["https://tryhaggle.ai"]),
    });

    expect(allowed).toBe(false);
  });

  it("allows explicitly configured preview origins", () => {
    const allowed = isCorsOriginAllowed("https://haggle-git-main.vercel.app", {
      isProduction: true,
      corsAllowedOrigins: new Set(["https://haggle-git-main.vercel.app"]),
    });

    expect(allowed).toBe(true);
  });

  it("allows localhost only outside production", () => {
    const config = {
      corsAllowedOrigins: new Set(["https://tryhaggle.ai"]),
    };

    expect(isCorsOriginAllowed("http://localhost:3000", {
      ...config,
      isProduction: false,
    })).toBe(true);
    expect(isCorsOriginAllowed("http://localhost:3000", {
      ...config,
      isProduction: true,
    })).toBe(false);
  });
});
