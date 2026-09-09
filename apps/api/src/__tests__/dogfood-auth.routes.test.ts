/**
 * Eng1 T1 — POST /tools/dogfood-auth/session route units.
 * SoT: docs/wip/dogfood-auth-sot.md §3
 */

import type { FastifyInstance } from "fastify";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DOGFOOD_BUYER_USER_ID, DOGFOOD_SELLER_USER_ID } from "../lib/dogfood-auth-gate.js";
import { resetRateLimitsForTests } from "../middleware/rate-limit.js";
import { getTestApp } from "./helpers.js";

const TEST_SECRET = "dogfood-route-test-secret-32bytes!!";

const mintDogfoodWebSession = vi.fn();

vi.mock("../services/dogfood-auth.service.js", () => ({
  mintDogfoodWebSession: (...args: unknown[]) => mintDogfoodWebSession(...args),
  ensureDogfoodPersonaUser: vi.fn(),
  _setDogfoodAuthAdminForTest: vi.fn(),
}));

describe("POST /tools/dogfood-auth/session", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    mintDogfoodWebSession.mockReset();
    resetRateLimitsForTests();
  });

  it("prod reject: 404 even when secret is set", async () => {
    vi.stubEnv("HAGGLE_ENV", "production");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", TEST_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: {
        "content-type": "application/json",
        "x-haggle-dogfood-secret": TEST_SECRET,
      },
      payload: { persona: "buyer" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("NOT_FOUND");
    expect(JSON.stringify(res.json())).not.toContain(TEST_SECRET);
    expect(mintDogfoodWebSession).not.toHaveBeenCalled();
  });

  it("missing secret env → 404", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", "");

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: { "content-type": "application/json" },
      payload: { persona: "buyer" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("wrong secret → 401 without echoing secret", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", TEST_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: {
        "content-type": "application/json",
        "x-haggle-dogfood-secret": "wrong-secret-that-is-long-enough!!",
      },
      payload: { persona: "buyer" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("DOGFOOD_AUTH_UNAUTHORIZED");
    const body = JSON.stringify(res.json());
    expect(body).not.toContain(TEST_SECRET);
    expect(body).not.toContain("wrong-secret");
    expect(mintDogfoodWebSession).not.toHaveBeenCalled();
  });

  it("invalid persona → 400", async () => {
    vi.stubEnv("HAGGLE_ENV", "local");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", TEST_SECRET);

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: {
        "content-type": "application/json",
        "x-haggle-dogfood-secret": TEST_SECRET,
      },
      payload: { persona: "admin" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_PERSONA");
    expect(mintDogfoodWebSession).not.toHaveBeenCalled();
  });

  it("happy path buyer returns web session shape without secret echo", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", TEST_SECRET);
    mintDogfoodWebSession.mockResolvedValue({
      access_token: "buyer-access",
      refresh_token: "buyer-refresh",
      expires_at: 1_700_000_100,
      expires_in: 600,
      persona: "buyer",
      user_id: DOGFOOD_BUYER_USER_ID,
      handle: "dogfood_buyer",
    });

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: {
        "content-type": "application/json",
        "x-haggle-dogfood-secret": TEST_SECRET,
      },
      payload: { persona: "buyer" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.persona).toBe("buyer");
    expect(body.user_id).toBe(DOGFOOD_BUYER_USER_ID);
    expect(body.handle).toBe("dogfood_buyer");
    expect(body.access_token).toBe("buyer-access");
    expect(body.refresh_token).toBe("buyer-refresh");
    expect(body.expires_in).toBe(600);
    expect(JSON.stringify(body)).not.toContain(TEST_SECRET);
    expect(body).not.toHaveProperty("secret");
    expect(mintDogfoodWebSession).toHaveBeenCalledWith("buyer");
  });

  it("happy path seller returns seller persona session", async () => {
    vi.stubEnv("HAGGLE_ENV", "local");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", TEST_SECRET);
    mintDogfoodWebSession.mockResolvedValue({
      access_token: "seller-access",
      refresh_token: "seller-refresh",
      expires_in: 600,
      persona: "seller",
      user_id: DOGFOOD_SELLER_USER_ID,
      handle: "dogfood_seller",
    });

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: {
        "content-type": "application/json",
        "x-haggle-dogfood-secret": TEST_SECRET,
      },
      payload: { persona: "seller" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().persona).toBe("seller");
    expect(res.json().user_id).toBe(DOGFOOD_SELLER_USER_ID);
    expect(mintDogfoodWebSession).toHaveBeenCalledWith("seller");
  });

  it("mints without requiring test_unverified JWT mode", async () => {
    vi.stubEnv("HAGGLE_ENV", "staging");
    vi.stubEnv("HAGGLE_DOGFOOD_AUTH_SECRET", TEST_SECRET);
    // Dogfood must work as a new path even when unverified JWT fixtures are off.
    vi.stubEnv("HAGGLE_ALLOW_UNVERIFIED_TEST_JWT", "false");
    vi.stubEnv("HAGGLE_SUPABASE_JWT_MODE", "jwks");

    mintDogfoodWebSession.mockResolvedValue({
      access_token: "a",
      refresh_token: "r",
      persona: "buyer",
      user_id: DOGFOOD_BUYER_USER_ID,
      handle: "dogfood_buyer",
    });

    const res = await app.inject({
      method: "POST",
      url: "/tools/dogfood-auth/session",
      headers: {
        "content-type": "application/json",
        "x-haggle-dogfood-secret": TEST_SECRET,
      },
      payload: { persona: "buyer" },
    });

    expect(res.statusCode).toBe(200);
    expect(mintDogfoodWebSession).toHaveBeenCalledWith("buyer");
    expect(process.env.HAGGLE_SUPABASE_JWT_MODE).toBe("jwks");
    expect(process.env.HAGGLE_ALLOW_UNVERIFIED_TEST_JWT).toBe("false");
  });
});
