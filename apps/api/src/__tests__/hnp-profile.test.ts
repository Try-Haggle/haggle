import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeTestApp, getTestApp } from "./helpers.js";

describe("HNP discovery profile", () => {
  let app: FastifyInstance;
  let originalJwksUri: string | undefined;
  let originalTrustedJwks: string | undefined;

  beforeAll(async () => {
    originalJwksUri = process.env.HNP_JWKS_URI;
    originalTrustedJwks = process.env.HNP_TRUSTED_JWKS;
    app = await getTestApp();
  });

  afterAll(async () => {
    if (originalJwksUri === undefined) {
      delete process.env.HNP_JWKS_URI;
    } else {
      process.env.HNP_JWKS_URI = originalJwksUri;
    }
    if (originalTrustedJwks === undefined) {
      delete process.env.HNP_TRUSTED_JWKS;
    } else {
      process.env.HNP_TRUSTED_JWKS = originalTrustedJwks;
    }
    await closeTestApp();
  });

  beforeEach(() => {
    delete process.env.HNP_JWKS_URI;
    delete process.env.HNP_TRUSTED_JWKS;
  });

  it("publishes the implemented HNP core profile and attempt-control policy", async () => {
    const res = await app.inject({ method: "GET", url: "/.well-known/hnp" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hnp.core_revisions).toContain("2026-03-09");
    expect(body.hnp.preferred_core_revision).toBe("2026-03-09");
    expect(body.hnp.capabilities["hnp.core.negotiation"]).toEqual({
      versions: ["1.0.0"],
      required: true,
    });
    expect(body.hnp.capabilities["ai.haggle.policy.attempt-control"].versions).toEqual(["1.0.0"]);
    expect(body.hnp.issue_namespaces).toEqual(["hnp.issue", "com.haggle.issue"]);
    expect(body.hnp.signature_algorithms).toEqual([]);
    expect(body.hnp.settlement_modes).toEqual(["manual", "escrow"]);
    expect(body.hnp.auth.schemes).toEqual(["bearer"]);
    expect(body.hnp.policy_defaults.attempt_control).toMatchObject({
      scope: "buyer_per_listing",
      max_concurrent_sessions: 1,
      max_sessions_per_window: 3,
      window_seconds: 86400,
      cooldown_seconds: 43200,
      max_rounds_per_session: 10,
      marketplace_daily_attempts: 5,
    });
  });

  it("advertises detached JWS when trusted JWKS verification is configured", async () => {
    process.env.HNP_TRUSTED_JWKS = JSON.stringify({ keys: [{ kty: "RSA", kid: "trusted-key" }] });
    process.env.HNP_JWKS_URI = "https://agent.example.com/.well-known/jwks.json";

    const res = await app.inject({ method: "GET", url: "/.well-known/hnp" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.hnp.auth.schemes).toEqual(["bearer", "jws-detached"]);
    expect(body.hnp.signature_algorithms).toEqual(["RS256", "PS256"]);
    expect(body.hnp.auth.jwks_uri).toBe("https://agent.example.com/.well-known/jwks.json");
  });
});
